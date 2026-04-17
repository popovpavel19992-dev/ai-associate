"use client";

import { useState, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";

export interface AssistantFlags {
  unverifiedCitations?: string[];
  uplViolations?: string[];
}

export type ChatMessage =
  | {
      id: string;
      role: "user";
      content: string;
      createdAt: Date;
    }
  | {
      id: string;
      role: "assistant";
      content: string;
      createdAt: Date;
      streaming?: boolean;
      flags?: AssistantFlags;
      messageId?: string;
    };

export interface UseResearchStreamOptions {
  sessionId: string;
  mode: "broad" | "deep";
  opinionInternalId?: string;
}

interface StreamChunk {
  type: string;
  content?: string;
  messageId?: string;
  flags?: AssistantFlags;
  error?: string;
}

export interface UseResearchStreamReturn {
  messages: ChatMessage[];
  streaming: boolean;
  error: string | null;
  send: (question: string, opts?: { topN?: number }) => void;
}

export function useResearchStream(
  opts: UseResearchStreamOptions,
): UseResearchStreamReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);
  const [topN, setTopN] = useState<number | undefined>(undefined);
  const assistantIdRef = useRef<string | null>(null);

  const broadInput =
    opts.mode === "broad" && activeQuestion
      ? { sessionId: opts.sessionId, question: activeQuestion, topN }
      : undefined;
  const deepInput =
    opts.mode === "deep" && activeQuestion && opts.opinionInternalId
      ? {
          sessionId: opts.sessionId,
          opinionInternalId: opts.opinionInternalId,
          question: activeQuestion,
        }
      : undefined;

  function onStarted() {
    setStreaming(true);
    setError(null);
    const assistantId = crypto.randomUUID();
    assistantIdRef.current = assistantId;
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: new Date(),
        streaming: true,
      },
    ]);
  }

  function onData(chunk: StreamChunk) {
    if (chunk.type === "token" && chunk.content) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantIdRef.current && m.role === "assistant"
            ? { ...m, content: m.content + (chunk.content ?? "") }
            : m,
        ),
      );
    } else if (chunk.type === "done") {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantIdRef.current && m.role === "assistant"
            ? {
                ...m,
                streaming: false,
                messageId: chunk.messageId,
                flags: chunk.flags,
              }
            : m,
        ),
      );
      setStreaming(false);
      setActiveQuestion(null);
    } else if (chunk.type === "error") {
      setError(chunk.error ?? "Stream error");
      setStreaming(false);
      setActiveQuestion(null);
    }
  }

  function onSubError(err: unknown) {
    setError(err instanceof Error ? err.message : "Subscription error");
    setStreaming(false);
    setActiveQuestion(null);
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  trpc.research.askBroad.useSubscription(broadInput as any, {
    enabled: !!broadInput,
    onStarted,
    onData: onData as any,
    onError: onSubError,
  });
  trpc.research.askDeep.useSubscription(deepInput as any, {
    enabled: !!deepInput,
    onStarted,
    onData: onData as any,
    onError: onSubError,
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const send = useCallback(
    (question: string, opts2?: { topN?: number }) => {
      if (streaming || !question.trim()) return;
      const trimmed = question.trim();
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      if (opts2?.topN !== undefined) setTopN(opts2.topN);
      setActiveQuestion(trimmed);
    },
    [streaming],
  );

  return { messages, streaming, error, send };
}
