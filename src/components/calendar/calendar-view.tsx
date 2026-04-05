// src/components/calendar/calendar-view.tsx
"use client";

// This file MUST stay minimal. `next/dynamic` only creates a separate chunk
// when it wraps a module via `() => import("...")`. Inlining the component or
// using `Promise.resolve(Component)` would re-introduce react-big-calendar +
// its CSS into every bundle that imports CalendarView.
import dynamic from "next/dynamic";

export type { CalendarViewProps } from "./calendar-view-inner";

export const CalendarView = dynamic(() => import("./calendar-view-inner"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-zinc-500">
      Loading calendar…
    </div>
  ),
});
