// src/components/clients/comms/comms-filter-bar.tsx
"use client";

import type { CommEventKind } from "@/server/services/client-comms/aggregator";
import { Button } from "@/components/ui/button";

const KIND_OPTIONS: Array<{ value: CommEventKind; label: string }> = [
  { value: "email_outbound", label: "Email out" },
  { value: "email_reply", label: "Email reply" },
  { value: "email_auto_reply", label: "Auto-reply" },
  { value: "signature_request", label: "Signature req" },
  { value: "signature_completed", label: "Signature done" },
  { value: "drip_enrolled", label: "Drip enrolled" },
  { value: "drip_cancelled", label: "Drip cancelled" },
  { value: "demand_letter_sent", label: "Demand sent" },
  { value: "demand_letter_response", label: "Demand response" },
  { value: "case_message", label: "Case message" },
  { value: "document_request", label: "Doc request" },
  { value: "document_response", label: "Doc response" },
  { value: "intake_submitted", label: "Intake form" },
  { value: "mediation_scheduled", label: "Mediation sched" },
  { value: "mediation_completed", label: "Mediation done" },
  { value: "settlement_offer", label: "Settlement" },
];

export interface CommsFilterState {
  kinds: CommEventKind[];
  caseId: string | "";
  direction: "" | "inbound" | "outbound" | "internal";
  startDate: string;
  endDate: string;
  groupBy: "chrono" | "case" | "type";
}

export const DEFAULT_FILTERS: CommsFilterState = {
  kinds: [],
  caseId: "",
  direction: "",
  startDate: "",
  endDate: "",
  groupBy: "chrono",
};

interface Props {
  value: CommsFilterState;
  onChange: (next: CommsFilterState) => void;
  cases: Array<{ id: string; name: string }>;
}

export function CommsFilterBar({ value, onChange, cases }: Props) {
  const toggleKind = (k: CommEventKind) => {
    const next = value.kinds.includes(k) ? value.kinds.filter((x) => x !== k) : [...value.kinds, k];
    onChange({ ...value, kinds: next });
  };
  return (
    <div className="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-zinc-600 dark:text-zinc-400">View:</span>
        {(["chrono", "case", "type"] as const).map((g) => (
          <Button
            key={g}
            type="button"
            size="sm"
            variant={value.groupBy === g ? "default" : "outline"}
            onClick={() => onChange({ ...value, groupBy: g })}
          >
            {g === "chrono" ? "Chronological" : g === "case" ? "By case" : "By type"}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-zinc-600 dark:text-zinc-400">Direction:</span>
        {([
          ["", "All"],
          ["inbound", "Inbound"],
          ["outbound", "Outbound"],
          ["internal", "Internal"],
        ] as const).map(([v, label]) => (
          <Button
            key={v}
            type="button"
            size="sm"
            variant={value.direction === v ? "default" : "outline"}
            onClick={() => onChange({ ...value, direction: v as CommsFilterState["direction"] })}
          >
            {label}
          </Button>
        ))}
        <select
          className="ml-auto rounded border border-zinc-300 bg-transparent px-2 py-1 text-xs dark:border-zinc-700"
          value={value.caseId}
          onChange={(e) => onChange({ ...value, caseId: e.target.value })}
        >
          <option value="">All cases</option>
          {cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="rounded border border-zinc-300 bg-transparent px-2 py-1 text-xs dark:border-zinc-700"
          value={value.startDate}
          onChange={(e) => onChange({ ...value, startDate: e.target.value })}
        />
        <input
          type="date"
          className="rounded border border-zinc-300 bg-transparent px-2 py-1 text-xs dark:border-zinc-700"
          value={value.endDate}
          onChange={(e) => onChange({ ...value, endDate: e.target.value })}
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {KIND_OPTIONS.map((k) => {
          const active = value.kinds.includes(k.value);
          return (
            <button
              key={k.value}
              type="button"
              onClick={() => toggleKind(k.value)}
              className={
                "rounded-full border px-2 py-0.5 text-[11px] " +
                (active
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800")
              }
            >
              {k.label}
            </button>
          );
        })}
        {value.kinds.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange({ ...value, kinds: [] })}
            className="text-[11px] text-zinc-500 underline"
          >
            Clear types
          </button>
        ) : null}
      </div>
    </div>
  );
}
