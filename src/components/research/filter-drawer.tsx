// src/components/research/filter-drawer.tsx
"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import {
  ALL_COURT_LEVELS,
  ALL_JURISDICTIONS,
  COURT_LEVEL_LABELS,
  JURISDICTION_LABELS,
  type CourtLevel,
  type Jurisdiction,
  type ResearchFilters,
} from "./filter-types";

export interface FilterDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: ResearchFilters;
  onApply: (filters: ResearchFilters) => void;
  onClear: () => void;
}

function toggleInArray<T extends string>(arr: T[] | undefined, value: T): T[] {
  const set = new Set(arr ?? []);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return Array.from(set);
}

function parseYearInput(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const int = Math.trunc(n);
  if (int < 1900 || int > 2100) return undefined;
  return int;
}

export function FilterDrawer({
  open,
  onOpenChange,
  filters,
  onApply,
  onClear,
}: FilterDrawerProps) {
  const [working, setWorking] = React.useState<ResearchFilters>(filters);

  // Keep working copy in sync when drawer opens or parent filters change.
  React.useEffect(() => {
    if (open) setWorking(filters);
  }, [open, filters]);

  const currentYear = new Date().getFullYear();

  const toggleJurisdiction = (j: Jurisdiction) => {
    setWorking((w) => {
      const next = toggleInArray(w.jurisdictions, j);
      return { ...w, jurisdictions: next.length ? (next as Jurisdiction[]) : undefined };
    });
  };

  const toggleCourtLevel = (c: CourtLevel) => {
    setWorking((w) => {
      const next = toggleInArray(w.courtLevels, c);
      return { ...w, courtLevels: next.length ? (next as CourtLevel[]) : undefined };
    });
  };

  const setPresetLastN = (n: number) => {
    setWorking((w) => ({ ...w, fromYear: currentYear - n, toYear: currentYear }));
  };

  const setPresetAllTime = () => {
    setWorking((w) => ({ ...w, fromYear: undefined, toYear: undefined }));
  };

  const handleApply = () => {
    onApply(working);
    onOpenChange(false);
  };

  const handleClear = () => {
    setWorking({});
    onClear();
    onOpenChange(false);
  };

  const isJurisdictionOn = (j: Jurisdiction) =>
    (working.jurisdictions ?? []).includes(j);
  const isCourtLevelOn = (c: CourtLevel) =>
    (working.courtLevels ?? []).includes(c);

  return (
    <Sheet open={open} onOpenChange={(next) => onOpenChange(next)}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>
            Narrow your case law search by jurisdiction, court level, and date.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4">
          <section className="space-y-2">
            <Label className="text-sm font-medium">Jurisdictions</Label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_JURISDICTIONS.map((j) => (
                <Button
                  key={j}
                  type="button"
                  size="sm"
                  variant={isJurisdictionOn(j) ? "default" : "outline"}
                  onClick={() => toggleJurisdiction(j)}
                  aria-pressed={isJurisdictionOn(j)}
                >
                  {JURISDICTION_LABELS[j]}
                </Button>
              ))}
            </div>
          </section>

          <Separator className="my-4" />

          <section className="space-y-2">
            <Label className="text-sm font-medium">Court level</Label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_COURT_LEVELS.map((c) => (
                <Button
                  key={c}
                  type="button"
                  size="sm"
                  variant={isCourtLevelOn(c) ? "default" : "outline"}
                  onClick={() => toggleCourtLevel(c)}
                  aria-pressed={isCourtLevelOn(c)}
                >
                  {COURT_LEVEL_LABELS[c]}
                </Button>
              ))}
            </div>
          </section>

          <Separator className="my-4" />

          <section className="space-y-2">
            <Label className="text-sm font-medium">Date range</Label>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPresetLastN(5)}
              >
                Last 5 years
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPresetLastN(10)}
              >
                Last 10 years
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={setPresetAllTime}
              >
                All time
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <div className="space-y-1">
                <Label htmlFor="from-year" className="text-xs text-muted-foreground">
                  From year
                </Label>
                <Input
                  id="from-year"
                  type="number"
                  inputMode="numeric"
                  min={1900}
                  max={2100}
                  placeholder="1900"
                  value={working.fromYear ?? ""}
                  onChange={(e) =>
                    setWorking((w) => ({ ...w, fromYear: parseYearInput(e.target.value) }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="to-year" className="text-xs text-muted-foreground">
                  To year
                </Label>
                <Input
                  id="to-year"
                  type="number"
                  inputMode="numeric"
                  min={1900}
                  max={2100}
                  placeholder={String(currentYear)}
                  value={working.toYear ?? ""}
                  onChange={(e) =>
                    setWorking((w) => ({ ...w, toYear: parseYearInput(e.target.value) }))
                  }
                />
              </div>
            </div>
          </section>

          <Separator className="my-4" />

          <section className="space-y-2 pb-4">
            <Label htmlFor="court-name" className="text-sm font-medium">
              Court name
            </Label>
            <Input
              id="court-name"
              type="text"
              maxLength={200}
              placeholder="e.g. Ninth Circuit"
              value={working.courtName ?? ""}
              onChange={(e) =>
                setWorking((w) => ({
                  ...w,
                  courtName: e.target.value.length ? e.target.value : undefined,
                }))
              }
            />
          </section>
        </div>

        <SheetFooter className="flex-row justify-between gap-2 border-t">
          <Button type="button" variant="ghost" onClick={handleClear}>
            Clear all
          </Button>
          <Button type="button" onClick={handleApply}>
            Apply
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
