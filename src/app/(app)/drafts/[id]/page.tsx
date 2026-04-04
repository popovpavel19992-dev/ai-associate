"use client";

import { use, useState } from "react";
import { notFound } from "next/navigation";
import { Loader2, ArrowLeft, AlertCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { useRealtimeDraft } from "@/hooks/use-realtime-draft";
import { DraftClauseNav } from "@/components/drafts/draft-clause-nav";
import { DraftClauseEditor } from "@/components/drafts/draft-clause-editor";
import { DraftChatPanel } from "@/components/drafts/draft-chat-panel";
import { DraftActionBar } from "@/components/drafts/draft-action-bar";
import Link from "next/link";
import type { DraftStatus } from "@/lib/types";

export default function DraftEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [selectedClauseId, setSelectedClauseId] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const { data, isLoading, error } = trpc.drafts.getById.useQuery(
    { draftId: id },
  );

  const { status } = useRealtimeDraft(id, (data?.status as DraftStatus) ?? "draft");

  const regenerate = trpc.drafts.regenerate.useMutation({
    onSuccess: () => utils.drafts.getById.invalidate({ draftId: id }),
  });

  const updateClause = trpc.drafts.updateClause.useMutation({
    onSuccess: () => utils.drafts.getById.invalidate({ draftId: id }),
  });

  const rewriteClauseMutation = trpc.drafts.rewriteClause.useMutation();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    if (error?.data?.code === "NOT_FOUND") notFound();
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <AlertCircle className="size-8 text-destructive" />
        <p className="text-sm text-muted-foreground">{error?.message ?? "Failed to load draft."}</p>
        <Button variant="outline" onClick={() => utils.drafts.getById.invalidate({ draftId: id })}>
          Retry
        </Button>
      </div>
    );
  }

  const isGenerating = status === "generating" || status === "draft";
  const isFailed = status === "failed";

  if (isGenerating) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm font-medium">Generating your contract...</p>
        <p className="text-xs text-muted-foreground">
          This may take a minute. The page will update automatically.
        </p>
      </div>
    );
  }

  if (isFailed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <AlertCircle className="size-8 text-destructive" />
        <p className="text-sm text-muted-foreground">Generation failed. Please try again.</p>
        <Button
          onClick={() => regenerate.mutate({ draftId: id })}
          disabled={regenerate.isPending}
        >
          {regenerate.isPending && <Loader2 className="size-4 animate-spin" data-icon="inline-start" />}
          Retry Generation
        </Button>
      </div>
    );
  }

  const selectedClause = data.clauses.find((c) => c.id === selectedClauseId) ?? data.clauses[0] ?? null;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href="/drafts">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="size-4" data-icon="inline-start" />
              Back
            </Button>
          </Link>
          <h1 className="text-sm font-semibold">{data.name}</h1>
          {data.linkedCaseName && (
            <span className="text-xs text-muted-foreground">
              Linked to: {data.linkedCaseName}
            </span>
          )}
        </div>
      </div>

      {/* Three-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: Clause Navigation */}
        <div className="w-[200px] border-r">
          <DraftClauseNav
            clauses={data.clauses}
            selectedClauseId={selectedClause?.id ?? null}
            onSelectClause={setSelectedClauseId}
          />
        </div>

        {/* Center panel: Clause Editor */}
        <div className="flex-1 overflow-hidden">
          {selectedClause ? (
            <DraftClauseEditor
              key={selectedClause.id}
              clause={selectedClause}
              fullText={data.generatedText ?? ""}
              onSave={(text) =>
                updateClause.mutate({ clauseId: selectedClause.id, userEditedText: text })
              }
              onRewrite={async (instruction) => {
                const result = await rewriteClauseMutation.mutateAsync({
                  clauseId: selectedClause.id,
                  instruction,
                });
                return result.text;
              }}
              onReset={() =>
                updateClause.mutate({ clauseId: selectedClause.id, userEditedText: null })
              }
              isSaving={updateClause.isPending}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a clause to edit
            </div>
          )}
        </div>

        {/* Right panel: Chat */}
        <div className="w-[300px] border-l">
          <DraftChatPanel
            draftId={id}
            clauseRef={selectedClause?.clauseNumber ?? undefined}
          />
        </div>
      </div>

      {/* Bottom action bar */}
      <DraftActionBar draftId={id} status={status} />
    </div>
  );
}
