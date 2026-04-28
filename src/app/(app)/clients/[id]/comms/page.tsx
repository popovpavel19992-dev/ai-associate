// src/app/(app)/clients/[id]/comms/page.tsx
"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { CommEventRow } from "@/components/clients/comms/comm-event-row";
import { CommsCountsCard } from "@/components/clients/comms/comms-counts-card";
import {
  CommsFilterBar,
  DEFAULT_FILTERS,
  type CommsFilterState,
} from "@/components/clients/comms/comms-filter-bar";
import type { CommEvent } from "@/server/services/client-comms/aggregator";

const PAGE_SIZE = 50;

export default function ClientCommsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = use(params);
  const [filters, setFilters] = useState<CommsFilterState>(DEFAULT_FILTERS);
  const [offset, setOffset] = useState(0);

  const clientQ = trpc.clients.getById.useQuery({ id: clientId });
  const casesQ = trpc.clients.getCases.useQuery({ clientId });

  const queryInput = useMemo(() => {
    const startDate = filters.startDate ? new Date(filters.startDate) : undefined;
    const endDate = filters.endDate ? new Date(filters.endDate + "T23:59:59") : undefined;
    return {
      clientId,
      startDate,
      endDate,
      kinds: filters.kinds.length ? filters.kinds : undefined,
      caseId: filters.caseId || undefined,
      direction: filters.direction || undefined,
      limit: PAGE_SIZE,
      offset,
    };
  }, [clientId, filters, offset]);

  const timelineQ = trpc.clientComms.getTimeline.useQuery(queryInput);

  if (clientQ.isLoading) return <div className="p-6 text-sm text-zinc-500">Loading…</div>;
  const clientName = clientQ.data?.client.displayName ?? "Client";
  const cases = casesQ.data?.cases ?? [];
  const result = timelineQ.data;
  const events = result?.events ?? [];
  const counts = result?.counts ?? {
    total: 0,
    byDirection: { inbound: 0, outbound: 0, internal: 0 },
    byKind: {},
  };

  const grouped = useMemo(() => {
    if (filters.groupBy === "chrono") return null;
    const by = new Map<string, CommEvent[]>();
    for (const e of events) {
      const key = filters.groupBy === "case" ? e.caseName || "Unknown case" : e.kind;
      const arr = by.get(key) ?? [];
      arr.push(e);
      by.set(key, arr);
    }
    return Array.from(by.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [events, filters.groupBy]);

  const handleFiltersChange = (next: CommsFilterState) => {
    setOffset(0);
    setFilters(next);
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/clients/${clientId}`}
            className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <ChevronLeft className="h-3 w-3" /> Back to client
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{clientName} — Comms</h1>
          <p className="text-xs text-zinc-500">Unified timeline across all cases for this client.</p>
        </div>
      </div>

      <CommsCountsCard counts={counts} />
      <CommsFilterBar value={filters} onChange={handleFiltersChange} cases={cases} />

      {timelineQ.isLoading ? (
        <p className="text-sm text-zinc-500">Loading timeline…</p>
      ) : events.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No events match these filters.
        </p>
      ) : grouped ? (
        <div className="space-y-4">
          {grouped.map(([group, items]) => (
            <section key={group}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {group} <span className="font-normal text-zinc-400">({items.length})</span>
              </h3>
              <ul className="space-y-2">
                {items.map((e) => (
                  <CommEventRow key={e.id} event={e} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => (
            <CommEventRow key={e.id} event={e} />
          ))}
        </ul>
      )}

      {result && result.total > PAGE_SIZE ? (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>
            Showing {offset + 1}–{Math.min(offset + events.length, result.total)} of {result.total}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={offset + PAGE_SIZE >= result.total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
