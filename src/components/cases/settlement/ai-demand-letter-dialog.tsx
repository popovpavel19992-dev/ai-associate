"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Step = "classify" | "form" | "review";

type LetterType =
  | "initial_demand"
  | "pre_litigation"
  | "pre_trial"
  | "response_to_demand";

type ClaimType = "contract" | "personal_injury" | "employment" | "debt";

interface Props {
  caseId: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const CLAIM_LABEL: Record<ClaimType, string> = {
  contract: "Breach of Contract",
  personal_injury: "Personal Injury",
  employment: "Employment",
  debt: "Debt Collection",
};

const LETTER_TYPE_LABELS: Record<LetterType, string> = {
  initial_demand: "Initial Demand",
  pre_litigation: "Pre-Litigation",
  pre_trial: "Pre-Trial",
  response_to_demand: "Response to Demand",
};

const SECTION_LABEL: Record<string, string> = {
  header: "Header",
  facts: "Statement of Facts",
  legal_basis: "Legal Basis",
  demand: "Demand",
  consequences: "Consequences",
};

const SECTION_ORDER = ["header", "facts", "legal_basis", "demand", "consequences"];

function defaultDeadline() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

const INPUT_CLS =
  "w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500";
const LABEL_CLS =
  "mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400";

export function AiDemandLetterDialog({
  caseId,
  open,
  onClose,
  onCreated,
}: Props) {
  const [step, setStep] = useState<Step>("classify");

  // classify state
  const [claimType, setClaimType] = useState<ClaimType>("contract");
  const [confidence, setConfidence] = useState<number>(0);
  const [rationale, setRationale] = useState<string>("");
  const [ranked, setRanked] = useState<
    Array<{ claimType: string; confidence: number }>
  >([]);
  const [classifyDone, setClassifyDone] = useState(false);

  // form state
  const [letterType, setLetterType] = useState<LetterType>("pre_litigation");
  const [recipientName, setRecipientName] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [demandAmount, setDemandAmount] = useState("");
  const [deadlineDate, setDeadlineDate] = useState(defaultDeadline);
  const [summary, setSummary] = useState("");

  // review state
  const [letterId, setLetterId] = useState<string | null>(null);
  const [letterNumber, setLetterNumber] = useState<number | null>(null);
  const [sections, setSections] = useState<
    Array<{ sectionKey: string; contentMd: string }>
  >([]);

  const suggestMut = trpc.settlement.demandLetters.aiSuggest.useMutation({
    onSuccess: (r) => {
      setClaimType(r.claimType as ClaimType);
      setConfidence(r.confidence);
      setRationale(r.rationale);
      setRanked(r.ranked);
      setClassifyDone(true);
    },
    onError: (e) => {
      toast.error(e.message);
    },
  });

  const generateMut = trpc.settlement.demandLetters.aiGenerate.useMutation({
    onSuccess: (r) => {
      setLetterId(r.letterId);
      setLetterNumber(r.letterNumber);
      setSections(
        SECTION_ORDER.map(
          (key) =>
            r.sections.find((s) => s.sectionKey === key) ?? {
              sectionKey: key,
              contentMd: "",
            },
        ),
      );
      setStep("review");
    },
    onError: (e) => {
      toast.error(e.message);
    },
  });

  const regenMut = trpc.settlement.demandLetters.aiRegenerateSection.useMutation(
    {
      onSuccess: (r, vars) => {
        setSections((prev) =>
          prev.map((s) =>
            s.sectionKey === vars.sectionKey
              ? { ...s, contentMd: r.contentMd }
              : s,
          ),
        );
        toast.success(`${SECTION_LABEL[vars.sectionKey] ?? vars.sectionKey} regenerated`);
      },
      onError: (e) => {
        toast.error(e.message);
      },
    },
  );

  // Trigger classify on open
  useEffect(() => {
    if (open && step === "classify" && !classifyDone && !suggestMut.isPending) {
      suggestMut.mutate({ caseId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reset when re-opened
  useEffect(() => {
    if (open) return;
    // reset on close so next open starts fresh
    setStep("classify");
    setClassifyDone(false);
    setLetterId(null);
    setLetterNumber(null);
    setSections([]);
  }, [open]);

  if (!open) return null;

  // ── validation helpers ──────────────────────────────────────────────────────
  function validateForm(): string | null {
    const amt = parseFloat(demandAmount);
    if (!Number.isFinite(amt) || amt <= 0) return "Demand amount must be positive.";
    if (!recipientName.trim()) return "Recipient name is required.";
    if (!recipientAddress.trim()) return "Recipient address is required.";
    if (summary.trim().length < 50) return "Summary must be at least 50 characters.";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dl = new Date(deadlineDate + "T00:00:00Z");
    const min = new Date(today);
    min.setDate(min.getDate() + 7);
    const max = new Date(today);
    max.setDate(max.getDate() + 90);
    if (dl < min || dl > max) return "Deadline must be 7–90 days from today.";
    return null;
  }

  function handleGenerate() {
    const err = validateForm();
    if (err) {
      toast.error(err);
      return;
    }
    generateMut.mutate({
      caseId,
      claimType,
      claimTypeConfidence: confidence,
      demandAmountCents: Math.round(parseFloat(demandAmount) * 100),
      deadlineDate,
      recipientName: recipientName.trim(),
      recipientAddress: recipientAddress.trim(),
      recipientEmail: recipientEmail.trim() || null,
      summary: summary.trim(),
      letterType,
    });
  }

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-6 text-zinc-100">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {step === "classify" && "✨ Draft with AI — Claim Analysis"}
            {step === "form" && "✨ Draft with AI — Letter Details"}
            {step === "review" && `✨ AI Draft${letterNumber != null ? ` — Letter #${letterNumber}` : ""}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100"
          >
            ✕
          </button>
        </div>

        {/* Step indicators */}
        <div className="mb-5 flex gap-2 text-xs">
          {(["classify", "form", "review"] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`flex items-center gap-1.5 ${step === s ? "text-violet-400 font-semibold" : "text-zinc-500"}`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                  step === s
                    ? "bg-violet-600 text-white"
                    : "bg-zinc-700 text-zinc-400"
                }`}
              >
                {i + 1}
              </span>
              {s === "classify" ? "Classify" : s === "form" ? "Details" : "Review"}
            </div>
          ))}
        </div>

        {/* ── STEP: classify ──────────────────────────────────────────────── */}
        {step === "classify" && (
          <div className="space-y-4">
            {suggestMut.isPending && (
              <div className="flex items-center gap-3 py-6 text-zinc-400">
                <svg
                  className="h-5 w-5 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                  />
                </svg>
                <span>Classifying claim…</span>
              </div>
            )}

            {suggestMut.isError && (
              <div className="space-y-3">
                <p className="rounded bg-rose-900/40 px-3 py-2 text-sm text-rose-300">
                  {suggestMut.error.message}
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}

            {classifyDone && !suggestMut.isPending && (
              <div className="space-y-4">
                {/* Primary suggestion */}
                <div className="rounded-md border border-zinc-700 bg-zinc-800/60 p-4">
                  <div className="flex items-center gap-3">
                    <span className="text-base font-semibold text-zinc-100">
                      {CLAIM_LABEL[claimType] ?? claimType}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        confidence >= 0.7
                          ? "bg-emerald-900/50 text-emerald-300"
                          : "bg-amber-900/50 text-amber-300"
                      }`}
                    >
                      {Math.round(confidence * 100)}% confidence
                    </span>
                  </div>
                  {rationale && (
                    <p className="mt-2 text-sm text-zinc-400">{rationale}</p>
                  )}
                </div>

                {/* Low confidence — allow override */}
                {confidence < 0.7 && (
                  <div>
                    <label className={LABEL_CLS}>
                      Confidence is low — please confirm claim type
                    </label>
                    <select
                      value={claimType}
                      onChange={(e) => setClaimType(e.target.value as ClaimType)}
                      className={INPUT_CLS}
                    >
                      {(Object.keys(CLAIM_LABEL) as ClaimType[]).map((k) => (
                        <option key={k} value={k}>
                          {CLAIM_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Ranked alternatives */}
                {ranked.length > 1 && (
                  <div className="space-y-1">
                    <p className="text-xs text-zinc-500">All scores:</p>
                    <ul className="space-y-0.5">
                      {ranked.map((r) => (
                        <li
                          key={r.claimType}
                          className="flex items-center justify-between text-xs text-zinc-400"
                        >
                          <span>{CLAIM_LABEL[r.claimType as ClaimType] ?? r.claimType}</span>
                          <span>{Math.round(r.confidence * 100)}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep("form")}
                    className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── STEP: form ──────────────────────────────────────────────────── */}
        {step === "form" && (
          <div className="space-y-4 text-sm">
            {generateMut.isError && (
              <p className="rounded bg-rose-900/40 px-3 py-2 text-sm text-rose-300">
                {generateMut.error.message}
              </p>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Claim type */}
              <div>
                <label className={LABEL_CLS}>Claim Type</label>
                <select
                  value={claimType}
                  onChange={(e) => setClaimType(e.target.value as ClaimType)}
                  className={INPUT_CLS}
                >
                  {(Object.keys(CLAIM_LABEL) as ClaimType[]).map((k) => (
                    <option key={k} value={k}>
                      {CLAIM_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Letter type */}
              <div>
                <label className={LABEL_CLS}>Letter Type</label>
                <select
                  value={letterType}
                  onChange={(e) => setLetterType(e.target.value as LetterType)}
                  className={INPUT_CLS}
                >
                  {(Object.keys(LETTER_TYPE_LABELS) as LetterType[]).map(
                    (k) => (
                      <option key={k} value={k}>
                        {LETTER_TYPE_LABELS[k]}
                      </option>
                    ),
                  )}
                </select>
              </div>

              {/* Recipient name */}
              <div className="sm:col-span-2">
                <label className={LABEL_CLS}>Recipient Name *</label>
                <input
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder="Acme Corp."
                  className={INPUT_CLS}
                />
              </div>

              {/* Recipient address */}
              <div className="sm:col-span-2">
                <label className={LABEL_CLS}>Recipient Address *</label>
                <textarea
                  value={recipientAddress}
                  onChange={(e) => setRecipientAddress(e.target.value)}
                  rows={2}
                  placeholder="123 Main St, Suite 100&#10;New York, NY 10001"
                  className={INPUT_CLS}
                />
              </div>

              {/* Recipient email */}
              <div>
                <label className={LABEL_CLS}>Recipient Email</label>
                <input
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="contact@example.com"
                  className={INPUT_CLS}
                />
              </div>

              {/* Demand amount */}
              <div>
                <label className={LABEL_CLS}>Demand Amount (USD) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={demandAmount}
                  onChange={(e) => setDemandAmount(e.target.value)}
                  placeholder="50000.00"
                  className={INPUT_CLS}
                />
              </div>

              {/* Deadline */}
              <div>
                <label className={LABEL_CLS}>Response Deadline * (7–90 days)</label>
                <input
                  type="date"
                  value={deadlineDate}
                  onChange={(e) => setDeadlineDate(e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
            </div>

            {/* Summary */}
            <div>
              <label className={LABEL_CLS}>
                Case Summary * (min 50 chars — {summary.trim().length}/50)
              </label>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={4}
                placeholder="Describe the key facts and circumstances of the dispute. The AI will use this to draft the letter sections."
                className={INPUT_CLS}
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setStep("classify")}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generateMut.isPending}
                className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {generateMut.isPending ? "Generating…" : "Generate Letter"}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: review ────────────────────────────────────────────────── */}
        {step === "review" && letterId && (
          <div className="space-y-5">
            <p className="text-xs text-zinc-500">
              Sections are read-only. Use &ldquo;Regenerate&rdquo; per section to refine, then export
              or close.
            </p>

            {sections.map((s) => (
              <div key={s.sectionKey} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    {SECTION_LABEL[s.sectionKey] ?? s.sectionKey}
                  </span>
                  <button
                    type="button"
                    disabled={regenMut.isPending}
                    onClick={() =>
                      regenMut.mutate({
                        letterId: letterId,
                        sectionKey: s.sectionKey as
                          | "header"
                          | "facts"
                          | "legal_basis"
                          | "demand"
                          | "consequences",
                      })
                    }
                    className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"
                  >
                    {regenMut.isPending &&
                    regenMut.variables?.sectionKey === s.sectionKey
                      ? "Regenerating…"
                      : "Regenerate"}
                  </button>
                </div>
                <div className="min-h-[3rem] rounded border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-300 whitespace-pre-wrap">
                  {s.contentMd || (
                    <span className="text-zinc-600 italic">No content</span>
                  )}
                </div>
              </div>
            ))}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() =>
                  window.open(
                    `/api/demand-letters/${letterId}/pdf`,
                    "_blank",
                  )
                }
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
              >
                Export PDF
              </button>
              <button
                type="button"
                onClick={onCreated}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
              >
                Save &amp; Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
