// src/components/cases/message-bubble.tsx
"use client";

import { format } from "date-fns";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  message: {
    id: string;
    authorType: "lawyer" | "client";
    body: string;
    createdAt: string | Date;
    lawyerName: string | null;
    portalName: string | null;
    documentId: string | null;
    documentName: string | null;
  };
  /** True when the current user is the author. Right-aligned + primary color. */
  isMine: boolean;
}

export function MessageBubble({ message, isMine }: MessageBubbleProps) {
  const author = message.authorType === "lawyer" ? message.lawyerName : message.portalName;
  const time = typeof message.createdAt === "string" ? new Date(message.createdAt) : message.createdAt;
  return (
    <div className={cn("flex", isMine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-lg p-3 text-sm",
          isMine ? "bg-primary text-primary-foreground" : "bg-muted",
        )}
      >
        {!isMine && author && (
          <p className="mb-1 text-xs font-medium opacity-80">{author}</p>
        )}
        <p className="whitespace-pre-wrap">{message.body}</p>
        {message.documentId && message.documentName && (
          // NOTE: /api/documents/${id}/download route does not yet exist.
          // Rendered as a non-link <span> chip for MVP. When the download
          // route is added, replace <span> with <a href={...}>.
          <span
            className="mt-2 inline-flex items-center gap-1 rounded border border-current/20 bg-background/10 px-2 py-1 text-xs"
          >
            <Paperclip className="size-3" aria-hidden /> {message.documentName}
          </span>
        )}
        <p className="mt-1 text-right text-[10px] opacity-70">{format(time, "h:mm a")}</p>
      </div>
    </div>
  );
}
