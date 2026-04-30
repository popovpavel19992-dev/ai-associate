"use client";

// src/components/discovery-responses/response-form.tsx
//
// Public-portal Discovery Response form. Renders one card per question with
// type-appropriate inputs (RFA radio / Interrogatory textarea / RFP doc list)
// and posts to /api/discovery-responses/[token]/submit. Auto-saves on blur
// (debounced) and provides explicit "Save draft" + "Submit final" buttons.

import * as React from "react";
import { useRouter } from "next/navigation";

type ResponseType =
  | "admit"
  | "deny"
  | "object"
  | "lack_of_knowledge"
  | "written_response"
  | "produced_documents";

interface Question {
  number?: number;
  text: string;
}

export interface ResponseFormProps {
  token: string;
  caseInfo: { name: string; caseNumber: string | null };
  request: {
    id: string;
    title: string;
    requestType: string;
    servingParty: "plaintiff" | "defendant";
    setNumber: number;
    questions: Question[];
    servedAt: string | null;
    dueAt: string | null;
    status: string;
  };
  responder: { email: string; name: string | null };
  drafts: Array<{
    questionIndex: number;
    responseType: ResponseType;
    responseText: string | null;
    objectionBasis: string | null;
    producedDocDescriptions: string[];
  }>;
}

interface RowState {
  responseType: ResponseType | null;
  responseText: string;
  objectionBasis: string;
  producedDocDescriptions: string;
}

function emptyRow(): RowState {
  return {
    responseType: null,
    responseText: "",
    objectionBasis: "",
    producedDocDescriptions: "",
  };
}

