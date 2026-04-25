"use client";

import { useCallback, useMemo, useState } from "react";

export type DateRangePreset = "30" | "90" | "180" | "365" | "custom";

export interface UseDateRangeResult {
  startDate: Date;
  endDate: Date;
  preset: DateRangePreset;
  customStart: Date | null;
  customEnd: Date | null;
  setPreset: (p: DateRangePreset) => void;
  setCustom: (start: Date, end: Date) => void;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function todayUTC(): Date {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

export function useDateRange(initial: DateRangePreset = "90"): UseDateRangeResult {
  const [preset, setPresetState] = useState<DateRangePreset>(initial);
  const [customStart, setCustomStart] = useState<Date | null>(null);
  const [customEnd, setCustomEnd] = useState<Date | null>(null);

  const setPreset = useCallback((p: DateRangePreset) => {
    setPresetState(p);
  }, []);

  const setCustom = useCallback((start: Date, end: Date) => {
    setCustomStart(start);
    setCustomEnd(end);
    setPresetState("custom");
  }, []);

  const { startDate, endDate } = useMemo(() => {
    if (preset === "custom" && customStart && customEnd) {
      return { startDate: customStart, endDate: customEnd };
    }
    const days = preset === "custom" ? 90 : Number(preset);
    return { startDate: daysAgo(days), endDate: todayUTC() };
  }, [preset, customStart, customEnd]);

  return { startDate, endDate, preset, customStart, customEnd, setPreset, setCustom };
}
