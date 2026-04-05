import { describe, it, expect } from "vitest";
import { STAGE_TEMPLATES } from "@/lib/case-stages";
import { CASE_TYPES } from "@/lib/constants";
import { EVENT_TYPES, TASK_PRIORITIES, TASK_CATEGORIES } from "@/lib/case-stages";

describe("Case Stages — Constants", () => {
  it("has stage templates for all 7 case types", () => {
    for (const caseType of CASE_TYPES) {
      expect(STAGE_TEMPLATES[caseType]).toBeDefined();
      expect(STAGE_TEMPLATES[caseType].length).toBeGreaterThan(0);
    }
  });

  it("every case type starts with intake and ends with closed", () => {
    for (const caseType of CASE_TYPES) {
      const stages = STAGE_TEMPLATES[caseType];
      expect(stages[0].slug).toBe("intake");
      expect(stages[stages.length - 1].slug).toBe("closed");
    }
  });

  it("all slugs are unique within a case type", () => {
    for (const caseType of CASE_TYPES) {
      const slugs = STAGE_TEMPLATES[caseType].map((s) => s.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });

  it("all stages have valid colors (hex format)", () => {
    for (const caseType of CASE_TYPES) {
      for (const stage of STAGE_TEMPLATES[caseType]) {
        expect(stage.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });

  it("all task priorities are valid", () => {
    for (const caseType of CASE_TYPES) {
      for (const stage of STAGE_TEMPLATES[caseType]) {
        for (const task of stage.tasks) {
          expect(TASK_PRIORITIES).toContain(task.priority);
        }
      }
    }
  });

  it("all task categories are valid", () => {
    for (const caseType of CASE_TYPES) {
      for (const stage of STAGE_TEMPLATES[caseType]) {
        for (const task of stage.tasks) {
          expect(TASK_CATEGORIES).toContain(task.category);
        }
      }
    }
  });

  it("event types array has expected values", () => {
    expect(EVENT_TYPES).toContain("stage_changed");
    expect(EVENT_TYPES).toContain("document_added");
    expect(EVENT_TYPES).toContain("manual");
  });
});
