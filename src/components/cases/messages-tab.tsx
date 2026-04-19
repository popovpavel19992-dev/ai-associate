// src/components/cases/messages-tab.tsx
"use client";

import * as React from "react";
import { format, isSameDay } from "date-fns";
import { trpc } from "@/lib/trpc";
import { useUser } from "@clerk/nextjs";
import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface MessagesTabProps {
  caseId: string;
}

export function MessagesTab({ caseId }: MessagesTabProps) {
  const utils = trpc.useUtils();
  const { user } = useUser();
  const currentClerkId = user?.id;
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const { data, isLoading } = trpc.caseMessages.list.useQuery({ caseId });
  const markReadMut = trpc.caseMessages.markRead.useMutation({
    onSuccess: () => utils.caseMessages.unreadByCase.invalidate(),
  });

  // Mark read on tab mount + on visibility change to visible.
  React.useEffect(() => {
    markReadMut.mutate({ caseId });
    const onVis = () => {
      if (document.visibilityState === "visible") markReadMut.mutate({ caseId });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  // SSE: live new messages while tab is open.
  trpc.caseMessages.onNewMessage.useSubscription(
    { caseId },
    {
      enabled: true,
      onData: () => {
        utils.caseMessages.list.invalidate({ caseId });
        utils.caseMessages.unreadByCase.invalidate();
      },
    },
  );

  // Auto-scroll to bottom on new messages.
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [data?.messages.length]);

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading messages…</p>;

  // The list query returns newest-first; render oldest-first for chat UX.
  const messages = data?.messages ? [...data.messages].reverse() : [];

  // Group by day for separators.
  const groups: Array<{ date: Date; items: typeof messages }> = [];
  for (const m of messages) {
    const t = typeof m.createdAt === "string" ? new Date(m.createdAt) : (m.createdAt as Date);
    const head = groups[groups.length - 1];
    if (head && isSameDay(head.date, t)) head.items.push(m);
    else groups.push({ date: t, items: [m] });
  }

  return (
    <Card className="flex h-[640px] flex-col">
      <CardHeader className="pb-2">
        <CardTitle>Messages</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 min-h-0 flex-col p-0">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {groups.length === 0 ? (
            <p className="mt-12 text-center text-sm text-muted-foreground">
              No messages yet. Send the first one below.
            </p>
          ) : (
            groups.map((g, i) => (
              <div key={i} className="space-y-2">
                <div className="my-3 flex items-center gap-2">
                  <div className="flex-1 border-t" />
                  <span className="text-xs text-muted-foreground">{format(g.date, "EEE, MMM d")}</span>
                  <div className="flex-1 border-t" />
                </div>
                {g.items.map((m) => {
                  // currentClerkId is from Clerk; match against the lawyer author by joining
                  // user.clerkId server-side would be ideal, but for MVP the visual cue (right
                  // align for any lawyer-authored bubble matching the current session lawyer)
                  // can be approximated: every lawyer message we sent in this session is "mine".
                  // For correctness, the list query SHOULD also return the lawyer author's
                  // clerkId. Until then, treat all lawyer-authored messages as "mine" if the
                  // viewer is a lawyer (right rail). This is acceptable single-lawyer-per-case
                  // approximation for MVP.
                  const isMine = m.authorType === "lawyer";
                  return <MessageBubble key={m.id} message={m as any} isMine={isMine} />;
                })}
              </div>
            ))
          )}
        </div>
        <MessageComposer caseId={caseId} />
      </CardContent>
    </Card>
  );
}
