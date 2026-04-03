"use client";

import { PRACTICE_AREAS, PRACTICE_AREA_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface StepPracticeAreasProps {
  selected: string[];
  onChange: (areas: string[]) => void;
}

export function StepPracticeAreas({
  selected,
  onChange,
}: StepPracticeAreasProps) {
  const toggle = (area: string) => {
    onChange(
      selected.includes(area)
        ? selected.filter((a) => a !== area)
        : [...selected, area],
    );
  };

  return (
    <div>
      <h2 className="text-lg font-semibold">What are your practice areas?</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Select all that apply. This helps us customize your analysis templates.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {PRACTICE_AREAS.map((area) => (
          <button
            key={area}
            type="button"
            onClick={() => toggle(area)}
            className={cn(
              "rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors",
              selected.includes(area)
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "border-zinc-200 text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500",
            )}
          >
            {PRACTICE_AREA_LABELS[area]}
          </button>
        ))}
      </div>
    </div>
  );
}
