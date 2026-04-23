// src/server/services/deadlines/compute.ts

export function isBusinessDay(d: Date, holidays: Set<string>): boolean {
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  const iso = d.toISOString().slice(0, 10);
  return !holidays.has(iso);
}

export function addBusinessDays(from: Date, count: number, holidays: Set<string>): Date {
  const d = new Date(from);
  if (count === 0) return d;
  const direction = count > 0 ? 1 : -1;
  let remaining = Math.abs(count);
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + direction);
    if (isBusinessDay(d, holidays)) remaining--;
  }
  return d;
}

export interface ComputeInput {
  triggerDate: Date;
  days: number;
  dayType: "calendar" | "court";
  shiftIfHoliday: boolean;
  holidays: Set<string>;
  holidayNames?: Map<string, string>;
}

export interface ComputeResult {
  dueDate: Date;
  raw: Date;
  shiftedReason: string | null;
}

export function computeDeadlineDate(input: ComputeInput): ComputeResult {
  let raw: Date;

  if (input.dayType === "court") {
    raw = addBusinessDays(input.triggerDate, input.days, input.holidays);
    return { dueDate: new Date(raw), raw, shiftedReason: null };
  }

  raw = new Date(input.triggerDate);
  raw.setUTCDate(raw.getUTCDate() + input.days);

  if (!input.shiftIfHoliday) {
    return { dueDate: new Date(raw), raw, shiftedReason: null };
  }

  const dueDate = new Date(raw);
  let shiftedReason: string | null = null;
  while (!isBusinessDay(dueDate, input.holidays)) {
    const iso = dueDate.toISOString().slice(0, 10);
    const day = dueDate.getUTCDay();
    if (day === 0 || day === 6) {
      shiftedReason = shiftedReason ?? "weekend";
    } else {
      const name = input.holidayNames?.get(iso) ?? "holiday";
      shiftedReason = shiftedReason ?? `holiday:${name}`;
    }
    dueDate.setUTCDate(dueDate.getUTCDate() + 1);
  }

  return { dueDate, raw, shiftedReason };
}
