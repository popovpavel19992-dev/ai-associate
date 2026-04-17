// src/components/research/filter-chips.tsx
"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  COURT_LEVEL_LABELS,
  JURISDICTION_LABELS,
  type CourtLevel,
  type Jurisdiction,
  type ResearchFilters,
} from "./filter-types";

export interface FilterChipsProps {
  filters: ResearchFilters;
  onRemove: (key: keyof ResearchFilters, value?: string) => void;
  className?: string;
}

interface ChipProps {
  label: string;
  onRemove: () => void;
  ariaLabel: string;
}

function Chip({ label, onRemove, ariaLabel }: ChipProps) {
  return (
    <Badge variant="secondary" className="gap-1 pr-1">
      <span>{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={ariaLabel}
        className="inline-flex size-4 items-center justify-center rounded-full hover:bg-muted-foreground/20"
      >
        <X className="size-3" aria-hidden />
      </button>
    </Badge>
  );
}

function formatDateRange(
  fromYear: number | undefined,
  toYear: number | undefined,
): string {
  if (fromYear && toYear) return `${fromYear} – ${toYear}`;
  if (fromYear) return `from ${fromYear}`;
  if (toYear) return `to ${toYear}`;
  return "";
}

export function FilterChips({ filters, onRemove, className }: FilterChipsProps) {
  const chips: React.ReactNode[] = [];

  for (const j of filters.jurisdictions ?? []) {
    chips.push(
      <Chip
        key={`j-${j}`}
        label={JURISDICTION_LABELS[j as Jurisdiction] ?? j}
        onRemove={() => onRemove("jurisdictions", j)}
        ariaLabel={`Remove ${JURISDICTION_LABELS[j as Jurisdiction] ?? j} jurisdiction filter`}
      />,
    );
  }

  for (const c of filters.courtLevels ?? []) {
    chips.push(
      <Chip
        key={`c-${c}`}
        label={COURT_LEVEL_LABELS[c as CourtLevel] ?? c}
        onRemove={() => onRemove("courtLevels", c)}
        ariaLabel={`Remove ${COURT_LEVEL_LABELS[c as CourtLevel] ?? c} court level filter`}
      />,
    );
  }

  const rangeLabel = formatDateRange(filters.fromYear, filters.toYear);
  if (rangeLabel) {
    chips.push(
      <Chip
        key="date-range"
        label={rangeLabel}
        onRemove={() => onRemove("fromYear")}
        ariaLabel="Remove date range filter"
      />,
    );
  }

  if (filters.courtName && filters.courtName.trim().length > 0) {
    chips.push(
      <Chip
        key="court-name"
        label={`Court: ${filters.courtName}`}
        onRemove={() => onRemove("courtName")}
        ariaLabel="Remove court name filter"
      />,
    );
  }

  if (chips.length === 0) return null;

  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`.trim()}
    >
      {chips}
    </div>
  );
}
