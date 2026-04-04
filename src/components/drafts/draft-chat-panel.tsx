"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2, MessageSquare, Send, ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

interface DraftChatPanelProps {
  draftId: string;
  clauseRef?: string;
}

export function DraftChatPanel({ draftId, clauseRef }: DraftChatPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [message, setMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: messages, isLoading, refetch } = trpc.chat.list.useQuery(
    { draftId },
  );

  const sendMessage = trpc.chat.send.useMutation({
    onSuccess: () => {
      setMessage("");
      refetch();
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    const content = message.trim();
    if (!content || sendMessage.isPending) return;

    sendMessage.mutate({
      draftId,
      clauseRef,
      content,
    });
  };

  if (collapsed) {
    return (
      <div className="flex flex-col items-center border-l py-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(false)}
          className="mb-2"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full w-80 flex-col border-l">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MessageSquare className="h-4 w-4" />
          Chat
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(true)}
          className="h-7 w-7"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="space-y-3 p-3">
          {isLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {messages?.messages?.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "rounded-lg px-3 py-2 text-sm",
                msg.role === "user"
                  ? "ml-4 bg-primary text-primary-foreground"
                  : "mr-4 bg-muted",
              )}
            >
              {msg.content}
            </div>
          ))}

          {sendMessage.isPending && (
            <div className="mr-4 rounded-lg bg-muted px-3 py-2 text-sm">
              <Loader2 className="h-3 w-3 animate-spin" />
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Disclaimer */}
      <p className="px-3 py-1 text-[10px] text-muted-foreground">
        AI responses are not legal advice. Verify all outputs independently.
      </p>

      {/* Input */}
      <div className="flex gap-2 border-t p-3">
        <Input
          placeholder="Ask about this draft..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={sendMessage.isPending}
          className="flex-1"
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={!message.trim() || sendMessage.isPending}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
