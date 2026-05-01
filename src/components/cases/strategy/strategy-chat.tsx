"use client";
import { Loader2, Send } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export function StrategyChat({ caseId }: { caseId: string }) {
  const [body, setBody] = useState("");
  const utils = trpc.useUtils();
  const { data: msgs, isLoading } = trpc.caseStrategyChat.list.useQuery({
    caseId,
  });
  const send = trpc.caseStrategyChat.send.useMutation({
    onSuccess: () => {
      setBody("");
      utils.caseStrategyChat.list.invalidate({ caseId });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="flex h-full flex-col rounded-lg border border-zinc-800 bg-zinc-900">
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-zinc-500" />
          </div>
        ) : (msgs ?? []).length === 0 ? (
          <p className="py-12 text-center text-sm text-zinc-500">
            Ask a follow-up about your strategy…
          </p>
        ) : (
          (msgs ?? []).map((m) => (
            <div
              key={m.id}
              className={`rounded-lg p-2.5 text-sm ${
                m.role === "user"
                  ? "ml-8 bg-zinc-800"
                  : "mr-8 border border-zinc-800 bg-zinc-950"
              }`}
            >
              <div className="mb-1 text-xs uppercase tracking-wider text-zinc-500">
                {m.role}
              </div>
              <div className="whitespace-pre-wrap text-zinc-200">{m.body}</div>
            </div>
          ))
        )}
      </div>
      <form
        className="flex gap-2 border-t border-zinc-800 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) send.mutate({ caseId, body: body.trim() });
        }}
      >
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Ask a follow-up… (1 credit)"
          className="min-h-[60px] flex-1 resize-none"
          disabled={send.isPending}
          onKeyDown={(e) => {
            if (
              (e.metaKey || e.ctrlKey) &&
              e.key === "Enter" &&
              body.trim()
            ) {
              send.mutate({ caseId, body: body.trim() });
            }
          }}
        />
        <Button type="submit" disabled={send.isPending || !body.trim()}>
          {send.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </Button>
      </form>
    </div>
  );
}
