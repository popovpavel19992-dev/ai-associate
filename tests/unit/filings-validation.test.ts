import { describe, it, expect } from "vitest";
import { z } from "zod/v4";

const METHOD = z.enum(["cm_ecf", "mail", "hand_delivery", "email", "fax"]);
const createInput = z
  .object({
    motionId: z.string().uuid().optional(),
    packageId: z.string().uuid().optional(),
    confirmationNumber: z.string().min(1).max(100),
    court: z.string().min(1).max(100),
    submissionMethod: METHOD,
    feePaidCents: z.number().int().min(0),
    submittedAt: z.string().datetime(),
  })
  .refine((v) => v.motionId || v.packageId, {
    message: "Filing must reference either a motion or a package",
  });

describe("filings create input schema", () => {
  it("rejects missing motion and package", () => {
    const r = createInput.safeParse({
      confirmationNumber: "1",
      court: "S.D.N.Y.",
      submissionMethod: "cm_ecf",
      feePaidCents: 0,
      submittedAt: new Date().toISOString(),
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative fee", () => {
    const r = createInput.safeParse({
      motionId: "11111111-1111-4111-8111-111111111111",
      confirmationNumber: "1",
      court: "S.D.N.Y.",
      submissionMethod: "cm_ecf",
      feePaidCents: -1,
      submittedAt: new Date().toISOString(),
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid method", () => {
    const r = createInput.safeParse({
      motionId: "11111111-1111-4111-8111-111111111111",
      confirmationNumber: "1",
      court: "S.D.N.Y.",
      submissionMethod: "carrier_pigeon" as never,
      feePaidCents: 0,
      submittedAt: new Date().toISOString(),
    });
    expect(r.success).toBe(false);
  });

  it("accepts valid motion-only input", () => {
    const r = createInput.safeParse({
      motionId: "11111111-1111-4111-8111-111111111111",
      confirmationNumber: "12345-67890",
      court: "S.D.N.Y.",
      submissionMethod: "cm_ecf",
      feePaidCents: 40200,
      submittedAt: new Date().toISOString(),
    });
    expect(r.success).toBe(true);
  });
});
