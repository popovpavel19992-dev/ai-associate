import { describe, it, expect } from "vitest";
import {
  TASK_STATUSES,
  TASK_CATEGORIES_LIST,
  TASK_PRIORITIES_LIST,
  checklistSchema,
} from "@/lib/case-tasks";

describe("case-tasks constants", () => {
  it("has 3 statuses", () => {
    expect(TASK_STATUSES).toEqual(["todo", "in_progress", "done"]);
  });

  it("has 6 categories", () => {
    expect(TASK_CATEGORIES_LIST).toHaveLength(6);
  });

  it("has 4 priorities", () => {
    expect(TASK_PRIORITIES_LIST).toHaveLength(4);
  });

  it("checklistSchema validates valid items", () => {
    const result = checklistSchema.safeParse([{ id: "1", title: "step", completed: false }]);
    expect(result.success).toBe(true);
  });

  it("checklistSchema rejects empty title", () => {
    const result = checklistSchema.safeParse([{ id: "1", title: "", completed: false }]);
    expect(result.success).toBe(false);
  });
});
