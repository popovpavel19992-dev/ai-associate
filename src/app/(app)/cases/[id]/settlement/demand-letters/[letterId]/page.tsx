"use client";

import { use, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/components/cases/settlement/format";

type Method = "email" | "mail" | "certified_mail" | "courier";

export default function DemandLetterDetailPage({
  params,
}: {
  params: Promise<{ id: string; letterId: string }>;
}) {
  const { id: caseId, letterId } = use(params);
  const utils = trpc.useUtils();
  const { data: letter, isLoading } = trpc.settlement.demandLetters.get.useQuery(
    { letterId },
  );

  const [sendMethod, setSendMethod] = useState<Method>("email");
  const [responseSummary, setResponseSummary] = useState("");

  const sentMut = trpc.settlement.demandLetters.markSent.useMutation({
    onSuccess: async () => {
      toast.success("Letter marked sent");
      await utils.settlement.demandLetters.get.invalidate({ letterId });
      await utils.settlement.demandLetters.listForCase.invalidate({ caseId });
    },
    onError: (e) => toast.error(e.message),
  });
  const respondMut = trpc.settlement.demandLetters.recordResponse.useMutation({
    onSuccess: async () => {
      toast.success("Response recorded");
      await utils.settlement.demandLetters.get.invalidate({ letterId });
    },
    onError: (e) => toast.error(e.message),
  });
  const noRespMut = trpc.settlement.demandLetters.markNoResponse.useMutation({
    onSuccess: async () => {
      toast.success("Marked no response");
      await utils.settlement.demandLetters.get.invalidate({ letterId });
    },
    onError: (e) => toast.error(e.message),
  });
  const rescindMut = trpc.settlement.demandLetters.markRescinded.useMutation({
    onSuccess: async () => {
      toast.success("Letter rescinded");
      await utils.settlement.demandLetters.get.invalidate({ letterId });
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.settlement.demandLetters.delete.useMutation({
    onSuccess: async () => {
      toast.success("Letter deleted");
      window.location.href = `/cases/${caseId}?tab=settlement`;
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return <div className="p-6 text-sm text-zinc-400">Loading…</div>;
  }
  if (!letter) {
    return <div className="p-6 text-sm text-zinc-400">Not found.</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/cases/${caseId}?tab=settlement`}
            className="text-xs text-zinc-400 hover:text-zinc-200"
          >
            ← Back to Settlement
          </Link>
          <h1 className="mt-1 text-xl font-semibold">
            Demand Letter #{letter.letterNumber}
          </h1>
          <p className="text-xs text-zinc-500">
            {letter.letterType.replace(/_/g, " ")} · status: {letter.status}
          </p>
        </div>
        <div className="flex gap-2">
          {letter.status !== "draft" ? (
            <a
              href={`/api/demand-letters/${letterId}/pdf`}
              className="rounded-md bg-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-600"
            >
              Download PDF
            </a>
          ) : null}
        </div>
      </div>

      <section className="rounded-md border border-zinc-800 p-4">
        <h2 className="mb-2 text-sm font-semibold">Recipient</h2>
        <p className="text-sm">{letter.recipientName}</p>
        {letter.recipientAddress ? (
          <pre className="mt-1 whitespace-pre-wrap text-xs text-zinc-400">
            {letter.recipientAddress}
          </pre>
        ) : null}
        {letter.recipientEmail ? (
          <p className="text-xs text-zinc-400">{letter.recipientEmail}</p>
        ) : null}
      </section>

      <section className="rounded-md border border-zinc-800 p-4">
        <h2 className="mb-2 text-sm font-semibold">Demand</h2>
        {letter.demandAmountCents !== null &&
        letter.demandAmountCents !== undefined ? (
          <p className="text-sm">
            Amount:{" "}
            <span className="font-mono">
              {formatCurrency(letter.demandAmountCents, letter.currency)}
            </span>
          </p>
        ) : null}
        {letter.deadlineDate ? (
          <p className="text-sm">Deadline: {letter.deadlineDate}</p>
        ) : null}
        {letter.demandTerms ? (
          <pre className="mt-2 whitespace-pre-wrap text-xs text-zinc-300">
            {letter.demandTerms}
          </pre>
        ) : null}
      </section>

      {letter.keyFacts ? (
        <section className="rounded-md border border-zinc-800 p-4">
          <h2 className="mb-2 text-sm font-semibold">Key Facts</h2>
          <pre className="whitespace-pre-wrap text-xs text-zinc-300">
            {letter.keyFacts}
          </pre>
        </section>
      ) : null}
      {letter.legalBasis ? (
        <section className="rounded-md border border-zinc-800 p-4">
          <h2 className="mb-2 text-sm font-semibold">Legal Basis</h2>
          <pre className="whitespace-pre-wrap text-xs text-zinc-300">
            {letter.legalBasis}
          </pre>
        </section>
      ) : null}
      {letter.letterBody ? (
        <section className="rounded-md border border-zinc-800 p-4">
          <h2 className="mb-2 text-sm font-semibold">
            Full Letter Body (overrides structured PDF sections)
          </h2>
          <pre className="whitespace-pre-wrap text-xs text-zinc-300">
            {letter.letterBody}
          </pre>
        </section>
      ) : null}

      <section className="rounded-md border border-zinc-800 p-4">
        <h2 className="mb-3 text-sm font-semibold">Actions</h2>
        <div className="space-y-3">
          {letter.status === "draft" && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={sendMethod}
                onChange={(e) => setSendMethod(e.target.value as Method)}
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs"
              >
                <option value="email">Email</option>
                <option value="mail">Mail</option>
                <option value="certified_mail">Certified Mail</option>
                <option value="courier">Courier</option>
              </select>
              <button
                type="button"
                onClick={() =>
                  sentMut.mutate({
                    letterId,
                    sentAt: new Date().toISOString(),
                    sentMethod: sendMethod,
                  })
                }
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
              >
                Mark Sent
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm("Delete this draft?")) {
                    deleteMut.mutate({ letterId });
                  }
                }}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800"
              >
                Delete Draft
              </button>
            </div>
          )}
          {letter.status === "sent" && (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => noRespMut.mutate({ letterId })}
                  className="rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800"
                >
                  Mark No Response
                </button>
                <button
                  type="button"
                  onClick={() => rescindMut.mutate({ letterId })}
                  className="rounded border border-rose-700 px-2 py-1 text-xs text-rose-300 hover:bg-rose-900/40"
                >
                  Rescind
                </button>
              </div>
              <div className="space-y-2">
                <textarea
                  value={responseSummary}
                  onChange={(e) => setResponseSummary(e.target.value)}
                  rows={3}
                  placeholder="Response summary (optional)"
                  className="w-full rounded border border-zinc-700 bg-zinc-800 p-2 text-xs"
                />
                <button
                  type="button"
                  onClick={() =>
                    respondMut.mutate({
                      letterId,
                      responseReceivedAt: new Date().toISOString(),
                      responseSummary: responseSummary.trim() || null,
                    })
                  }
                  className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700"
                >
                  Record Response
                </button>
              </div>
            </>
          )}
          {letter.status === "responded" && letter.responseSummary ? (
            <div className="rounded border border-zinc-800 p-3">
              <p className="text-xs font-semibold text-zinc-300">Response</p>
              <pre className="mt-1 whitespace-pre-wrap text-xs text-zinc-400">
                {letter.responseSummary}
              </pre>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
