"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}

interface UseChatOptions {
  caseId: string;
  documentId?: string;
}

export function useChat({ caseId, documentId }: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const listQuery = trpc.chat.list.useQuery(
    { caseId, documentId, limit: 20 },
    { enabled: !!caseId },
  );

  // Sync fetched messages
  useEffect(() => {
    if (listQuery.data?.messages) {
      setMessages(
        listQuery.data.messages.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          createdAt: m.createdAt,
        })),
      );
    }
  }, [listQuery.data]);

  // Reset when scope changes
  useEffect(() => {
    setMessages([]);
    setError(null);
    setDisclaimer(null);
  }, [caseId, documentId]);

  const sendMutation = trpc.chat.send.useMutation();

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      setError(null);
      setDisclaimer(null);

      // Optimistic user message
      const optimisticId = `optimistic-${Date.now()}`;
      const userMsg: ChatMessage = {
        id: optimisticId,
        role: "user",
        content: content.trim(),
        createdAt: new Date(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      try {
        const result = await sendMutation.mutateAsync({
          caseId,
          documentId,
          content: content.trim(),
        });

        // Replace optimistic message with real one and add assistant response
        setMessages((prev) => {
          const withoutOptimistic = prev.filter((m) => m.id !== optimisticId);
          return [
            ...withoutOptimistic,
            {
              id: result.userMessage.id,
              role: "user" as const,
              content: result.userMessage.content,
              createdAt: result.userMessage.createdAt,
            },
            {
              id: result.assistantMessage.id,
              role: "assistant" as const,
              content: result.assistantMessage.content,
              createdAt: result.assistantMessage.createdAt,
            },
          ];
        });

        if (result.disclaimer) {
          setDisclaimer(result.disclaimer);
        }
      } catch (err) {
        // Remove optimistic message on error
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        setError(
          err instanceof Error ? err.message : "Failed to send message",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [caseId, documentId, isLoading, sendMutation],
  );

  return {
    messages,
    isLoading,
    error,
    disclaimer,
    sendMessage,
    scrollRef,
    isInitialLoading: listQuery.isLoading,
  };
}
