"use client";

import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";

type StatusFilter = "new" | "reviewing" | "accepted" | "declined" | "spam" | "all";

const STATUS_LABEL: Record<StatusFilter, string> = {
  new: "New",
  reviewing: "Reviewing",
  accepted: "Accepted",
  declined: "Declined",
  spam: "Spam",
  all: "All",
};

function statusBadge(status: string) {
  switch (status) {
    case "new":
      return <Badge variant="default">New</Badge>;
    case "reviewing":
      return <Badge variant="secondary">Reviewing</Badge>;
    case "accepted":
      return <Badge>Accepted</Badge>;
    case "declined":
      return <Badge variant="outline">Declined</Badge>;
    case "spam":
      return <Badge variant="destructive">Spam</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function IntakeInboxPage() {
  const [status, setStatus] = React.useState<StatusFilter>("new");
  const [templateId, setTemplateId] = React.useState<string | undefined>(undefined);

  const { data: templates } = trpc.publicIntake.templates.list.useQuery();
  const { data, isLoading } = trpc.publicIntake.submissions.list.useQuery({
    status: status === "all" ? undefined : status,
    templateId,
    limit: 100,
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Intake inbox</h1>
          <p className="text-sm text-zinc-500">Public form submissions awaiting review.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <TabsList>
            {(Object.keys(STATUS_LABEL) as StatusFilter[]).map((s) => (
              <TabsTrigger key={s} value={s}>{STATUS_LABEL[s]}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {templates && templates.length > 0 && (
          <select
            value={templateId ?? ""}
            onChange={(e) => setTemplateId(e.target.value || undefined)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">All templates</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : data && data.length > 0 ? (
        <div className="rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Submitted</th>
                <th className="px-4 py-2 text-left font-medium">Template</th>
                <th className="px-4 py-2 text-left font-medium">Name</th>
                <th className="px-4 py-2 text-left font-medium">Email</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className="border-b border-zinc-100 dark:border-zinc-800/60 hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                  <td className="px-4 py-2 text-zinc-500">
                    <Link href={`/intake-inbox/${s.id}`} className="hover:underline">
                      {new Date(s.submittedAt).toLocaleString()}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{s.templateName}</td>
                  <td className="px-4 py-2 font-medium">{s.submitterName ?? "—"}</td>
                  <td className="px-4 py-2 text-zinc-500">{s.submitterEmail ?? "—"}</td>
                  <td className="px-4 py-2">{statusBadge(s.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
          No submissions {status !== "all" ? `with status "${status}"` : "yet"}.
        </div>
      )}
    </div>
  );
}