export function ResponseForm(props: ResponseFormProps) {
  const router = useRouter();
  const { request, responder, drafts, caseInfo, token } = props;

  const initialRows: RowState[] = React.useMemo(() => {
    const seed = request.questions.map(() => emptyRow());
    for (const d of drafts) {
      if (d.questionIndex < seed.length) {
        seed[d.questionIndex] = {
          responseType: d.responseType,
          responseText: d.responseText ?? "",
          objectionBasis: d.objectionBasis ?? "",
          producedDocDescriptions: (d.producedDocDescriptions ?? []).join("\n"),
        };
      }
    }
    return seed;
  }, [drafts, request.questions]);

  const [rows, setRows] = React.useState<RowState[]>(initialRows);
  const [responderName, setResponderName] = React.useState<string>(
    responder.name ?? "",
  );
  const [submitState, setSubmitState] = React.useState<
    "idle" | "saving" | "saved" | "submitting" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const requestType = request.requestType;
  const dueAt = request.dueAt ? new Date(request.dueAt) : null;
  const daysLeft = dueAt
    ? Math.ceil((dueAt.getTime() - Date.now()) / 86400_000)
    : null;

  function updateRow(idx: number, patch: Partial<RowState>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function buildPayload(final: boolean) {
    const responses = rows
      .map((r, idx) => {
        if (!r.responseType) return null;
        const produced =
          r.responseType === "produced_documents"
            ? r.producedDocDescriptions
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined;
        return {
          questionIndex: idx,
          responseType: r.responseType,
          responseText: r.responseText || null,
          objectionBasis: r.objectionBasis || null,
          producedDocDescriptions: produced,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return {
      responderName: responderName.trim() || null,
      responderEmail: responder.email,
      final,
      responses,
    };
  }

  async function postSubmit(final: boolean): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/discovery-responses/${encodeURIComponent(token)}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildPayload(final)),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "request failed" }));
      return { ok: false, error: body.error ?? "request failed" };
    }
    return { ok: true };
  }

  async function handleSaveDraft() {
    setSubmitState("saving");
    setErrorMsg(null);
    const result = await postSubmit(false);
    if (!result.ok) {
      setSubmitState("error");
      setErrorMsg(result.error ?? "save failed");
      return;
    }
    setSubmitState("saved");
  }

  async function handleSubmitFinal() {
    // Validate: every question must have a non-null type
    const missing = rows.findIndex((r) => r.responseType === null);
    if (missing !== -1) {
      setErrorMsg(`Question ${missing + 1} has no response selected.`);
      setSubmitState("error");
      return;
    }
    if (!responder.email) {
      setErrorMsg("Responder email is missing.");
      setSubmitState("error");
      return;
    }
    setSubmitState("submitting");
    setErrorMsg(null);
    const result = await postSubmit(true);
    if (!result.ok) {
      setSubmitState("error");
      setErrorMsg(result.error ?? "submit failed");
      return;
    }
    router.push(`/respond/${encodeURIComponent(token)}/thank-you`);
  }

  // Per-blur autosave: debounce by 700ms.
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  function scheduleAutosave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      handleSaveDraft();
    }, 700);
  }

  return (
    <div className="space-y-6">
      <header className="rounded-lg bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900">{request.title}</h1>
        <p className="mt-1 text-sm text-gray-600">
          Case: {caseInfo.name}
          {caseInfo.caseNumber ? ` (${caseInfo.caseNumber})` : ""}
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <span className="block text-gray-500">Served</span>
            <span className="font-medium">
              {request.servedAt
                ? new Date(request.servedAt).toLocaleDateString()
                : "—"}
            </span>
          </div>
          <div>
            <span className="block text-gray-500">Response due</span>
            <span className="font-medium">
              {dueAt ? dueAt.toLocaleDateString() : "—"}
            </span>
          </div>
          <div>
            <span className="block text-gray-500">Days remaining</span>
            <span
              className={`font-medium ${
                daysLeft !== null && daysLeft <= 5
                  ? "text-red-600"
                  : "text-gray-900"
              }`}
            >
              {daysLeft !== null ? daysLeft : "—"}
            </span>
          </div>
        </div>
      </header>

      <section className="rounded-lg bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Responder details</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Your name</span>
            <input
              type="text"
              value={responderName}
              onChange={(e) => setResponderName(e.target.value)}
              onBlur={scheduleAutosave}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
              placeholder="Jane Doe"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Email</span>
            <input
              type="email"
              value={responder.email}
              readOnly
              className="mt-1 block w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-600"
            />
          </label>
        </div>
      </section>

      <section className="space-y-4">
        {request.questions.map((q, idx) => (
          <QuestionCard
            key={idx}
            number={q.number ?? idx + 1}
            text={q.text}
            requestType={requestType}
            row={rows[idx]}
            onChange={(patch) => updateRow(idx, patch)}
            onBlur={scheduleAutosave}
          />
        ))}
      </section>

      <footer className="sticky bottom-0 rounded-lg border bg-white p-4 shadow-md">
        {errorMsg ? (
          <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMsg}
          </div>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-gray-600">
            {submitState === "saving" && "Saving…"}
            {submitState === "saved" && "Draft saved"}
            {submitState === "submitting" && "Submitting…"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={submitState === "saving" || submitState === "submitting"}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Save draft
            </button>
            <button
              type="button"
              onClick={handleSubmitFinal}
              disabled={submitState === "submitting"}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Submit final responses
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

interface QuestionCardProps {
  number: number;
  text: string;
  requestType: string;
  row: RowState;
  onChange: (patch: Partial<RowState>) => void;
  onBlur: () => void;
}

function QuestionCard(props: QuestionCardProps) {
  const { number, text, requestType, row, onChange, onBlur } = props;
  const label =
    requestType === "rfp"
      ? "Request for Production"
      : requestType === "rfa"
        ? "Request for Admission"
        : "Interrogatory";

  return (
    <article className="rounded-lg bg-white p-6 shadow-sm">
      <h3 className="text-base font-semibold text-gray-900">
        {label} No. {number}
      </h3>
      <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{text}</p>

      <div className="mt-4 space-y-3">
        {requestType === "rfa" ? (
          <RfaControls row={row} onChange={onChange} onBlur={onBlur} />
        ) : requestType === "rfp" ? (
          <RfpControls row={row} onChange={onChange} onBlur={onBlur} />
        ) : (
          <InterrogatoryControls row={row} onChange={onChange} onBlur={onBlur} />
        )}
      </div>
    </article>
  );
}

function RfaControls({ row, onChange, onBlur }: {
  row: RowState;
  onChange: (patch: Partial<RowState>) => void;
  onBlur: () => void;
}) {
  const options: { value: ResponseType; label: string }[] = [
    { value: "admit", label: "Admit" },
    { value: "deny", label: "Deny" },
    { value: "lack_of_knowledge", label: "Lack of knowledge" },
    { value: "object", label: "Object" },
  ];
  return (
    <>
      <div className="flex flex-wrap gap-3">
        {options.map((opt) => (
          <label key={opt.value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={row.responseType === opt.value}
              onChange={() => {
                onChange({ responseType: opt.value });
                onBlur();
              }}
            />
            {opt.label}
          </label>
        ))}
      </div>
      {row.responseType === "object" ? (
        <textarea
          value={row.objectionBasis}
          onChange={(e) => onChange({ objectionBasis: e.target.value })}
          onBlur={onBlur}
          rows={3}
          placeholder="Basis for objection (e.g., overbroad, vague, calls for legal conclusion)"
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      ) : null}
    </>
  );
}

function InterrogatoryControls({ row, onChange, onBlur }: {
  row: RowState;
  onChange: (patch: Partial<RowState>) => void;
  onBlur: () => void;
}) {
  const isObject = row.responseType === "object";
  return (
    <>
      <div className="flex gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={row.responseType === "written_response"}
            onChange={() => {
              onChange({ responseType: "written_response" });
              onBlur();
            }}
          />
          Written response
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={isObject}
            onChange={() => {
              onChange({ responseType: "object" });
              onBlur();
            }}
          />
          Object
        </label>
      </div>
      {row.responseType === "written_response" ? (
        <textarea
          value={row.responseText}
          onChange={(e) => onChange({ responseText: e.target.value })}
          onBlur={onBlur}
          rows={4}
          placeholder="Type your response here"
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      ) : null}
      {isObject ? (
        <textarea
          value={row.objectionBasis}
          onChange={(e) => onChange({ objectionBasis: e.target.value })}
          onBlur={onBlur}
          rows={3}
          placeholder="Basis for objection"
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      ) : null}
    </>
  );
}

function RfpControls({ row, onChange, onBlur }: {
  row: RowState;
  onChange: (patch: Partial<RowState>) => void;
  onBlur: () => void;
}) {
  const isObject = row.responseType === "object";
  return (
    <>
      <div className="flex gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={row.responseType === "produced_documents"}
            onChange={() => {
              onChange({ responseType: "produced_documents" });
              onBlur();
            }}
          />
          Documents will be produced
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={isObject}
            onChange={() => {
              onChange({ responseType: "object" });
              onBlur();
            }}
          />
          Object
        </label>
      </div>
      {row.responseType === "produced_documents" ? (
        <textarea
          value={row.producedDocDescriptions}
          onChange={(e) => onChange({ producedDocDescriptions: e.target.value })}
          onBlur={onBlur}
          rows={4}
          placeholder="One document description per line (e.g., 'Bates 0001-0050 — invoices')"
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      ) : null}
      {isObject ? (
        <textarea
          value={row.objectionBasis}
          onChange={(e) => onChange({ objectionBasis: e.target.value })}
          onBlur={onBlur}
          rows={3}
          placeholder="Basis for objection"
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      ) : null}
    </>
  );
}
