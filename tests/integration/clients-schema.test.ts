import { describe, it, expect } from "vitest";
import {
  createClientSchema,
  updateClientSchema,
  contactSchema,
} from "@/lib/clients";

describe("createClientSchema", () => {
  it("accepts a valid individual", () => {
    const result = createClientSchema.safeParse({
      clientType: "individual",
      firstName: "Jane",
      lastName: "Doe",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an individual without first name", () => {
    const result = createClientSchema.safeParse({
      clientType: "individual",
      lastName: "Doe",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid organization with EIN and website", () => {
    const result = createClientSchema.safeParse({
      clientType: "organization",
      companyName: "Acme Corp",
      ein: "12-3456789",
      website: "https://acme.example.com",
      industry: "Tech",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an organization without companyName", () => {
    const result = createClientSchema.safeParse({
      clientType: "organization",
      industry: "Tech",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an organization with malformed EIN", () => {
    const result = createClientSchema.safeParse({
      clientType: "organization",
      companyName: "Acme",
      ein: "1234567",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an organization with non-URL website", () => {
    const result = createClientSchema.safeParse({
      clientType: "organization",
      companyName: "Acme",
      website: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("defaults country to 'US'", () => {
    const result = createClientSchema.parse({
      clientType: "individual",
      firstName: "Jane",
      lastName: "Doe",
    });
    expect(result.country).toBe("US");
  });

  it("rejects notes longer than 5000 chars", () => {
    const result = createClientSchema.safeParse({
      clientType: "individual",
      firstName: "Jane",
      lastName: "Doe",
      notes: "x".repeat(5001),
    });
    expect(result.success).toBe(false);
  });
});

describe("updateClientSchema", () => {
  it("does not require clientType", () => {
    const result = updateClientSchema.safeParse({ firstName: "Jane" });
    expect(result.success).toBe(true);
  });

  it("does not allow clientType field", () => {
    const result = updateClientSchema.safeParse({ clientType: "individual", firstName: "X" });
    // strict() rejects unknown keys; clientType is not in schema
    expect(result.success).toBe(false);
  });
});

describe("contactSchema", () => {
  it("accepts a minimal contact", () => {
    const result = contactSchema.safeParse({ name: "John CEO" });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = contactSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("validates email format when provided", () => {
    const ok = contactSchema.safeParse({ name: "X", email: "x@example.com" });
    const bad = contactSchema.safeParse({ name: "X", email: "not-email" });
    expect(ok.success).toBe(true);
    expect(bad.success).toBe(false);
  });

  it("isPrimary is omitted when not provided", () => {
    const result = contactSchema.parse({ name: "John" });
    expect(result.isPrimary).toBeUndefined();
  });
});
