"use client";
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type ResponseType =
  | "admit"
  | "deny"
  | "object"
  | "lack_of_knowledge"
  | "written_response"
  | "produced_documents";

interface Draft {
  id: string;
  questionIndex: number;
  responseType: ResponseType;
  responseText: string | null;
  objectionBasis: string | null;
  aiGenerated: boolean;
}

interface Props {
  requestId: string;
  questionIndex: number;
  questionNumber: number;
  questionText: string;
  draft: Draft | null;
  isServed: boolean;
}

const TYPE_LABELS: Record<ResponseType, string> = {
  admit: "Admit",
  deny: "Deny",
  object: "Object",
  lack_of_knowledge: "Lack of Knowledge",
  written_response: "Response",
  produced_documents: "Documents Produced",
};

export function ResponseRow({
  requestId,
  questionIndex,
  questionNumber,
  questionText,
  draft,
  isServed,
}: Props) {
  const utils = trpc.useUtils();
  const [responseType, setResponseType] = useState<ResponseType>(
    draft?.responseType ?? "written_response",
  );
  const [responseText, setResponseText] = useState(draft?.responseText ?? "");
  const [objectionBasis, setObjectionBasis] = useState(
    draft?.objectionBasis ?? "",
  );

  const update = trpc.discoveryResponseDrafter.updateDraft.useMutation({
    onSuccess: () =>
      utils.discoveryResponseDrafter.getIncoming.invalidate({ requestId }),
    onError: (e) => toast.error(e.message),
  });
  const retry = trpc.discoveryResponseDrafter.draftSingle.useMutation({
    onSuccess: () => {
      toast.success("Re-drafted");
      utils.discoveryResponseDrafter.getIncoming.invalidate({ requestId });
    },
    onError: (e) => toast.error(e.message),
  });

  const onSave = () => {
    if (!draft) return;
    update.mutate({
      draftId: draft.id,
      responseType,
      responseText: responseText || null,
      objectionBasis: objectionBasis || null,
    });
  };

  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <div className="text-sm">
        <span className="font-semibold">Q{questionNumber}.</span> {questionText}
      </div>
      {draft ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <select
              value={responseType}
              onChange={(e) => setResponseType(e.target.value as ResponseType)}
              onBlur={onSave}
              disabled={isServed}
              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
            >
              {Object.entries(TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            {draft.aiGenerated && (
              <span className="text-xs text-zinc-500">AI</span>
            )}
            <div className="ml-auto">
              <button
                type="button"
                onClick={() => retry.mutate({ requestId, questionIndex })}
                disabled={retry.isPending || isServed}
                className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                {retry.isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <RefreshCw className="size-3" />
                )}
                Regenerate (1cr)
              </button>
            </div>
          </div>
          <textarea
            value={responseText}
            onChange={(e) => setResponseText(e.target.value)}
            onBlur={onSave}
            disabled={isServed}
            placeholder="Response text"
            className="min-h-[60px] w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-200"
          />
          {responseType === "object" && (
            <input
              type="text"
              value={objectionBasis}
              onChange={(e) => setObjectionBasis(e.target.value)}
              onBlur={onSave}
              disabled={isServed}
              placeholder="Objection basis (e.g. vague and ambiguous)"
              className="w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-200"
            />
          )}
        </div>
      ) : (
        <div className="text-xs text-zinc-500">
          (no response drafted yet)
        </div>
      )}
    </div>
  );
}
