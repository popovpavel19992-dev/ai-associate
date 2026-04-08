import { z } from "zod/v4";

type DisplayInput =
  | { clientType: "individual"; firstName?: string | null; lastName?: string | null }
  | { clientType: "organization"; companyName?: string | null };

export function deriveDisplayName(input: DisplayInput): string {
  if (input.clientType === "individual") {
    const first = (input.firstName ?? "").trim();
    const last = (input.lastName ?? "").trim();
    return [first, last].filter(Boolean).join(" ");
  }
  return (input.companyName ?? "").trim();
}

const addressFields = {
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  zipCode: z.string().max(20).optional(),
  country: z.string().length(2).default("US"),
};

const individualBase = z.object({
  clientType: z.literal("individual"),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: z.iso.date().optional(),
  notes: z.string().max(5000).optional(),
  ...addressFields,
});

const organizationBase = z.object({
  clientType: z.literal("organization"),
  companyName: z.string().min(1).max(200),
  ein: z.string().regex(/^\d{2}-\d{7}$/, "EIN format: XX-XXXXXXX").optional(),
  industry: z.string().max(100).optional(),
  website: z.url().max(500).optional(),
  notes: z.string().max(5000).optional(),
  ...addressFields,
});

export const createClientSchema = z.discriminatedUnion("clientType", [
  individualBase,
  organizationBase,
]);

// Update schema: clientType is immutable. We allow any subset of the
// non-discriminator fields and rely on the router to merge with the row.
// `.strict()` rejects unknown keys (including `clientType`).
export const updateClientSchema = z
  .object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    dateOfBirth: z.iso.date().optional(),
    companyName: z.string().min(1).max(200).optional(),
    ein: z.string().regex(/^\d{2}-\d{7}$/, "EIN format: XX-XXXXXXX").optional(),
    industry: z.string().max(100).optional(),
    website: z.url().max(500).optional(),
    notes: z.string().max(5000).optional(),
    addressLine1: z.string().max(200).optional(),
    addressLine2: z.string().max(200).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(50).optional(),
    zipCode: z.string().max(20).optional(),
    country: z.string().length(2).optional(),
  })
  .strict();

export const contactSchema = z.object({
  name: z.string().min(1).max(200),
  title: z.string().max(100).optional(),
  email: z.email().max(320).optional(),
  phone: z.string().max(50).optional(),
  isPrimary: z.boolean().default(false),
  notes: z.string().max(1000).optional(),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ContactInput = z.infer<typeof contactSchema>;
