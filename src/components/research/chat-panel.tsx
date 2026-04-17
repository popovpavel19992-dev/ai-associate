"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { AlertCircle, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useResearchStream } from "@/hooks/use-research-stream";
import { CitationChip } from "./citation-chip";
import { cn } from "@/lib/utils";

interface ChatPanelProps {
  sessionId: string;
  mode: "broad" | "deep";
  opinionInternalId?: string;
  className?: string;
}

export function ChatPanel({
  sessionId,
  mode,
  opinionInternalId,
  className,
}: ChatPanelProps) {
  const { messages, streaming, error, send } = useResearchStream({
    sessionId,
    mode,
    opinionInternalId,
  });
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  function submit() {
    const text = input.trim();
    if (!text || streaming) return;
    send(text);
    setInput("");
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const canSend = input.trim().length > 0 && !streaming;

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto p-3"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="mt-8 text-center text-sm text-muted-foreground">
            Ask a question about{" "}
            {mode === "deep" ? "this opinion" : "your search results"}.
          </div>
        ) : null}

        {messages.map((m) => {
          if (m.role === "user") {
            return (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                  {m.content}
                </div>
              </div>
            );
          }
          const unverified = m.flags?.unverifiedCitations ?? [];
          return (
            <div key={m.id} className="flex justify-start">
              <div className="max-w-[90%] space-y-2">
                <div className="rounded-lg bg-muted px-3 py-2 text-sm">
                  {m.content ? (
                    <span className="whitespace-pre-wrap">{m.content}</span>
                  ) : null}
                  {m.streaming ? (
                    <Loader2
                      className="ml-1 inline h-3 w-3 animate-spin text-muted-foreground"
                      aria-label="Streaming"
                    />
                  ) : null}
                </div>
                {!m.streaming && unverified.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {unverified.map((c, i) => (
                      <CitationChip
                        key={`${m.id}-unv-${i}`}
                        citation={c}
                        unverified
                      />
                    ))}
                  </div>
                ) : null}
                {!m.streaming ? (
                  <p className="text-xs text-muted-foreground">
                    Analysis only — not legal advice.
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {error ? (
        <div className="flex shrink-0 items-start gap-2 border-t border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="shrink-0 border-t border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              mode === "deep"
                ? "Ask about this opinion..."
                : "Ask about your search results..."
            }
            disabled={streaming}
            rows={2}
            className="min-h-[60px] resize-none"
          />
          <Button
            type="button"
            size="icon"
            onClick={submit}
            disabled={!canSend}
            aria-label="Send message"
          >
            {streaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
