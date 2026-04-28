"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useActivityTracker } from "@/lib/activity-tracker";
import {
  VoirDireQuestionFormDialog,
  VoirDireLibraryPickerDialog,
  type VoirDireQuestionFormValues,
} from "./voir-dire-question-form-dialog";

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  final: "bg-blue-100 text-blue-800",
  submitted: "bg-green-100 text-green-800",
  closed: "bg-zinc-100 text-zinc-700",
};

const SOURCE_BADGE: Record<string, string> = {
  library: "bg-emerald-900 text-emerald-100",
  manual: "bg-zinc-800 text-zinc-200",
  modified: "bg-amber-900 text-amber-100",
};

const CATEGORY_LABEL: Record<string, string> = {
  background: "Background",
  employment: "Employment",
  prior_jury_experience: "Prior Jury Experience",
  attitudes_bias: "Attitudes & Bias",
  case_specific: "Case-Specific",
  follow_up: "Follow-up",
};

const CATEGORY_ORDER: Array<keyof typeof CATEGORY_LABEL> = [
  "background",
  "employment",
  "prior_jury_experience",
  "attitudes_bias",
  "case_specific",
  "follow_up",
];

type Question = {
  id: string;
  setId: string;
  questionOrder: number;
  category:
    | "background"
    | "employment"
    | "prior_jury_experience"
    | "attitudes_bias"
    | "case_specific"
    | "follow_up";
  text: string;
  followUpPrompt: string | null;
  isForCause: boolean;
  jurorPanelTarget: "all" | "individual";
  source: "library" | "manual" | "modified";
  sourceTemplateId: string | null;
  notes: string | null;
};

