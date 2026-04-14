import { z } from "zod/v4";

// --- Activity types ---

export const ACTIVITY_TYPES = [
  "research",
  "drafting",
  "court_appearance",
  "client_communication",
  "filing",
  "review",
  "travel",
  "administrative",
  "other",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  research: "Research",
  drafting: "Drafting",
  court_appearance: "Court Appearance",
  client_communication: "Client Communication",
  filing: "Filing",
  review: "Review",
  travel: "Travel",
  administrative: "Administrative",
  other: "Other",
};

export const ACTIVITY_COLORS: Record<ActivityType, { bg: string; text: string }> = {
  research: { bg: "bg-blue-100", text: "text-blue-800" },
  drafting: { bg: "bg-amber-100", text: "text-amber-800" },
  court_appearance: { bg: "bg-purple-100", text: "text-purple-800" },
  client_communication: { bg: "bg-green-100", text: "text-green-800" },
  filing: { bg: "bg-pink-100", text: "text-pink-800" },
  review: { bg: "bg-indigo-100", text: "text-indigo-800" },
  travel: { bg: "bg-orange-100", text: "text-orange-800" },
  administrative: { bg: "bg-gray-100", text: "text-gray-800" },
  other: { bg: "bg-gray-100", text: "text-gray-600" },
};

// --- Expense categories ---

export const EXPENSE_CATEGORIES = [
  "filing_fee",
  "courier",
  "copying",
  "expert_fee",
  "travel",
  "postage",
  "service_of_process",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_LABELS: Record<ExpenseCategory, string> = {
  filing_fee: "Filing Fee",
  courier: "Courier",
  copying: "Copying",
  expert_fee: "Expert Fee",
  travel: "Travel",
  postage: "Postage",
  service_of_process: "Service of Process",
  other: "Other",
};

// --- Invoice statuses ---

export const INVOICE_STATUSES = ["draft", "sent", "paid", "void"] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_TERMS = [
  "Due on receipt",
  "Net 15",
  "Net 30",
  "Net 45",
  "Net 60",
] as const;

// --- Zod schemas ---

export const timeEntrySchema = z.object({
  activityType: z.enum(ACTIVITY_TYPES),
  description: z.string().min(1).max(2000),
  durationMinutes: z.number().int().min(1).max(1440),
  isBillable: z.boolean().default(true),
  entryDate: z.string().date(), // ISO date string "YYYY-MM-DD" — avoids timezone coercion issues with DATE column
  taskId: z.string().uuid().optional(),
});

export const expenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().min(1).max(1000),
  amountCents: z.number().int().min(1),
  expenseDate: z.string().date(), // ISO date string "YYYY-MM-DD"
});

export const billingRateSchema = z.object({
  rateCents: z.number().int().min(0),
});

// --- Helpers ---

/** Compute amount in cents: multiply first, divide last for integer precision. */
export function computeAmountCents(durationMinutes: number, rateCents: number): number {
  return Math.round((durationMinutes * rateCents) / 60);
}

/** Format cents as dollar string: 150000 → "$1,500.00" */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/** Format duration in minutes to "X.XX" hours string: 150 → "2.50" */
export function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

/** Format invoice number: 42 → "INV-0042" */
export function formatInvoiceNumber(num: number): string {
  return `INV-${String(num).padStart(4, "0")}`;
}
