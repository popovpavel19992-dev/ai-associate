"use client";

import { useEffect, useRef } from "react";
import { Scale, User } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/hooks/use-chat";

interface ChatMessagesProps {
  messages: ChatMessage[];
  isLoading: boolean;
  disclaimer: string | null;
}

export function ChatMessages({
  messages,
  isLoading,
  disclaimer,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, disclaimer]);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
        <Scale className="size-10 opacity-40" />
        <div>
          <p className="font-medium text-foreground">Ask about this case</p>
          <p className="mt-1 text-sm">
            Get clarifications on the analysis, ask follow-up questions, or
            explore specific details.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      {messages.map((message) => (
        <div
          key={message.id}
          className={cn(
            "flex gap-3",
            message.role === "user" ? "flex-row-reverse" : "flex-row",
          )}
        >
          <Avatar size="sm">
            <AvatarFallback>
              {message.role === "user" ? (
                <User className="size-3.5" />
              ) : (
                <Scale className="size-3.5" />
              )}
            </AvatarFallback>
          </Avatar>

          <div
            className={cn(
              "max-w-[80%] rounded-lg px-3 py-2 text-sm",
              message.role === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground",
            )}
          >
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
        </div>
      ))}

      {isLoading && (
        <div className="flex gap-3">
          <Avatar size="sm">
            <AvatarFallback>
              <Scale className="size-3.5" />
            </AvatarFallback>
          </Avatar>
          <div className="rounded-lg bg-muted px-3 py-2">
            <div className="flex gap-1">
              <span className="size-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:0ms]" />
              <span className="size-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:150ms]" />
              <span className="size-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:300ms]" />
            </div>
          </div>
        </div>
      )}

      {disclaimer && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {disclaimer}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
