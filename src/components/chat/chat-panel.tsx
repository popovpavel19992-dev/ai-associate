"use client";

import { useState } from "react";
import { MessageSquare, ChevronRight, FileText, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useChat } from "@/hooks/use-chat";
import { ChatMessages } from "./chat-messages";
import { ChatInput } from "./chat-input";

interface ChatPanelProps {
  caseId: string;
  documentId?: string;
  documentName?: string;
  className?: string;
}

export function ChatPanel({
  caseId,
  documentId,
  documentName,
  className,
}: ChatPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const { messages, isLoading, error, disclaimer, sendMessage, isInitialLoading } =
    useChat({ caseId, documentId });

  if (isCollapsed) {
    return (
      <div className={cn("flex flex-col items-center border-l py-4", className)}>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsCollapsed(false)}
          aria-label="Open chat"
        >
          <MessageSquare className="size-5" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex w-80 flex-col border-l bg-background",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Chat</span>
          <Badge variant="secondary">
            {documentId ? (
              <>
                <FileText className="mr-1 size-3" />
                Doc
              </>
            ) : (
              <>
                <Briefcase className="mr-1 size-3" />
                Case
              </>
            )}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setIsCollapsed(true)}
          aria-label="Collapse chat"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {/* Scope indicator */}
      {documentId && documentName && (
        <div className="border-b bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
          Scope: <span className="font-medium text-foreground">{documentName}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Messages */}
      {isInitialLoading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading messages...
        </div>
      ) : (
        <ChatMessages
          messages={messages}
          isLoading={isLoading}
          disclaimer={disclaimer}
        />
      )}

      {/* Input */}
      <ChatInput onSend={sendMessage} isLoading={isLoading} />
    </div>
  );
}
