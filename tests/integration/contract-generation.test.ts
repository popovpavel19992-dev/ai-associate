import { describe, it, expect } from "vitest";
import { GENERATION_CREDITS, CONTRACT_REVIEW_CREDITS } from "@/lib/constants";
import { draftOutputSchema, draftClauseOutputSchema } from "@/lib/schemas";

describe("Contract Generation", () => {
  describe("constants", () => {
    it("GENERATION_CREDITS is 3", () => {
      expect(GENERATION_CREDITS).toBe(3);
    });
  });

  describe("draftClauseOutputSchema", () => {
    it("validates a valid clause", () => {
      const clause = {
        number: "1",
        title: "Definitions",
        text: "For purposes of this Agreement...",
        type: "standard",
        ai_notes: "Standard definitions clause.",
      };
      const result = draftClauseOutputSchema.safeParse(clause);
      expect(result.success).toBe(true);
    });

    it("rejects clause with missing fields", () => {
      const result = draftClauseOutputSchema.safeParse({ number: "1" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid clause type", () => {
      const clause = { number: "1", title: "Test", text: "Text", type: "invalid_type", ai_notes: "Notes" };
      const result = draftClauseOutputSchema.safeParse(clause);
      expect(result.success).toBe(false);
    });
  });

  describe("draftOutputSchema", () => {
    it("validates a full draft output", () => {
      const output = {
        clauses: [
          { number: "1", title: "Definitions", text: "For purposes...", type: "standard", ai_notes: "Standard clause." },
          { number: "2", title: "Term", text: "This agreement shall...", type: "favorable", ai_notes: "Favorable term length." },
        ],
        preamble: "THIS AGREEMENT is entered into...",
        execution_block: "IN WITNESS WHEREOF...",
      };
      const result = draftOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });

    it("validates without optional preamble/execution_block", () => {
      const output = {
        clauses: [{ number: "1", title: "Test", text: "Content", type: "standard", ai_notes: "Notes" }],
      };
      const result = draftOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });
  });
});
