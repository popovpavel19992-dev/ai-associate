"use client";

import { ACTIVITY_LABELS, ACTIVITY_COLORS, type ActivityType } from "@/lib/billing";

export function ActivityBadge({ type }: { type: ActivityType }) {
  const { bg, text } = ACTIVITY_COLORS[type];
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${bg} ${text}`}
    >
      {ACTIVITY_LABELS[type]}
    </span>
  );
}
