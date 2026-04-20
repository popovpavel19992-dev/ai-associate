"use client";

import { trpc } from "@/lib/trpc";
import { format } from "date-fns";

const CATEGORY_DOT: Record<string, string> = {
  filing: "bg-blue-500",
  discovery: "bg-purple-500",
  hearing: "bg-amber-500",
  settlement: "bg-green-500",
  communication: "bg-gray-400",
  other: "bg-slate-400",
};

const CATEGORY_LABEL: Record<string, string> = {
  filing: "Filing",
  discovery: "Discovery",
  hearing: "Hearing",
  settlement: "Settlement",
  communication: "Communication",
  other: "Other",
};

export function CaseUpdatesTimeline({ caseId }: { caseId: string }) {
  const { data } = trpc.portalMilestones.list.useQuery({ caseId });
  const milestones = data?.milestones ?? [];

  return (
    <section className="mb-6">
      <h2 className="text-lg font-semibold mb-3">Case Updates</h2>
      {milestones.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          Updates from your lawyer will appear here.
        </p>
      ) : (
        <ol className="relative border-l-2 border-muted pl-6 space-y-4">
          {milestones.map((m) => {
            const isRetracted = m.status === "retracted";
            return (
              <li key={m.id} className="relative">
                <span
                  className={`absolute -left-[31px] top-1 w-4 h-4 rounded-full border-2 border-background ${CATEGORY_DOT[m.category] ?? "bg-slate-400"}`}
                  aria-hidden
                />
                <div className={`border rounded p-3 ${isRetracted ? "opacity-60" : ""}`}>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="uppercase tracking-wide">{format(new Date(m.occurredAt), "MMM d, yyyy")}</span>
                    <span>·</span>
                    <span>{CATEGORY_LABEL[m.category] ?? m.category}</span>
                  </div>
                  <h3 className={`text-base font-medium mt-1 ${isRetracted ? "line-through" : ""}`}>
                    {m.title}
                  </h3>
                  {!isRetracted && m.description && (
                    <p className="text-sm mt-1 whitespace-pre-wrap">{m.description}</p>
                  )}
                  {isRetracted && (
                    <p className="text-sm text-red-700 mt-1">
                      This update was retracted{m.retractedReason ? `: ${m.retractedReason}` : "."}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
