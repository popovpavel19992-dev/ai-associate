// src/components/cases/emails/replies-section.tsx
"use client";

import * as React from "react";
import { ReplyRow, type ReplyRowData } from "./reply-row";

export function RepliesSection({
  replies,
  onReply,
}: {
  replies: ReplyRowData[];
  onReply: (reply: ReplyRowData) => void;
}) {
  const [showAutoReplies, setShowAutoReplies] = React.useState(false);
  if (replies.length === 0) return null;

  const human = replies.filter((r) => r.replyKind === "human");
  const auto = replies.filter((r) => r.replyKind === "auto_reply");

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Replies ({replies.length})</h4>
        {auto.length > 0 && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:underline"
            onClick={() => setShowAutoReplies((v) => !v)}
          >
            {showAutoReplies ? "Hide" : "Show"} {auto.length} auto-{auto.length === 1 ? "reply" : "replies"}
          </button>
        )}
      </div>
      {human.map((r) => <ReplyRow key={r.id} reply={r} onReply={onReply} />)}
      {showAutoReplies && auto.map((r) => <ReplyRow key={r.id} reply={r} defaultCollapsed onReply={onReply} />)}
    </div>
  );
}
