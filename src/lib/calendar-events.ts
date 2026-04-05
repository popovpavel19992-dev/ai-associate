// src/lib/calendar-events.ts
import { z } from "zod/v4";
import type { LucideIcon } from "lucide-react";
import { Gavel, FileClock, Users, Bell, Circle } from "lucide-react";

export const CALENDAR_EVENT_KINDS = [
  "court_date",
  "filing_deadline",
  "meeting",
  "reminder",
  "other",
] as const;

export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number];

export const CALENDAR_EVENT_KIND_META: Record<
  CalendarEventKind,
  { label: string; colorClass: string; icon: LucideIcon }
> = {
  court_date: {
    label: "Court Date",
    colorClass: "bg-red-950 text-red-300 border-red-800",
    icon: Gavel,
  },
  filing_deadline: {
    label: "Filing Deadline",
    colorClass: "bg-amber-950 text-amber-300 border-amber-800",
    icon: FileClock,
  },
  meeting: {
    label: "Meeting",
    colorClass: "bg-blue-950 text-blue-300 border-blue-800",
    icon: Users,
  },
  reminder: {
    label: "Reminder",
    colorClass: "bg-violet-950 text-violet-300 border-violet-800",
    icon: Bell,
  },
  other: {
    label: "Other",
    colorClass: "bg-zinc-800 text-zinc-300 border-zinc-700",
    icon: Circle,
  },
};

/** Kinds whose overdue/upcoming status should be visually surfaced. */
export const DEADLINE_KINDS: ReadonlySet<CalendarEventKind> = new Set([
  "court_date",
  "filing_deadline",
]);

const kindEnum = z.enum(CALENDAR_EVENT_KINDS);

export const calendarEventCreateSchema = z
  .object({
    caseId: z.string().uuid(),
    kind: kindEnum,
    title: z.string().min(1).max(200),
    description: z.string().max(5000).nullish(),
    startsAt: z.date(),
    endsAt: z.date().nullish(),
    location: z.string().max(300).nullish(),
    linkedTaskId: z.string().uuid().nullish(),
  })
  .refine((d) => d.endsAt == null || d.endsAt > d.startsAt, {
    path: ["endsAt"],
    message: "End time must be after start time",
  });

export const calendarEventUpdateSchema = z
  .object({
    id: z.string().uuid(),
    kind: kindEnum.optional(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullish(),
    startsAt: z.date().optional(),
    endsAt: z.date().nullish(),
    location: z.string().max(300).nullish(),
    linkedTaskId: z.string().uuid().nullish(),
  })
  .refine(
    (d) =>
      d.startsAt == null ||
      d.endsAt == null ||
      d.endsAt === undefined ||
      d.endsAt > d.startsAt,
    { path: ["endsAt"], message: "End time must be after start time" },
  );

export type CalendarEventCreateInput = z.infer<
  typeof calendarEventCreateSchema
>;
export type CalendarEventUpdateInput = z.infer<
  typeof calendarEventUpdateSchema
>;
