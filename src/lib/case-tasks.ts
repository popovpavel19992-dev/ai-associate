import { z } from "zod/v4";

export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_CATEGORIES_LIST = [
  "filing",
  "research",
  "client_communication",
  "evidence",
  "court",
  "administrative",
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES_LIST)[number];

export const TASK_PRIORITIES_LIST = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES_LIST)[number];

export const checklistItemSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  completed: z.boolean(),
});

export const checklistSchema = z.array(checklistItemSchema);

export const TASK_STATUS_META: Record<TaskStatus, { label: string; dotColor: string }> = {
  todo: { label: "To Do", dotColor: "bg-zinc-500" },
  in_progress: { label: "In Progress", dotColor: "bg-blue-500" },
  done: { label: "Done", dotColor: "bg-green-500" },
};

export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  filing: "Filing",
  research: "Research",
  client_communication: "Client Comm.",
  evidence: "Evidence",
  court: "Court",
  administrative: "Admin",
};

export const TASK_PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: "bg-lime-950 text-lime-400",
  medium: "bg-blue-950 text-blue-400",
  high: "bg-amber-950 text-amber-400",
  urgent: "bg-red-950 text-red-400",
};
