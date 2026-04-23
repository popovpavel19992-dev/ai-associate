// src/components/calendar/use-calendar-items.ts
"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  mergeToCalendarItems,
  type CalendarItem,
} from "./calendar-item-utils";

interface Args {
  caseId?: string;
  from: Date;
  to: Date;
  caseIds?: string[];
}

interface Result {
  items: CalendarItem[];
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

export function useCalendarItems({
  caseId,
  from,
  to,
  caseIds,
}: Args): Result {
  // Case-scoped path uses calendar.list (no date filter — full case events),
  // global path uses listByDateRange.
  const caseEventsQuery = trpc.calendar.list.useQuery(
    { caseId: caseId ?? "" },
    { enabled: !!caseId },
  );
  const globalEventsQuery = trpc.calendar.listByDateRange.useQuery(
    { from, to, caseIds },
    { enabled: !caseId },
  );

  const tasksQuery = trpc.caseTasks.listWithDueDate.useQuery({
    from,
    to,
    caseId,
  });

  const deadlinesQuery = trpc.deadlines.listForRange.useQuery({
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    caseIds: caseIds ?? (caseId ? [caseId] : undefined),
  });

  const rawEvents = caseId ? caseEventsQuery.data : globalEventsQuery.data;

  const items = useMemo(
    () =>
      mergeToCalendarItems(
        rawEvents?.map((e) => ({
          id: e.id,
          kind: e.kind,
          title: e.title,
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          caseId: e.caseId,
          linkedTaskId: e.linkedTaskId,
          location: e.location,
          description: e.description,
        })),
        tasksQuery.data?.map((t) => ({
          id: t.id,
          title: t.title,
          dueDate: t.dueDate,
          caseId: t.caseId,
          status: t.status,
          priority: t.priority,
        })),
        deadlinesQuery.data?.map((d) => ({
          id: d.id,
          caseId: d.caseId,
          caseName: d.caseName,
          title: d.title,
          dueDate: d.dueDate,
          source: d.source as "rule_generated" | "manual",
          completedAt: d.completedAt,
        })),
      ),
    [rawEvents, tasksQuery.data, deadlinesQuery.data],
  );

  const activeEventsQuery = caseId ? caseEventsQuery : globalEventsQuery;

  return {
    items,
    isLoading: activeEventsQuery.isLoading || tasksQuery.isLoading || deadlinesQuery.isLoading,
    error: activeEventsQuery.error ?? tasksQuery.error ?? deadlinesQuery.error,
    refetch: () => {
      activeEventsQuery.refetch();
      tasksQuery.refetch();
      deadlinesQuery.refetch();
    },
  };
}
