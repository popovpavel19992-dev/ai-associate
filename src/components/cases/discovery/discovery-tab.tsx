"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  NewDiscoveryWizard,
  type DiscoveryRequestType,
} from "./new-discovery-wizard";

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  final: "bg-blue-100 text-blue-800",
  served: "bg-green-100 text-green-800",
  closed: "bg-zinc-100 text-zinc-700",
};

export function DiscoveryTab({ caseId }: { caseId: string }) {
  const [wizardType, setWizardType] = useState<DiscoveryRequestType | null>(null);
  const { data: requests, isLoading } = trpc.discovery.listForCase.useQuery({ caseId });

  const grouped = (requests ?? []).reduce<Record<string, typeof requests>>((acc, r) => {
    const key = r.requestType;
    if (!acc[key]) acc[key] = [] as unknown as typeof requests;
    (acc[key] as unknown as typeof r[]).push(r);
    return acc;
  }, {} as Record<string, typeof requests>);

  // Ensure both sections render even when empty.
  if (!grouped.interrogatories) {
    grouped.interrogatories = [] as unknown as typeof requests;
  }
  if (!grouped.rfp) {
    grouped.rfp = [] as unknown as typeof requests;
  }

  const sectionLabel = (key: string) => {
    if (key === "interrogatories") return "Interrogatories";
    if (key === "rfp") return "Requests for Production";
    if (key === "rfa") return "Requests for Admission";
    return key;
  };

  return (
    <div className="space-y-6 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Discovery</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setWizardType("interrogatories")}
            className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            New Interrogatory Set
          </button>
          <button
            type="button"
            onClick={() => setWizardType("rfp")}
            className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            New Request for Production
          </button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}

      {Object.keys(grouped)
        .sort()
        .map((typeKey) => {
          const list = (grouped[typeKey] ?? []) as unknown as NonNullable<typeof requests>;
          const sorted = [...list].sort((a, b) => a.setNumber - b.setNumber);
          return (
            <section key={typeKey} className="space-y-2">
              <h3 className="text-sm font-semibold text-zinc-300">{sectionLabel(typeKey)}</h3>
              {sorted.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No {sectionLabel(typeKey).toLowerCase()} yet.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
                  {sorted.map((r) => {
                    const count = Array.isArray(r.questions) ? r.questions.length : 0;
                    return (
                      <li key={r.id} className="hover:bg-zinc-900/40">
                        <Link
                          href={`/cases/${caseId}/discovery/${r.id}`}
                          className="block p-4"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{r.title}</span>
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                STATUS_BADGE[r.status] ?? "bg-gray-100 text-gray-800"
                              }`}
                            >
                              {r.status}
                            </span>
                          </div>
                          <div className="mt-1 flex gap-3 text-xs text-gray-500">
                            <span>Set {r.setNumber}</span>
                            <span>{count} question{count === 1 ? "" : "s"}</span>
                            <span>Created {new Date(r.createdAt).toLocaleDateString()}</span>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}

      {wizardType && (
        <NewDiscoveryWizard
          caseId={caseId}
          requestType={wizardType}
          onClose={() => setWizardType(null)}
        />
      )}
    </div>
  );
}
