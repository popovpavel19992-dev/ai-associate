"use client";
import { Loader2, Sparkles, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface Chunk {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  similarity: number;
}

interface Citation {
  kind: "document" | "deadline" | "filing" | "motion" | "message";
  id: string;
  excerpt?: string;
}

interface Props {
  isLoading: boolean;
  template: { id: string; slug: string; name: string } | null;
  confidence: number;
  suggestedTitle: string;
  citedEntities: Citation[];
  autoPulledChunks: Chunk[];
  onConfirm: () => void;
  onCustomize: () => void;
}

export function MotionDrafterPreview({
  isLoading,
  template,
  confidence,
  suggestedTitle,
  citedEntities,
  autoPulledChunks,
  onConfirm,
  onCustomize,
}: Props) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-zinc-900">
        <CardContent className="space-y-3 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-amber-400" />
            <h3 className="font-medium text-zinc-100">AI Suggestion</h3>
          </div>

          {template ? (
            <div>
              <p className="text-sm text-zinc-400">Suggested template</p>
              <p className="font-medium text-zinc-100">{template.name}</p>
              <p className="text-xs text-zinc-500">
                Confidence: {(confidence * 100).toFixed(0)}%
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-md border border-amber-900/40 bg-amber-950/20 p-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
              <p className="text-sm text-amber-200">
                AI couldn&apos;t confidently match a template. Pick one in the next step.
              </p>
            </div>
          )}

          <div>
            <p className="text-sm text-zinc-400">Suggested title</p>
            <p className="text-sm text-zinc-200">{suggestedTitle}</p>
          </div>

          <div>
            <p className="text-sm text-zinc-400">
              Auto-pulled excerpts ({autoPulledChunks.length})
            </p>
            <ul className="mt-1 space-y-1 text-xs text-zinc-400">
              {autoPulledChunks.slice(0, 5).map((c, i) => (
                <li
                  key={`${c.documentId}-${c.chunkIndex}-${i}`}
                  className="truncate"
                >
                  <span className="text-zinc-500">[{c.documentTitle}]</span>{" "}
                  {c.content.slice(0, 100)}…
                </li>
              ))}
              {autoPulledChunks.length === 0 && (
                <li className="text-zinc-500">
                  (none — no embeddings yet for this case)
                </li>
              )}
            </ul>
          </div>

          <div>
            <p className="text-sm text-zinc-400">
              Cited entities ({citedEntities.length})
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {citedEntities.map((c) => (
                <span
                  key={`${c.kind}-${c.id}`}
                  className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
                >
                  {c.kind}
                </span>
              ))}
              {citedEntities.length === 0 && (
                <span className="text-xs text-zinc-500">(none)</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={onConfirm}>Confirm &amp; continue</Button>
        <Button variant="outline" onClick={onCustomize}>
          Customize
        </Button>
      </div>
    </div>
  );
}
