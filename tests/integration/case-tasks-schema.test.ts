import { describe, it, expect } from "vitest";
import { caseTasks, type ChecklistItem } from "@/server/db/schema/case-tasks";

describe("case_tasks schema", () => {
  it("exports caseTasks table object", () => {
    expect(caseTasks).toBeDefined();
  });

  it("ChecklistItem type has id, title, completed", () => {
    const item: ChecklistItem = { id: "x", title: "t", completed: false };
    expect(item.id).toBe("x");
    expect(item.title).toBe("t");
    expect(item.completed).toBe(false);
  });
});
