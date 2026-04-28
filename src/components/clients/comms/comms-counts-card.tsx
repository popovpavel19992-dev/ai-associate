// src/components/clients/comms/comms-counts-card.tsx
"use client";

import type { CommEventKind } from "@/server/services/client-comms/aggregator";

const KIND_LABEL: Record<CommEventKind, string> = {
  email_outbound: "Outbound emails",
  email_reply: "Email replies",
  email_auto_reply: "Auto-replies",
  signature_request: "Signature requests",
  signature_completed: "Signatures completed",
  drip_enrolled: "Drip enrollments",
  drip_cancelled: "Drips cancelled",
  demand_letter_sent: "Demand letters sent",
  demand_letter_response: "Demand responses",
  case_message: "Case messages",
  document_request: "Document requests",
  document_response: "Document responses",
  intake_submitted: "Intake forms",
  mediation_scheduled: "Mediations scheduled",
  mediation_completed: "Mediations completed",
  settlement_offer: "Settlement offers",
};

export function CommsCountsCard({
  counts,
}: {
  counts: {
    total: number;
    byDirection: { inbound: number; outbound: number; internal: number };
    byKind: Partial<Record<CommEventKind, number>>;
  };
}) {
  return (
    <div className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span className="text-2xl font-semibold">{counts.total}</span>
        <span className="text-zinc-600 dark:text-zinc-400">events total</span>
        <span className="text-emerald-700 dark:text-emerald-400">↑ {counts.byDirection.outbound} outbound</span>
        <span className="text-blue-700 dark:text-blue-400">↓ {counts.byDirection.inbound} inbound</span>
        <span className="text-zinc-500">{counts.byDirection.internal} internal</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        {(Object.entries(counts.byKind) as Array<[CommEventKind, number]>)
          .filter(([, n]) => n > 0)
          .sort((a, b) => b[1] - a[1])
          .map(([kind, n]) => (
            <span key={kind}>
              {KIND_LABEL[kind]}: <span className="font-medium text-zinc-700 dark:text-zinc-300">{n}</span>
            </span>
          ))}
      </div>
    </div>
  );
}
