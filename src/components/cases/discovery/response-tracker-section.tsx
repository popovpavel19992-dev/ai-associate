"use client";

// src/components/cases/discovery/response-tracker-section.tsx
//
// Lawyer-side tracker for opposing-party Discovery responses (3.1.4).
// Renders only when the parent request is served+. Lets the lawyer:
//   * issue a magic-link to opposing counsel
//   * see a list of issued tokens
//   * inline-view received responses alongside the questions
//   * trigger the AI summary
//   * download the formal "Responses to..." PDF
//   * manually flip status to responses_received

import * as React from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { DiscoveryQuestion } from "@/server/db/schema/case-discovery-requests";
import type { ResponseType } from "@/server/db/schema/discovery-responses";

const STATUS_BADGE: Record<string, string> = {
  admit: "bg-green-100 text-green-800",
  deny: "bg-red-100 text-red-800",
  object: "bg-yellow-100 text-yellow-800",
  lack_of_knowledge: "bg-gray-100 text-gray-800",
  written_response: "bg-blue-100 text-blue-800",
  produced_documents: "bg-blue-100 text-blue-800",
};

export function ResponseTrackerSection({
  requestId,
  status,
  questions,
}: {
  requestId: string;
  status: string;
  questions: DiscoveryQuestion[];
}) {
  const utils = trpc.useUtils();

  const tokensList = trpc.discoveryResponses.tokens.list.useQuery({ requestId });
  const responsesList = trpc.discoveryResponses.responses.listForRequest.useQuery({
    requestId,
  });

  const generate = trpc.discoveryResponses.tokens.generate.useMutation();
  const revoke = trpc.discoveryResponses.tokens.revoke.useMutation();
  const aiSummary = trpc.discoveryResponses.responses.aiSummarize.useMutation();
  const markReceived = trpc.discoveryResponses.responses.markReceived.useMutation();

  const [showGenerate, setShowGenerate] = React.useState(false);
  const [opposingEmail, setOpposingEmail] = React.useState("");
  const [opposingName, setOpposingName] = React.useState("");
  const [expiresInDays, setExpiresInDays] = React.useState<number>(60);
  const [latestUrl, setLatestUrl] = React.useState<string | null>(null);
  const [summaryText, setSummaryText] = React.useState<string | null>(null);

  if (status !== "served" && status !== "responses_received" && status !== "overdue") {
    return null;
  }

  async function onGenerate() {
    if (!opposingEmail) {
      toast.error("Email required");
      return;
    }
    try {
      const res = await generate.mutateAsync({
        requestId,
        opposingEmail,
        opposingName: opposingName || undefined,
        expiresInDays,
      });
      setLatestUrl(res.tokenUrl);
      toast.success("Response link generated");
      tokensList.refetch();
      utils.discoveryResponses.tokens.list.invalidate({ requestId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  async function onRevoke(tokenId: string) {
    if (!confirm("Revoke this response link?")) return;
    await revoke.mutateAsync({ tokenId, requestId });
    toast.success("Token revoked");
    tokensList.refetch();
  }

  async function onAiSummary() {
    setSummaryText(null);
    try {
      const res = await aiSummary.mutateAsync({ requestId });
      setSummaryText(res.summary);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI summary failed");
    }
  }

  async function onMarkReceived() {
    await markReceived.mutateAsync({ requestId });
    toast.success("Status flipped to responses_received");
    utils.discovery.get.invalidate({ requestId });
  }

  const responsesByQ = React.useMemo(() => {
    const map = new Map<number, NonNullable<typeof responsesList.data>[number][]>();
    for (const r of responsesList.data ?? []) {
      const arr = map.get(r.questionIndex) ?? [];
      arr.push(r);
      map.set(r.questionIndex, arr);
    }
    return map;
  }, [responsesList.data]);

  return (
    <section className="rounded-md border border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Response tracker</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowGenerate(true)}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900"
          >
            Generate response link
          </button>
          <a
            href={`/api/discovery-responses/internal/${requestId}/pdf`}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900"
          >
            Download responses PDF
          </a>
          <button
            type="button"
            onClick={onAiSummary}
            disabled={aiSummary.isPending || (responsesList.data?.length ?? 0) === 0}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900 disabled:opacity-50"
          >
            {aiSummary.isPending ? "Summarizing…" : "Summarize with AI"}
          </button>
          {status === "served" ? (
            <button
              type="button"
              onClick={onMarkReceived}
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900"
            >
              Mark received
            </button>
          ) : null}
        </div>
      </div>

      {summaryText ? (
        <div className="mb-4 rounded-md border border-blue-700 bg-blue-950/40 p-3 text-sm">
          <div className="mb-1 font-semibold">AI summary</div>
          <p className="whitespace-pre-wrap">{summaryText}</p>
        </div>
      ) : null}

      {/* Issued tokens */}
      <div className="mb-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Issued response links
        </div>
        {tokensList.data && tokensList.data.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {tokensList.data.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between rounded border border-zinc-800 px-2 py-1"
              >
                <span>
                  {t.opposingPartyName ? `${t.opposingPartyName} <${t.opposingPartyEmail}>` : t.opposingPartyEmail}
                  {t.revokedAt ? (
                    <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">
                      revoked
                    </span>
                  ) : null}
                </span>
                {!t.revokedAt && (
                  <button
                    type="button"
                    onClick={() => onRevoke(t.id)}
                    className="text-xs text-red-400 hover:underline"
                  >
                    revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">No links issued yet.</p>
        )}
      </div>

      {/* Inline responses */}
      <div className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Responses received
        </div>
        {questions.map((q, idx) => {
          const rs = responsesByQ.get(idx) ?? [];
          return (
            <div
              key={idx}
              className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-sm"
            >
              <div className="mb-1 font-semibold">No. {q.number ?? idx + 1}</div>
              <p className="mb-2 whitespace-pre-wrap text-zinc-300">{q.text}</p>
              {rs.length === 0 ? (
                <p className="text-xs italic text-zinc-500">No response yet.</p>
              ) : (
                <ul className="space-y-2">
                  {rs.map((r) => (
                    <li
                      key={r.id}
                      className="rounded border border-zinc-700 bg-zinc-950 p-2"
                    >
                      <div className="mb-1 flex items-center gap-2 text-xs">
                        <span
                          className={`rounded px-2 py-0.5 ${
                            STATUS_BADGE[r.responseType as ResponseType] ?? "bg-gray-200"
                          }`}
                        >
                          {r.responseType}
                        </span>
                        <span className="text-zinc-400">
                          {r.responderName ?? r.responderEmail}
                        </span>
                      </div>
                      {r.responseText ? (
                        <p className="whitespace-pre-wrap">{r.responseText}</p>
                      ) : null}
                      {r.objectionBasis ? (
                        <div className="mt-1 rounded bg-yellow-950/30 p-2 text-xs">
                          <span className="font-semibold">Objection: </span>
                          {r.objectionBasis}
                        </div>
                      ) : null}
                      {Array.isArray(r.producedDocDescriptions) && r.producedDocDescriptions.length > 0 ? (
                        <ol className="mt-1 list-decimal pl-5 text-xs">
                          {r.producedDocDescriptions.map((d, i) => (
                            <li key={i}>{d}</li>
                          ))}
                        </ol>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {showGenerate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-md border border-zinc-700 bg-zinc-950 p-6 text-zinc-100">
            <h3 className="text-lg font-semibold">Generate response link</h3>
            {latestUrl ? (
              <div className="mt-4 space-y-2">
                <p className="text-sm text-yellow-300">
                  Copy this link now — it will not be shown again.
                </p>
                <textarea
                  readOnly
                  rows={2}
                  value={latestUrl}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-xs"
                />
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(latestUrl).then(() => toast.success("Copied"))}
                  className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900"
                >
                  Copy
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="block text-sm">
                  Opposing counsel email
                  <input
                    type="email"
                    value={opposingEmail}
                    onChange={(e) => setOpposingEmail(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2"
                  />
                </label>
                <label className="block text-sm">
                  Name (optional)
                  <input
                    type="text"
                    value={opposingName}
                    onChange={(e) => setOpposingName(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2"
                  />
                </label>
                <label className="block text-sm">
                  Expires in (days)
                  <input
                    type="number"
                    min={1}
                    max={180}
                    value={expiresInDays}
                    onChange={(e) => setExpiresInDays(Number(e.target.value) || 60)}
                    className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2"
                  />
                </label>
              </div>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowGenerate(false);
                  setLatestUrl(null);
                  setOpposingEmail("");
                  setOpposingName("");
                }}
                className="rounded-md border border-zinc-700 px-3 py-2 text-sm"
              >
                Close
              </button>
              {!latestUrl && (
                <button
                  type="button"
                  disabled={generate.isPending}
                  onClick={onGenerate}
                  className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  {generate.isPending ? "Generating…" : "Generate"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
