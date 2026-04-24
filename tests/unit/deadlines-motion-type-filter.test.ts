import { describe, it, expect } from "vitest";
import { DeadlinesService } from "@/server/services/deadlines/service";

describe("DeadlinesService — motionType signature", () => {
  it("accepts optional motionType in createTriggerEvent input", () => {
    const svc = new DeadlinesService();
    // Type-level check only — if this compiles, the signature is correct.
    const input = {
      caseId: "c",
      triggerEvent: "motion_filed",
      eventDate: "2026-05-01",
      jurisdiction: "FRCP",
      createdBy: "u",
      motionType: "motion_to_dismiss",
    } satisfies Parameters<typeof svc.createTriggerEvent>[0];
    expect(input.motionType).toBe("motion_to_dismiss");
  });

  it("accepts input without motionType (backward compat)", () => {
    const svc = new DeadlinesService();
    const input = {
      caseId: "c",
      triggerEvent: "complaint_served",
      eventDate: "2026-05-01",
      jurisdiction: "FRCP",
      createdBy: "u",
    } satisfies Parameters<typeof svc.createTriggerEvent>[0];
    expect(input.triggerEvent).toBe("complaint_served");
  });
});
