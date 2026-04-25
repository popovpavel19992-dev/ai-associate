"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Source = "library" | "ai" | "blank";
type Party = "plaintiff" | "defendant";
export type DiscoveryRequestType = "interrogatories" | "rfp" | "rfa";

function ordinal(n: number): string {
  switch (n) {
    case 1:
      return "First";
    case 2:
      return "Second";
    case 3:
      return "Third";
    case 4:
      return "Fourth";
    case 5:
      return "Fifth";
    default:
      return `${n}th`;
  }
}

function defaultTitle(
  requestType: DiscoveryRequestType,
  servingParty: Party,
  setNumber: number,
): string {
  const partyLabel = servingParty === "plaintiff" ? "Plaintiff" : "Defendant";
  if (requestType === "rfp") {
    return `${partyLabel}'s ${ordinal(setNumber)} Requests for Production`;
  }
  if (requestType === "rfa") {
    return `${partyLabel}'s ${ordinal(setNumber)} Set of Requests for Admission`;
  }
  return `${partyLabel}'s ${ordinal(setNumber)} Set of Interrogatories`;
}

export function NewDiscoveryWizard({
  caseId,
  requestType,
  onClose,
}: {
  caseId: string;
  requestType: DiscoveryRequestType;
  onClose: () => void;
}) {
  const router = useRouter();
  const [source, setSource] = useState<Source>("library");
  const [servingParty, setServingParty] = useState<Party>("plaintiff");
  const [titleEdited, setTitleEdited] = useState(false);
  const [title, setTitle] = useState("");

  // Library
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [additionalQuestionsText, setAdditionalQuestionsText] = useState("");

  // AI
  const [aiContext, setAiContext] = useState("");
  const aiDefault =
    requestType === "rfp" ? 12 : requestType === "rfa" ? 15 : 15;
  // FRCP 33: 25 cap on interrogatories. FRCP 34/36 have no federal numerical
  // cap; we ceiling at 30 in the UI for sanity.
  const aiMax =
    requestType === "rfp" ? 30 : requestType === "rfa" ? 30 : 25;
  const [desiredCount, setDesiredCount] = useState(aiDefault);

  const isRfp = requestType === "rfp";
  const isRfa = requestType === "rfa";
  const isInterrogatory = requestType === "interrogatories";
  const labelNounPlural = isRfp
    ? "Requests for Production"
    : isRfa
      ? "Requests for Admission"
      : "Interrogatories";
  const aiItemNounPlural = isRfp ? "requests" : isRfa ? "admissions" : "questions";

  const { data: caseData } = trpc.cases.getById.useQuery({ caseId });
  const { data: setNumberData } = trpc.discovery.getNextSetNumber.useQuery({
    caseId,
    requestType,
  });
  const setNumber = setNumberData?.setNumber ?? 1;

  const caseType =
    (caseData?.overrideCaseType as string | null | undefined) ??
    (caseData?.detectedCaseType as string | null | undefined) ??
    undefined;

  const { data: templates } = trpc.discovery.listLibraryTemplates.useQuery({
    ...(caseType ? { caseType } : {}),
    requestType,
  });

  const computedTitle = useMemo(
    () => defaultTitle(requestType, servingParty, setNumber),
    [requestType, servingParty, setNumber],
  );
  const effectiveTitle = titleEdited ? title : computedTitle;

  const onSuccess = (created: { id: string }) => {
    onClose();
    router.push(`/cases/${caseId}/discovery/${created.id}`);
  };

  const createFromLibrary = trpc.discovery.createFromLibrary.useMutation({
    onSuccess,
    onError: (e) => toast.error(e.message),
  });
  const createFromAi = trpc.discovery.createFromAi.useMutation({
    onSuccess,
    onError: (e) => toast.error(e.message),
  });
  const createBlank = trpc.discovery.createBlank.useMutation({
    onSuccess,
    onError: (e) => toast.error(e.message),
  });

  const isPending =
    createFromLibrary.isPending ||
    createFromAi.isPending ||
    createBlank.isPending;

  const submit = () => {
    if (source === "library") {
      if (!templateId) {
        toast.error("Pick a template");
        return;
      }
      const additional = additionalQuestionsText
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      createFromLibrary.mutate({
        caseId,
        requestType,
        servingParty,
        templateId,
        title: effectiveTitle,
        additionalQuestions: additional.length > 0 ? additional : undefined,
      });
    } else if (source === "ai") {
      createFromAi.mutate({
        caseId,
        requestType,
        servingParty,
        title: effectiveTitle,
        desiredCount,
        additionalContext: aiContext.trim() ? aiContext.trim() : undefined,
      });
    } else {
      createBlank.mutate({
        caseId,
        requestType,
        servingParty,
        title: effectiveTitle,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-md border border-zinc-700 bg-zinc-950 p-6 text-zinc-100">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            New{" "}
            {isRfp
              ? "Request for Production"
              : isRfa
                ? "Request for Admission"
                : "Interrogatory Set"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {/* Source selection */}
          <div>
            <div className="text-sm font-medium">Source</div>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              {(["library", "ai", "blank"] as Source[]).map((opt) => (
                <label
                  key={opt}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm ${
                    source === opt
                      ? "border-blue-500 bg-blue-500/10"
                      : "border-zinc-700 hover:bg-zinc-900"
                  }`}
                >
                  <input
                    type="radio"
                    name="discovery-source"
                    checked={source === opt}
                    onChange={() => setSource(opt)}
                  />
                  <span>
                    {opt === "library"
                      ? "Use library template"
                      : opt === "ai"
                        ? "Generate with AI"
                        : "Start from scratch"}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Serving party */}
          <div>
            <div className="text-sm font-medium">Serving party</div>
            <div className="mt-2 flex gap-3 text-sm">
              {(["plaintiff", "defendant"] as Party[]).map((p) => (
                <label key={p} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="discovery-party"
                    checked={servingParty === p}
                    onChange={() => setServingParty(p)}
                  />
                  <span className="capitalize">{p}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium">Title</label>
            <input
              type="text"
              value={effectiveTitle}
              onChange={(e) => {
                setTitleEdited(true);
                setTitle(e.target.value);
              }}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Set {setNumber} — auto-generated from set number; edit if needed.
            </p>
          </div>

          {/* Source-specific body */}
          {source === "library" && (
            <div className="space-y-3">
              <div className="text-sm font-medium">Pick a template</div>
              {templates && templates.length === 0 && (
                <p className="text-sm text-amber-400">
                  No library templates match this case type
                  {caseType ? ` (${caseType})` : ""}.
                </p>
              )}
              <div className="grid gap-2">
                {templates?.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplateId(t.id)}
                    className={`rounded-md border p-3 text-left text-sm ${
                      templateId === t.id
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-zinc-700 hover:bg-zinc-900"
                    }`}
                  >
                    <div className="font-medium">{t.title}</div>
                    <div className="mt-1 text-xs text-zinc-400">
                      {t.caseType} · {t.questionCount} {aiItemNounPlural}
                    </div>
                    {t.description && (
                      <div className="mt-1 text-xs text-zinc-500">
                        {t.description}
                      </div>
                    )}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-sm font-medium">
                  Add custom {labelNounPlural.toLowerCase()} to template (one per
                  line, optional)
                </label>
                <textarea
                  value={additionalQuestionsText}
                  onChange={(e) => setAdditionalQuestionsText(e.target.value)}
                  rows={4}
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
                  placeholder={
                    isRfp
                      ? "All documents relating to...\nAll communications between..."
                      : isRfa
                        ? "Admit that the contract was executed on [date].\nAdmit that no notice of breach was provided."
                        : "Identify each communication you had with...\nDescribe in detail..."
                  }
                />
              </div>
            </div>
          )}

          {source === "ai" && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium">
                  Anything specific you want the AI to focus on? (optional)
                </label>
                <textarea
                  value={aiContext}
                  onChange={(e) => setAiContext(e.target.value)}
                  rows={4}
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
                  placeholder={
                    isRfp
                      ? "e.g., focus on email custodians, financial records, comparator personnel files..."
                      : isRfa
                        ? "e.g., focus on contract authentication, performance dates, damages amounts..."
                        : "e.g., focus on damages timeline, emails between Alice and Bob, ..."
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-medium">
                  Number of {aiItemNounPlural}: {desiredCount}
                </label>
                <input
                  type="range"
                  min={5}
                  max={aiMax}
                  value={desiredCount}
                  onChange={(e) => setDesiredCount(Number(e.target.value))}
                  className="mt-2 w-full"
                />
                <div className="mt-1 flex justify-between text-xs text-zinc-500">
                  <span>5</span>
                  <span>
                    {aiMax}
                    {isInterrogatory ? " (federal cap)" : ""}
                  </span>
                </div>
              </div>
            </div>
          )}

          {source === "blank" && (
            <p className="text-sm text-zinc-400">
              Start with an empty set. You can add{" "}
              {labelNounPlural.toLowerCase()} on the next screen.
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isPending || (source === "library" && !templateId)}
            onClick={submit}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isPending
              ? source === "ai"
                ? "Generating…"
                : "Creating…"
              : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Backwards-compat alias for any lingering imports.
export const NewInterrogatoryWizard = NewDiscoveryWizard;
