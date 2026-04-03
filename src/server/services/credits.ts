import { eq, sql, and, lt } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema/users";
import { organizations } from "../db/schema/organizations";
import { PLAN_LIMITS } from "@/lib/constants";

export function calculateCredits(docCount: number): number {
  const baseCost = docCount;
  const synthesisSurcharge = docCount > 5 ? Math.ceil((docCount - 5) * 1.5) : 0;
  return baseCost + synthesisSurcharge;
}

export async function checkCredits(userId: string): Promise<{
  available: number;
  used: number;
  limit: number;
  plan: string;
}> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("User not found");

  if (user.orgId) {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, user.orgId)).limit(1);
    if (!org) throw new Error("Organization not found");

    const limit = PLAN_LIMITS[org.plan as keyof typeof PLAN_LIMITS]?.credits ?? 0;
    const used = org.creditsUsedThisMonth;
    return { available: Math.max(0, limit - used), used, limit, plan: org.plan };
  }

  const plan = user.plan ?? "trial";
  const limit = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS]?.credits ?? 0;
  const used = user.creditsUsedThisMonth;
  return { available: Math.max(0, limit - used), used, limit, plan };
}

export async function decrementCredits(
  userId: string,
  cost: number,
): Promise<boolean> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return false;

  if (user.orgId) {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, user.orgId)).limit(1);
    if (!org) return false;

    const limit = PLAN_LIMITS[org.plan as keyof typeof PLAN_LIMITS]?.credits ?? 0;

    const [updated] = await db
      .update(organizations)
      .set({ creditsUsedThisMonth: sql`${organizations.creditsUsedThisMonth} + ${cost}` })
      .where(and(eq(organizations.id, org.id), lt(organizations.creditsUsedThisMonth, limit)))
      .returning();

    return !!updated;
  }

  const plan = user.plan ?? "trial";
  const limit = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS]?.credits ?? 0;

  const [updated] = await db
    .update(users)
    .set({ creditsUsedThisMonth: sql`${users.creditsUsedThisMonth} + ${cost}` })
    .where(and(eq(users.id, userId), lt(users.creditsUsedThisMonth, limit)))
    .returning();

  return !!updated;
}
