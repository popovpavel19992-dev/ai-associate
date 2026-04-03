"use client";

import { CASE_TYPES, CASE_TYPE_LABELS } from "@/lib/constants";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface StepCaseTypesProps {
  selected: string[];
  tosAccepted: boolean;
  onChange: (types: string[]) => void;
  onTosChange: (accepted: boolean) => void;
}

export function StepCaseTypes({
  selected,
  tosAccepted,
  onChange,
  onTosChange,
}: StepCaseTypesProps) {
  const toggle = (type: string) => {
    onChange(
      selected.includes(type)
        ? selected.filter((t) => t !== type)
        : [...selected, type],
    );
  };

  return (
    <div>
      <h2 className="text-lg font-semibold">What types of cases do you handle?</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Select the case types you work with most often.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3">
        {CASE_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => toggle(type)}
            className={cn(
              "rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors",
              selected.includes(type)
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "border-zinc-200 text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500",
            )}
          >
            {CASE_TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      <div className="mt-8">
        <Label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={tosAccepted}
            onChange={(e) => onTosChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-zinc-300"
          />
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            I understand that ClearTerms provides AI-generated analysis for
            informational purposes only. It does not constitute legal advice,
            and I am responsible for independently verifying all output before
            relying on it in any legal matter.
          </span>
        </Label>
      </div>
    </div>
  );
}
