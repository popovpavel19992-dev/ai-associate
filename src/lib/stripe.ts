import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export const STRIPE_PRICE_IDS = {
  solo: process.env.STRIPE_PRICE_SOLO!,
  small_firm: process.env.STRIPE_PRICE_SMALL_FIRM!,
  firm_plus: process.env.STRIPE_PRICE_FIRM_PLUS!,
} as const;

export const PLAN_FROM_PRICE: Record<string, string> = Object.fromEntries(
  Object.entries(STRIPE_PRICE_IDS).map(([plan, priceId]) => [priceId, plan]),
);
