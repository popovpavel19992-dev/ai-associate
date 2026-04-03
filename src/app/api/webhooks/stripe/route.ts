import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, PLAN_FROM_PRICE } from "@/lib/stripe";
import { db } from "@/server/db";
import { subscriptions } from "@/server/db/schema/subscriptions";
import { users } from "@/server/db/schema/users";
import { organizations } from "@/server/db/schema/organizations";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
        );
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;
    }
  } catch (err) {
    console.error(`Webhook handler error for ${event.type}:`, err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

function getSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent;
  if (!parent) return null;
  if (parent.type === "subscription_details" && parent.subscription_details) {
    const sub = parent.subscription_details.subscription;
    return typeof sub === "string" ? sub : sub?.id ?? null;
  }
  return null;
}

function getPlanFromSubscription(subscription: Stripe.Subscription): string {
  const priceId = subscription.items.data[0]?.price?.id;
  if (priceId && !PLAN_FROM_PRICE[priceId]) {
    console.warn(`[stripe] Unknown price ID: ${priceId}, defaulting to "solo"`);
  }
  return priceId ? (PLAN_FROM_PRICE[priceId] ?? "solo") : "solo";
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.mode !== "subscription" || !session.subscription) return;

  const subId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription.id;

  const subscription = await stripe.subscriptions.retrieve(subId);
  const plan = getPlanFromSubscription(subscription);
  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id ?? "";

  // Idempotent check
  const [existing] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subscription.id))
    .limit(1);

  if (existing) return;

  const metadata = session.metadata ?? {};
  const userId = metadata.userId ?? null;
  const orgId = metadata.orgId ?? null;

  const anchorDate = new Date(subscription.billing_cycle_anchor * 1000);

  await db.insert(subscriptions).values({
    userId,
    orgId,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: customerId,
    plan,
    status: "active",
    currentPeriodStart: anchorDate,
    currentPeriodEnd: null,
  });

  if (userId) {
    await db
      .update(users)
      .set({
        plan: plan as "trial" | "solo",
        subscriptionStatus: "active",
        stripeCustomerId: customerId,
      })
      .where(eq(users.id, userId));
  }

  if (orgId) {
    await db
      .update(organizations)
      .set({
        plan: plan as "small_firm" | "firm_plus",
        subscriptionStatus: "active",
        stripeCustomerId: customerId,
      })
      .where(eq(organizations.id, orgId));
  }
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const subId = getSubscriptionIdFromInvoice(invoice);
  if (!subId) return;

  await db
    .update(subscriptions)
    .set({ status: "active" })
    .where(eq(subscriptions.stripeSubscriptionId, subId));

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subId))
    .limit(1);
  if (!sub) return;

  if (sub.userId) {
    await db
      .update(users)
      .set({ subscriptionStatus: "active" })
      .where(eq(users.id, sub.userId));
  }
  if (sub.orgId) {
    await db
      .update(organizations)
      .set({ subscriptionStatus: "active" })
      .where(eq(organizations.id, sub.orgId));
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const subId = getSubscriptionIdFromInvoice(invoice);
  if (!subId) return;

  await db
    .update(subscriptions)
    .set({ status: "past_due" })
    .where(eq(subscriptions.stripeSubscriptionId, subId));

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subId))
    .limit(1);
  if (!sub) return;

  if (sub.userId) {
    await db
      .update(users)
      .set({ subscriptionStatus: "past_due" })
      .where(eq(users.id, sub.userId));
  }
  if (sub.orgId) {
    await db
      .update(organizations)
      .set({ subscriptionStatus: "past_due" })
      .where(eq(organizations.id, sub.orgId));
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const plan = getPlanFromSubscription(subscription);

  await db
    .update(subscriptions)
    .set({
      plan,
      status: subscription.status === "active" ? "active" : "past_due",
    })
    .where(eq(subscriptions.stripeSubscriptionId, subscription.id));

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subscription.id))
    .limit(1);
  if (!sub) return;

  if (sub.userId) {
    await db
      .update(users)
      .set({ plan: plan as "trial" | "solo" })
      .where(eq(users.id, sub.userId));
  }
  if (sub.orgId) {
    await db
      .update(organizations)
      .set({ plan: plan as "small_firm" | "firm_plus" })
      .where(eq(organizations.id, sub.orgId));
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  await db
    .update(subscriptions)
    .set({ status: "cancelled" })
    .where(eq(subscriptions.stripeSubscriptionId, subscription.id));

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subscription.id))
    .limit(1);
  if (!sub) return;

  if (sub.userId) {
    await db
      .update(users)
      .set({ plan: "trial", subscriptionStatus: "cancelled" })
      .where(eq(users.id, sub.userId));
  }
  if (sub.orgId) {
    await db
      .update(organizations)
      .set({ subscriptionStatus: "cancelled" })
      .where(eq(organizations.id, sub.orgId));
  }
}
