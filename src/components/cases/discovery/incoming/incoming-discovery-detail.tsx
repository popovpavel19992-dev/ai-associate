"use client";
import { Loader2, FileDown, CheckCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ResponseRow } from "./response-row";
import { PredictResponseButton } from "@/components/cases/opposing-counsel/predict-response-button";

interface Props {
  requestId: string;
}

export function IncomingDiscoveryDetail({ requestId }: Props) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.discoveryResponseDrafter.getIncoming.useQuery({
    requestId,
  });
  const draftBatch = trpc.discoveryResponseDrafter.draftBatch.useMutation({
    onSuccess: (r) => {
      toast.success(
        `Drafted ${r.successCount} of ${r.successCount + r.failedCount} (${r.creditsCharged}cr)`,
      );
      utils.discoveryResponseDrafter.getIncoming.invalidate({ requestId });
    },
    onError: (e) => toast.error(e.message),
  });
  const markServed = trpc.discoveryResponseDrafter.markServed.useMutation({
    onSuccess: () => {
      toast.success("Marked as served");
      utils.discoveryResponseDrafter.getIncoming.invalidate({ requestId });
    },
    onError: (e) => toast.error(e.message),
  });
  const exportDocx = trpc.discoveryResponseDrafter.exportDocx.useQuery(
    { requestId },
    { enabled: false },
  );

  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  const { request, drafts } = data;
  const draftsByIndex = new Map(drafts.map((d) => [d.questionIndex, d]));
  const questions = request.questions as Array<{
    number: number;
    text: string;
    subparts?: string[];
  }>;
  const isServed = request.status === "served";
  const hasDrafts = drafts.length > 0;

  const onExport = async () => {
    const r = await exportDocx.refetch();
    if (!r.data?.base64) return toast.error("Export failed");
    const bin = atob(r.data.base64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `discovery-responses-${request.requestType}-set-${request.setNumber}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">
            {request.requestType.toUpperCase()} — Set {request.setNumber}
          </h2>
          <p className="text-xs text-zinc-500">
            From {request.servingParty} · {questions.length} questions · status:{" "}
            {request.status}
            {request.dueAt &&
              ` · due ${new Date(request.dueAt).toLocaleDateString()}`}
          </p>
        </div>
        <div className="flex gap-2">
          {!hasDrafts && !isServed && (
            <Button
              size="sm"
              disabled={draftBatch.isPending}
              onClick={() => draftBatch.mutate({ requestId })}
            >
              {draftBatch.isPending ? (
                <Loader2 className="mr-1.5 size-3 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 size-3" />
              )}
              Draft all responses ({questions.length}cr)
            </Button>
          )}
          {hasDrafts && (
            <Button
              size="sm"
              variant="outline"
              onClick={onExport}
              disabled={exportDocx.isFetching}
            >
              <FileDown className="mr-1.5 size-3" /> Export DOCX
            </Button>
          )}
          {hasDrafts && !isServed && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => markServed.mutate({ requestId })}
            >
              <CheckCircle className="mr-1.5 size-3" /> Mark as served
            </Button>
          )}
          {hasDrafts && (
            <PredictResponseButton
              caseId={request.caseId}
              kind="discovery_set"
              targetId={requestId}
              targetTitle={`${request.requestType.toUpperCase()} — Set ${request.setNumber}`}
              targetBody={drafts
                .map(
                  (d, i) =>
                    `Q${questions[i]?.number ?? i + 1}: ${
                      questions[i]?.text ?? ""
                    }\nA: ${d.responseText ?? ""}`,
                )
                .join("\n\n")}
            />
          )}
        </div>
      </header>

      <div className="space-y-3">
        {questions.map((q, i) => (
          <ResponseRow
            key={i}
            requestId={requestId}
            questionIndex={i}
            questionNumber={q.number}
            questionText={q.text}
            draft={draftsByIndex.get(i) ?? null}
            isServed={isServed}
          />
        ))}
      </div>
    </div>
  );
}