export function VoirDireSetDetail({
  caseId,
  setId,
}: {
  caseId: string;
  setId: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  useActivityTracker(caseId, "voir_dire_edit", { setId });
  const { data, isLoading, refetch } = trpc.voirDire.getSet.useQuery({ setId });

  const [addOpen, setAddOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [editing, setEditing] = useState<Question | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [submittedAt, setSubmittedAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );

  const invalidate = () => {
    utils.voirDire.getSet.invalidate({ setId });
    utils.voirDire.listForCase.invalidate({ caseId });
    refetch();
  };

  const addQ = trpc.voirDire.addQuestion.useMutation({
    onSuccess: () => {
      toast.success("Question added");
      setAddOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const updateQ = trpc.voirDire.updateQuestion.useMutation({
    onSuccess: () => {
      toast.success("Question updated");
      setEditing(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteQ = trpc.voirDire.deleteQuestion.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const reorder = trpc.voirDire.reorderQuestions.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const finalize = trpc.voirDire.finalize.useMutation({
    onSuccess: () => {
      toast.success("Finalized");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const markSubmitted = trpc.voirDire.markSubmitted.useMutation({
    onSuccess: () => {
      toast.success("Marked as submitted");
      setShowSubmitDialog(false);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.voirDire.delete.useMutation({
    onSuccess: () => {
      utils.voirDire.listForCase.invalidate({ caseId });
      router.push(`/cases/${caseId}?tab=trial-prep`);
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading || !data) {
    return <p className="p-6 text-sm text-gray-500">Loading…</p>;
  }

  const { set, questions } = data as { set: any; questions: Question[] };
  const isDraft = set.status === "draft";
  const isFinal = set.status === "final";
  const isSubmitted = set.status === "submitted";
  const editable = isDraft;

  const grouped: Record<string, Question[]> = {};
  for (const q of questions) {
    grouped[q.category] = grouped[q.category] ? [...grouped[q.category], q] : [q];
  }

  const move = (q: Question, dir: -1 | 1) => {
    const idx = questions.findIndex((x) => x.id === q.id);
    const target = idx + dir;
    if (target < 0 || target >= questions.length) return;
    const next = [...questions];
    [next[idx], next[target]] = [next[target], next[idx]];
    reorder.mutate({ setId, orderedIds: next.map((e) => e.id) });
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onSubmitAdd = (v: VoirDireQuestionFormValues) => {
    addQ.mutate({
      setId,
      category: v.category,
      text: v.text,
      followUpPrompt: v.followUpPrompt.trim() || null,
      isForCause: v.isForCause,
      jurorPanelTarget: v.jurorPanelTarget,
      notes: v.notes.trim() || null,
    });
  };
  const onSubmitEdit = (v: VoirDireQuestionFormValues) => {
    if (!editing) return;
    updateQ.mutate({
      questionId: editing.id,
      category: v.category,
      text: v.text,
      followUpPrompt: v.followUpPrompt.trim() || null,
      isForCause: v.isForCause,
      jurorPanelTarget: v.jurorPanelTarget,
      notes: v.notes.trim() || null,
    });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <Link
              href={`/cases/${caseId}?tab=trial-prep`}
              className="text-sm text-zinc-400 hover:text-zinc-100"
            >
              ← Trial Prep
            </Link>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                STATUS_BADGE[set.status] ?? "bg-gray-100 text-gray-800"
              }`}
            >
              {set.status}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-bold">{set.title}</h1>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-500">
            <span>Set {set.setNumber}</span>
            <span>Serving party: {set.servingParty}</span>
            <span>{questions.length} questions</span>
            <span>Created {new Date(set.createdAt).toLocaleDateString()}</span>
            {set.finalizedAt && (
              <span>Finalized {new Date(set.finalizedAt).toLocaleString()}</span>
            )}
            {set.submittedAt && (
              <span>Submitted {new Date(set.submittedAt).toLocaleString()}</span>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-wrap justify-end gap-2">
          {isDraft && (
            <button
              type="button"
              disabled={questions.length === 0 || finalize.isPending}
              onClick={() => finalize.mutate({ setId })}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {finalize.isPending ? "Finalizing…" : "Finalize"}
            </button>
          )}
          {(isFinal || isSubmitted) && (
            <a
              href={`/api/voir-dire-sets/${setId}/pdf`}
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900"
            >
              Download PDF
            </a>
          )}
          {isFinal && (
            <button
              type="button"
              onClick={() => setShowSubmitDialog(true)}
              className="rounded-md bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700"
            >
              Mark as Submitted
            </button>
          )}
          {!isSubmitted && (
            <button
              type="button"
              onClick={() => {
                if (!confirm("Delete this voir dire set?")) return;
                del.mutate({ setId });
              }}
              disabled={del.isPending}
              className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
      </header>

      {isDraft && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            className="rounded-md bg-emerald-700 px-3 py-2 text-sm text-white hover:bg-emerald-800"
          >
            + Add from Library
          </button>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700"
          >
            + Add Custom Question
          </button>
        </div>
      )}

      {!isDraft && (
        <p className="text-xs text-zinc-500">
          Set is {set.status}. Questions are locked.
        </p>
      )}

      {questions.length === 0 && (
        <p className="text-sm text-zinc-500">
          No questions yet. Add at least one before finalizing.
        </p>
      )}

      {CATEGORY_ORDER.map((cat) => {
        const items = grouped[cat] ?? [];
        if (items.length === 0) return null;
        return (
          <section key={cat} className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
              {CATEGORY_LABEL[cat]}
            </h3>
            <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
              {items.map((q, idxInCat) => {
                const isOpen = expanded.has(q.id);
                return (
                  <li key={q.id} className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => toggleExpand(q.id)}
                        className="flex min-w-0 flex-1 items-start gap-3 text-left"
                      >
                        <span className="mt-0.5 font-mono text-xs text-zinc-500">
                          #{q.questionOrder}
                        </span>
                        <span className="font-mono text-sm text-emerald-400">
                          {idxInCat + 1}.
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">
                            {q.text.length > 90 ? `${q.text.slice(0, 90)}…` : q.text}
                          </span>
                          <span className="ml-2 text-xs text-zinc-500">
                            {isOpen ? "▾" : "▸"}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                            SOURCE_BADGE[q.source]
                          }`}
                        >
                          {q.source}
                        </span>
                        {q.isForCause && (
                          <span className="shrink-0 rounded-full bg-rose-900 px-2 py-0.5 text-xs text-rose-100">
                            For Cause
                          </span>
                        )}
                        {q.jurorPanelTarget === "individual" && (
                          <span className="shrink-0 rounded-full bg-indigo-900 px-2 py-0.5 text-xs text-indigo-100">
                            Individual
                          </span>
                        )}
                      </button>
                      {editable && (
                        <div className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            onClick={() => move(q, -1)}
                            disabled={
                              q.questionOrder === 1 || reorder.isPending
                            }
                            className="rounded border border-zinc-700 px-2 py-1 text-xs disabled:opacity-30"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => move(q, 1)}
                            disabled={
                              q.questionOrder === questions.length ||
                              reorder.isPending
                            }
                            className="rounded border border-zinc-700 px-2 py-1 text-xs disabled:opacity-30"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(q)}
                            className="rounded border border-zinc-700 px-2 py-1 text-xs"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!confirm(`Remove question #${q.questionOrder}?`))
                                return;
                              deleteQ.mutate({ questionId: q.id });
                            }}
                            className="rounded border border-red-300 px-2 py-1 text-xs text-red-700"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                    {isOpen && (
                      <div className="mt-3 space-y-2 rounded-md border border-zinc-800 bg-zinc-900/50 p-3 text-sm text-zinc-200">
                        <p className="whitespace-pre-wrap">{q.text}</p>
                        {q.followUpPrompt && (
                          <p className="text-xs italic text-zinc-400">
                            Follow-up: {q.followUpPrompt}
                          </p>
                        )}
                        {q.notes && (
                          <p className="text-xs italic text-zinc-500">
                            Note: {q.notes}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {addOpen && (
        <VoirDireQuestionFormDialog
          title="Add voir dire question"
          isPending={addQ.isPending}
          onClose={() => setAddOpen(false)}
          onSubmit={onSubmitAdd}
        />
      )}

      {editing && (
        <VoirDireQuestionFormDialog
          title={`Edit question #${editing.questionOrder}`}
          isPending={updateQ.isPending}
          initial={{
            category: editing.category,
            text: editing.text,
            followUpPrompt: editing.followUpPrompt ?? "",
            isForCause: editing.isForCause,
            jurorPanelTarget: editing.jurorPanelTarget,
            notes: editing.notes ?? "",
          }}
          onClose={() => setEditing(null)}
          onSubmit={onSubmitEdit}
        />
      )}

      {libraryOpen && (
        <VoirDireLibraryPickerDialog
          setId={setId}
          onClose={() => setLibraryOpen(false)}
          onAdded={() => {
            invalidate();
            toast.success("Added from library");
          }}
        />
      )}

      {showSubmitDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-md border border-zinc-700 bg-zinc-950 p-6 text-zinc-100">
            <h2 className="text-lg font-semibold">Mark as submitted</h2>
            <div className="mt-4">
              <label className="block text-sm">
                Submitted at
                <input
                  type="date"
                  value={submittedAt}
                  onChange={(e) => setSubmittedAt(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSubmitDialog(false)}
                className="rounded-md border border-zinc-700 px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={markSubmitted.isPending}
                onClick={() => {
                  const iso = new Date(`${submittedAt}T12:00:00`).toISOString();
                  markSubmitted.mutate({ setId, submittedAt: iso });
                }}
                className="rounded-md bg-green-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {markSubmitted.isPending ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
