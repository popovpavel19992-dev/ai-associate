// src/components/calendar/calendar-item-utils.ts
import type { CalendarEventKind } from "@/lib/calendar-events";
import {
  CALENDAR_EVENT_KIND_META,
  DEADLINE_KINDS,
} from "@/lib/calendar-events";
import type { TaskStatus, TaskPriority } from "@/lib/case-tasks";

export type CalendarEventItem = {
  source: "event";
  id: string;
  kind: CalendarEventKind;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  caseId: string;
  linkedTaskId: string | null;
  location: string | null;
  description: string | null;
};

export type CalendarTaskItem = {
  source: "task";
  id: string; // synthetic: `task:${taskId}`
  taskId: string;
  title: string;
  startsAt: Date;
  endsAt: null;
  caseId: string;
  status: TaskStatus;
  priority: TaskPriority;
};

export type CalendarItem = CalendarEventItem | CalendarTaskItem;

type RawEvent = {
  id: string;
  kind: CalendarEventKind;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  caseId: string;
  linkedTaskId: string | null;
  location: string | null;
  description: string | null;
};

type RawTask = {
  id: string;
  title: string;
  dueDate: Date | null;
  caseId: string;
  status: TaskStatus;
  priority: TaskPriority;
};

export function mergeToCalendarItems(
  events: RawEvent[] | undefined,
  tasks: RawTask[] | undefined,
): CalendarItem[] {
  const out: CalendarItem[] = [];

  for (const e of events ?? []) {
    out.push({
      source: "event",
      id: e.id,
      kind: e.kind,
      title: e.title,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      caseId: e.caseId,
      linkedTaskId: e.linkedTaskId,
      location: e.location,
      description: e.description,
    });
  }

  for (const t of tasks ?? []) {
    if (!t.dueDate) continue;
    out.push({
      source: "task",
      id: `task:${t.id}`,
      taskId: t.id,
      title: t.title,
      startsAt: t.dueDate,
      endsAt: null,
      caseId: t.caseId,
      status: t.status,
      priority: t.priority,
    });
  }

  out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return out;
}

export function isOverdue(item: CalendarItem, now: Date = new Date()): boolean {
  if (item.source === "task") {
    return item.status !== "done" && item.startsAt.getTime() < now.getTime();
  }
  if (!DEADLINE_KINDS.has(item.kind)) return false;
  const end = item.endsAt ?? item.startsAt;
  return end.getTime() < now.getTime();
}

export function isUpcoming24h(
  item: CalendarItem,
  now: Date = new Date(),
): boolean {
  if (isOverdue(item, now)) return false;
  if (item.source === "task") {
    if (item.status === "done") return false;
  } else if (!DEADLINE_KINDS.has(item.kind)) {
    return false;
  }
  const target = item.startsAt.getTime();
  const diff = target - now.getTime();
  return diff >= 0 && diff <= 24 * 60 * 60 * 1000;
}

export function getItemColorClass(item: CalendarItem): string {
  if (item.source === "event") {
    return CALENDAR_EVENT_KIND_META[item.kind].colorClass;
  }
  // Tasks use a neutral slate look so they read as "linked task" not "event"
  return "bg-zinc-800 text-zinc-200 border-zinc-600";
}

export function getBorderClass(
  item: CalendarItem,
  now: Date = new Date(),
): string {
  if (isOverdue(item, now)) return "border-l-[3px] border-l-red-500";
  if (isUpcoming24h(item, now)) return "border-l-[3px] border-l-yellow-500";
  return "";
}

// Shared react-big-calendar event shape, kept here so both the dynamic inner
// view module and the event-card component can import it without pulling
// react-big-calendar into non-calendar bundles.
export interface RBCEvent {
  title: string;
  start: Date;
  end: Date;
  resource: CalendarItem;
  allDay?: boolean;
}
