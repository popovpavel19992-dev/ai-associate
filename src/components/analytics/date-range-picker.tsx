"use client";

import type { DateRangePreset, UseDateRangeResult } from "./use-date-range";

const PRESET_OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "180", label: "Last 180 days" },
  { value: "365", label: "Last 365 days" },
  { value: "custom", label: "Custom range" },
];

function toInputValue(d: Date | null): string {
  if (!d) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DateRangePicker({ range }: { range: UseDateRangeResult }) {
  const { preset, setPreset, setCustom, customStart, customEnd } = range;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={preset}
        onChange={(e) => setPreset(e.target.value as DateRangePreset)}
        className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-950"
      >
        {PRESET_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {preset === "custom" && (
        <>
          <input
            type="date"
            value={toInputValue(customStart)}
            onChange={(e) => {
              const start = new Date(e.target.value + "T00:00:00.000Z");
              const end = customEnd ?? new Date();
              setCustom(start, end);
            }}
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-950"
          />
          <span className="text-sm text-zinc-500">to</span>
          <input
            type="date"
            value={toInputValue(customEnd)}
            onChange={(e) => {
              const end = new Date(e.target.value + "T23:59:59.999Z");
              const start = customStart ?? new Date();
              setCustom(start, end);
            }}
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-950"
          />
        </>
      )}
    </div>
  );
}
