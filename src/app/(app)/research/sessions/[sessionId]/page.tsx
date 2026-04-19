"use client";

import { useParams } from "next/navigation";
import { useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { Pencil, Check, X, Loader2, Search, FileText } from "lucide-react";
import { toast } from "sonner";

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { MemoGenerationModal } from "@/components/research/memo-generation-modal";
import { MemoListCard } from "@/components/research/memo-list-card";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return dateFmt.format(date);
}

export default function SessionDetailPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params?.sessionId ?? "";
  const utils = trpc.useUtils();

  const { data, isLoading, isError } = trpc.research.sessions.get.useQuery(
    { sessionId },
    { enabled: !!sessionId },
  );

  const stats = trpc.research.sessions.contextStats.useQuery(
    { sessionId },
    { enabled: !!sessionId },
  ).data;

  const memos = trpc.research.memo.list.useQuery(
    { sessionId },
    { enabled: !!sessionId },
  ).data?.memos ?? [];

  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [memoModalOpen, setMemoModalOpen] = useState(false);

  const renameMut = trpc.research.sessions.rename.useMutation({
    onSuccess: () => {
      void utils.research.sessions.get.invalidate({ sessionId });
      void utils.research.sessions.list.invalidate();
      toast.success("Title updated");
      setEditing(false);
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (isError || !data?.session) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Session not found.</p>
        <Link href="/research" className="mt-3 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400">
          Back to Research
        </Link>
      </div>
    );
  }

  const { session, queries } = data;

  const startEdit = () => {
    setDraftTitle(session.title);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraftTitle("");
  };

  const saveTitle = () => {
    const t = draftTitle.trim();
    if (!t || t === session.title) {
      cancelEdit();
      return;
    }
    renameMut.mutate({ sessionId, title: t });
  };

  const onTitleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveTitle();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-start justify-between gap-3">
        {editing ? (
          <div className="flex flex-1 items-center gap-2">
            <Input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onKeyDown={onTitleKey}
              autoFocus
              className="text-lg"
              disabled={renameMut.isPending}
            />
            <Button size="icon" variant="ghost" onClick={saveTitle} disabled={renameMut.isPending} aria-label="Save title">
              {renameMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </Button>
            <Button size="icon" variant="ghost" onClick={cancelEdit} disabled={renameMut.isPending} aria-label="Cancel">
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-2">
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{session.title}</h1>
            <Button size="icon" variant="ghost" onClick={startEdit} aria-label="Edit title">
              <Pencil className="h-4 w-4" />
            </Button>
          </div>
        )}
        <Button size="sm" variant="outline" onClick={() => setMemoModalOpen(true)}>
          <FileText className="mr-1.5 h-4 w-4" />
          Generate memo
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        {session.caseId ? (
          <Link
            href={`/cases/${session.caseId}`}
            className="inline-flex items-center"
          >
            <Badge variant="secondary">
              Case {session.caseId.slice(0, 8)}
            </Badge>
          </Link>
        ) : null}
        <span>Created {formatDate(session.createdAt)}</span>
        <span>·</span>
        <span>Updated {formatDate(session.updatedAt)}</span>
      </div>

      <Separator className="mt-4" />

      <section>
        <h2 className="mt-6 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Query history
        </h2>
        {queries.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            No queries in this session yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {queries.map((q) => (
              <li key={q.id}>
                {/* TODO: /research page does not yet parse ?q= from URL; follow-up can wire URL sync. */}
                <Link
                  href={`/research?q=${encodeURIComponent(q.queryText)}&sessionId=${session.id}`}
                  className="flex items-center gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                >
                  <Search className="h-4 w-4 shrink-0 text-zinc-400" />
                  <span className="flex-1 truncate text-zinc-800 dark:text-zinc-200">
                    {q.queryText}
                  </span>
                  <Badge variant="outline">{q.resultCount} results</Badge>
                  <span className="text-xs text-zinc-400">
                    {formatDate(q.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mt-6 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Chat messages
        </h2>
        {/* TODO: research_chat_messages is persisted by LegalRagService but not yet joined into sessions.get. */}
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          Chat history coming soon.
        </p>
      </section>

      {session.caseId ? (
        <section>
          <h2 className="mt-6 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Linked case
          </h2>
          {/* TODO: future task should join case name into sessions.get response. */}
          <Link
            href={`/cases/${session.caseId}`}
            className="mt-3 inline-flex items-center"
          >
            <Badge variant="secondary">
              Case {session.caseId.slice(0, 8)}
            </Badge>
          </Link>
        </section>
      ) : null}

      {memos.length > 0 && (
        <section>
          <h2 className="mt-6 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Memos from this session ({memos.length})
          </h2>
          <ul className="mt-3 grid gap-2">
            {memos.map((m) => (
              <li key={m.id}>
                <MemoListCard memo={m} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <MemoGenerationModal
        open={memoModalOpen}
        onOpenChange={setMemoModalOpen}
        sessionId={sessionId}
        defaultQuestion={session.title}
        bookmarkCount={stats?.bookmarkCount ?? 0}
        chatCount={stats?.chatCount ?? 0}
        statuteCount={stats?.statuteCount ?? 0}
      />
    </div>
  );
}
