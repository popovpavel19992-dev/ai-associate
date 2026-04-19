// src/components/research/memo-rewrite-chat.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface MemoRewriteChatProps {
  memoId: string;
  sectionType: "issue" | "rule" | "application" | "conclusion";
}

export function MemoRewriteChat({ memoId, sectionType }: MemoRewriteChatProps) {
  const [steering, setSteering] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const [activeSteering, setActiveSteering] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const utils = trpc.useUtils();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const onFocus = () => textareaRef.current?.focus();
    window.addEventListener("memo:focus-rewrite-input", onFocus);
    return () => window.removeEventListener("memo:focus-rewrite-input", onFocus);
  }, []);

  trpc.research.memo.regenerateSection.useSubscription(
    { memoId, sectionType, steeringMessage: activeSteering ?? undefined },
    {
      enabled: !!activeSteering,
      onStarted: () => {
        setStreaming(true);
        setPreview("");
      },
      onData: (chunk) => {
        if (chunk.type === "token" && chunk.content) {
          setPreview((p) => (p ?? "") + chunk.content);
        } else if (chunk.type === "done") {
          setStreaming(false);
          setActiveSteering(null);
          utils.research.memo.get.invalidate({ memoId });
        } else if (chunk.type === "error") {
          setStreaming(false);
          setActiveSteering(null);
        }
      },
      onError: () => {
        setStreaming(false);
        setActiveSteering(null);
      },
    },
  );

  const submit = () => {
    if (streaming) return;
    setActiveSteering(steering.trim() || "");
    setSteering("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-medium">Rewrite section</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Regenerate this section with optional guidance.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-3 text-sm">
        {preview === null ? (
          <p className="mt-8 text-center text-muted-foreground">
            Type guidance below (or just hit Send) to rewrite this section.
          </p>
        ) : (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Preview</p>
            <p className="mt-2 whitespace-pre-wrap">{preview}</p>
            {streaming && <Loader2 className="mt-2 inline size-3 animate-spin" />}
          </div>
        )}
      </div>
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <Textarea
          ref={textareaRef}
          value={steering}
          onChange={(e) => setSteering(e.target.value)}
          placeholder="Optional: 'focus on damages calculation'"
          className="min-h-[80px] text-sm"
          disabled={streaming}
        />
        <div className="mt-2 flex justify-end">
          <Button onClick={submit} disabled={streaming}>
            {streaming ? "Rewriting…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
