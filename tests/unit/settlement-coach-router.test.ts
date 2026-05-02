// tests/unit/settlement-coach-router.test.ts
//
// Smoke test — verifies the settlement-coach tRPC router exports the expected
// procedures. Full behavior is exercised by the orchestrator unit tests and by
// Unit 11 UAT against a live DB.

import { describe, it, expect, vi } from "vitest";

// Mock voyageai SDK — its ESM directory imports break under vitest's resolver.
// We never actually call it in this smoke test; the mock just lets the module
// graph import cleanly via the orchestrator → sources → voyage chain.
vi.mock("voyageai", () => ({
  VoyageAIClient: vi.fn(function (this: { embed: () => unknown }) {
    this.embed = () => ({ data: [] });
  }),
}));

const { settlementCoachRouter } = await import(
  "@/server/trpc/routers/settlement-coach"
);

describe("settlementCoachRouter shape", () => {
  it("exports a router object", () => {
    expect(settlementCoachRouter).toBeDefined();
    expect(typeof settlementCoachRouter).toBe("object");
  });

  it("exposes the expected procedures", () => {
    const procs = [
      "computeBatna",
      "recommendCounter",
      "getBatna",
      "listCounters",
    ] as const;
    for (const p of procs) {
      expect(settlementCoachRouter[p]).toBeDefined();
    }
  });

  it("is registered on the appRouter", async () => {
    const { appRouter } = await import("@/server/trpc/root");
    expect(appRouter._def.procedures).toBeDefined();
    // tRPC v11 flattens nested routers into dotted procedure paths
    const procPaths = Object.keys(appRouter._def.procedures);
    expect(procPaths.some((k) => k.startsWith("settlementCoach."))).toBe(true);
  });
});
