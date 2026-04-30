"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Sparkles,
  Star,
  Briefcase,
} from "lucide-react";
import { toast } from "sonner";

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export default function RuleDetailPage() {
  const params = useParams<{ ruleId: string }>();
  const router = useRouter();
  const ruleId = params?.ruleId;

  const utils = trpc.useUtils();
  const ruleQuery = trpc.courtRules.get.useQuery(
    { ruleId: ruleId ?? "" },
    { enabled: !!ruleId },
  );

  const [notes, setNotes] = React.useState("");
  const [notesDirty, setNotesDirty] = React.useState(false);

  React.useEffect(() => {
    if (ruleQuery.data) {
      setNotes(ruleQuery.data.bookmarkNotes ?? "");
      setNotesDirty(false);
    }
  }, [ruleQuery.data?.rule.id, ruleQuery.data?.bookmarkNotes]);

  const bookmarkMut = trpc.courtRules.bookmark.useMutation({
    onSuccess: async () => {
      await utils.courtRules.get.invalidate({ ruleId: ruleId ?? "" });
      await utils.courtRules.listBookmarks.invalidate();
      setNotesDirty(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const removeBookmarkMut = trpc.courtRules.removeBookmark.useMutation({
    onSuccess: async () => {
      await utils.courtRules.get.invalidate({ ruleId: ruleId ?? "" });
      await utils.courtRules.listBookmarks.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // Per-session AI explain cache, keyed by ruleId. Survives tab life only.
  const [explanation, setExplanation] = React.useState<string | null>(null);
  const explainMut = trpc.courtRules.explain.useMutation({
    onSuccess: (out) => setExplanation(out.explanation),
    onError: (e) => toast.error(e.message),
  });
  React.useEffect(() => {
    setExplanation(null);
  }, [ruleId]);

  // Apply-to-case modal state.
  const [applyOpen, setApplyOpen] = React.useState(false);
  const [selectedCase, setSelectedCase] = React.useState<string | null>(null);
  const [applicationText, setApplicationText] = React.useState<string | null>(null);
  const myCasesQuery = trpc.courtRules.myCases.useQuery(undefined, { enabled: applyOpen });
  const applyMut = trpc.courtRules.applyToCase.useMutation({
    onSuccess: (out) => setApplicationText(out.application),
    onError: (e) => toast.error(e.message),
  });

  if (!ruleId) return null;
  if (ruleQuery.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    );
  }
  if (!ruleQuery.data) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-zinc-500">Rule not found.</p>
        <Button variant="link" onClick={() => router.push("/rules")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to rules
        </Button>
      </div>
    );
  }

  const { rule, parent, children, isBookmarked } = ruleQuery.data;

  function toggleBookmark() {
    if (isBookmarked) {
      removeBookmarkMut.mutate({ ruleId: rule.id });
    } else {
      bookmarkMut.mutate({ ruleId: rule.id, notes: notes.trim() || null });
    }
  }

  function saveNotes() {
    if (!isBookmarked) return;
    bookmarkMut.mutate({ ruleId: rule.id, notes: notes.trim() || null });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <Link
        href="/rules"
        className="inline-flex items-center text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        <ArrowLeft className="mr-1 h-4 w-4" /> All rules
      </Link>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-mono">
            {rule.jurisdiction}
          </Badge>
          <Badge variant="outline">{rule.category}</Badge>
          <span className="font-mono text-sm text-zinc-500">{rule.citationShort}</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{rule.title}</h1>
        <p className="text-xs text-zinc-500">{rule.citationFull}</p>

        {parent && (
          <Link
            href={`/rules/${parent.id}`}
            className="inline-flex items-center text-xs text-zinc-500 hover:underline"
          >
            ↑ Parent: {parent.citationShort} — {parent.title}
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={isBookmarked ? "default" : "outline"}
          size="sm"
          onClick={toggleBookmark}
          disabled={bookmarkMut.isPending || removeBookmarkMut.isPending}
        >
          <Star
            className={cn(
              "mr-1 h-4 w-4",
              isBookmarked && "fill-amber-400 text-amber-500",
            )}
          />
          {isBookmarked ? "Bookmarked" : "Bookmark"}
        </Button>
        {rule.sourceUrl && (
          <a
            href={rule.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <ExternalLink className="mr-1 h-4 w-4" /> Source
          </a>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => explainMut.mutate({ ruleId: rule.id })}
          disabled={explainMut.isPending || explanation !== null}
        >
          {explainMut.isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-1 h-4 w-4" />
          )}
          Explain in plain English
        </Button>
        <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
          <DialogTrigger
            render={
              <Button variant="outline" size="sm">
                <Briefcase className="mr-1 h-4 w-4" /> Apply to a case
              </Button>
            }
          />
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Apply {rule.citationShort} to a case</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Pick one of your cases. The AI will use the case's facts and case type to
                evaluate how this rule applies.
              </p>
              {myCasesQuery.isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                </div>
              ) : (myCasesQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-zinc-500">You have no cases yet.</p>
              ) : (
                <ul className="max-h-64 space-y-1 overflow-auto">
                  {myCasesQuery.data?.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedCase(c.id)}
                        className={cn(
                          "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                          selectedCase === c.id
                            ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-800"
                            : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50",
                        )}
                      >
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-zinc-500">
                          {c.caseType ?? "—"} · {c.status}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setApplyOpen(false);
                    setApplicationText(null);
                    setSelectedCase(null);
                  }}
                >
                  Close
                </Button>
                <Button
                  onClick={() => {
                    if (selectedCase) {
                      applyMut.mutate({ ruleId: rule.id, caseId: selectedCase });
                    }
                  }}
                  disabled={!selectedCase || applyMut.isPending}
                >
                  {applyMut.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  Run
                </Button>
              </div>
              {applicationText && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm whitespace-pre-wrap dark:border-amber-800 dark:bg-amber-950/30">
                  {applicationText}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {explanation && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm whitespace-pre-wrap dark:border-blue-800 dark:bg-blue-950/30">
          <div className="mb-1 flex items-center gap-1 text-xs font-medium text-blue-900 dark:text-blue-200">
            <Sparkles className="h-3 w-3" /> Plain-English explanation
          </div>
          {explanation}
        </div>
      )}

      <article className="rounded-lg border border-zinc-200 bg-white p-5 text-sm leading-relaxed whitespace-pre-wrap dark:border-zinc-800 dark:bg-zinc-950">
        {rule.body}
      </article>

      {isBookmarked && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-zinc-500">My notes on this rule</label>
          <Textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setNotesDirty(true);
            }}
            onBlur={() => {
              if (notesDirty) saveNotes();
            }}
            rows={3}
            placeholder="Personal notes — saved when you click out of the box."
          />
        </div>
      )}

      {children.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Sub-rules</h2>
          <ul className="space-y-1">
            {children.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/rules/${c.id}`}
                  className="block rounded-md border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                >
                  <span className="font-mono text-zinc-500">{c.citationShort}</span> — {c.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
