import { Webhook } from "svix";
import { headers } from "next/headers";
import type { WebhookEvent } from "@clerk/nextjs/server";
import { db } from "@/server/db";
import { users } from "@/server/db/schema/users";
import { eq, inArray } from "drizzle-orm";
import { organizations } from "@/server/db/schema/organizations";
import { cases } from "@/server/db/schema/cases";
import { caseMembers } from "@/server/db/schema/case-members";
import { inngest } from "@/server/inngest/client";

export async function POST(req: Request) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return Response.json({ error: "Missing webhook secret" }, { status: 500 });
  }

  const headerPayload = await headers();
  const svixId = headerPayload.get("svix-id");
  const svixTimestamp = headerPayload.get("svix-timestamp");
  const svixSignature = headerPayload.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return Response.json({ error: "Missing svix headers" }, { status: 400 });
  }

  const body = await req.text();
  const wh = new Webhook(webhookSecret);

  let evt: WebhookEvent;
  try {
    evt = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as WebhookEvent;
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (evt.type) {
    case "user.created": {
      const { id, email_addresses, first_name, last_name } = evt.data;
      const email = email_addresses[0]?.email_address;
      if (!email) break;

      await db.insert(users).values({
        clerkId: id,
        email,
        name: [first_name, last_name].filter(Boolean).join(" ") || email,
      });
      break;
    }

    case "user.updated": {
      const { id, email_addresses, first_name, last_name } = evt.data;
      const email = email_addresses[0]?.email_address;
      if (!email) break;

      await db
        .update(users)
        .set({
          email,
          name: [first_name, last_name].filter(Boolean).join(" ") || email,
        })
        .where(eq(users.clerkId, id));
      break;
    }

    case "organizationMembership.created": {
      const { organization, public_user_data, role } = evt.data;
      const clerkUserId = public_user_data.user_id;
      if (!clerkUserId || !organization) break;

      const [org] = await db
        .select({ ownerUserId: organizations.ownerUserId, id: organizations.id })
        .from(organizations)
        .where(eq(organizations.clerkOrgId, organization.id))
        .limit(1);
      if (!org) break;

      const [user] = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.clerkId, clerkUserId))
        .limit(1);
      if (!user) break;

      const mappedRole = user.id === org.ownerUserId ? "owner" : role === "org:admin" ? "admin" : "member";

      await db
        .update(users)
        .set({ orgId: org.id, role: mappedRole })
        .where(eq(users.clerkId, clerkUserId));

      // Notify other org members that a new member has joined
      const otherMembers = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.orgId, org.id));

      for (const member of otherMembers) {
        if (member.id === user.id) continue;
        await inngest.send({
          name: "notification/send",
          data: {
            userId: member.id,
            orgId: org.id,
            type: "team_member_joined",
            title: `${user.name} joined the team`,
            body: `${user.name} has joined your organization`,
            actionUrl: "/team",
            metadata: { memberName: user.name },
          },
        });
      }
      break;
    }

    case "organizationMembership.updated": {
      const { organization, public_user_data, role } = evt.data;
      const clerkUserId = public_user_data.user_id;
      if (!clerkUserId || !organization) break;

      const [org] = await db
        .select({ ownerUserId: organizations.ownerUserId })
        .from(organizations)
        .where(eq(organizations.clerkOrgId, organization.id))
        .limit(1);
      if (!org) break;

      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkId, clerkUserId))
        .limit(1);
      if (!user) break;

      const mappedRole = user.id === org.ownerUserId ? "owner" : role === "org:admin" ? "admin" : "member";

      await db
        .update(users)
        .set({ role: mappedRole })
        .where(eq(users.clerkId, clerkUserId));
      break;
    }

    case "organizationMembership.deleted": {
      const { organization, public_user_data } = evt.data;
      const clerkUserId = public_user_data.user_id;
      if (!clerkUserId || !organization) break;

      const [org] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.clerkOrgId, organization.id))
        .limit(1);
      if (!org) break;

      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkId, clerkUserId))
        .limit(1);
      if (!user) break;

      await db
        .update(users)
        .set({ orgId: null, role: null })
        .where(eq(users.clerkId, clerkUserId));

      await inngest.send({
        name: "team/membership.cleanup",
        data: { userId: user.id, orgId: org.id },
      });
      break;
    }

    case "organization.deleted": {
      const { id: clerkOrgId } = evt.data;
      if (!clerkOrgId) break;

      const [org] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.clerkOrgId, clerkOrgId as string))
        .limit(1);
      if (!org) break;

      await db
        .update(users)
        .set({ orgId: null, role: null })
        .where(eq(users.orgId, org.id));

      await db.delete(caseMembers).where(
        inArray(
          caseMembers.caseId,
          db.select({ id: cases.id }).from(cases).where(eq(cases.orgId, org.id)),
        ),
      );

      await db.update(cases).set({ orgId: null }).where(eq(cases.orgId, org.id));

      await db.delete(organizations).where(eq(organizations.id, org.id));
      break;
    }
  }

  return Response.json({ success: true });
}
