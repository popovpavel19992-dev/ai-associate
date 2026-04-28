"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useActivityTracker } from "@/lib/activity-tracker";

type Category =
  | "background"
  | "foundation"
  | "key_facts"
  | "documents"
  | "admissions"
  | "damages"
  | "wrap_up"
  | "custom";

type Priority = "must_ask" | "important" | "optional";

type Role =
  | "party_witness"
  | "expert"
  | "opposing_party"
  | "third_party"
  | "custodian"
  | "other";

const CATEGORY_LABEL: Record<Category, string> = {
  background: "Background",
  foundation: "Foundation",
  key_facts: "Key Facts",
  documents: "Documents",
  admissions: "Admissions",
  damages: "Damages",
  wrap_up: "Wrap-Up",
  custom: "Custom",
};

const ROLE_LABEL: Record<Role, string> = {
  party_witness: "Party Witness",
  expert: "Expert Witness",
  opposing_party: "Opposing Party",
  third_party: "Third-Party Witness",
  custodian: "Records Custodian",
  other: "Other",
};

const PRIORITY_LABEL: Record<Priority, string> = {
  must_ask: "Must Ask",
  important: "Important",
  optional: "Optional",
};

const PRIORITY_BADGE: Record<Priority, string> = {
  must_ask: "bg-rose-900 text-rose-100",
  important: "bg-amber-900 text-amber-100",
  optional: "bg-zinc-800 text-zinc-300",
};

const SOURCE_BADGE: Record<string, string> = {
  library: "bg-emerald-900 text-emerald-100",
  manual: "bg-zinc-800 text-zinc-200",
  modified: "bg-amber-900 text-amber-100",
  ai: "bg-purple-900 text-purple-100",
};

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  finalized: "bg-blue-100 text-blue-800",
};

const CATEGORY_OPTIONS: Category[] = [
  "background",
  "foundation",
  "key_facts",
  "documents",
  "admissions",
  "damages",
  "wrap_up",
  "custom",
];

export function DepositionOutlineDetail({
  caseId,
  outlineId,
}: {
  caseId: string;
  outlineId: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  useActivityTracker(caseId, "deposition_outline_edit", { outlineId });
  const { data, isLoading, refetch } = trpc.depositionPrep.getOutline.useQuery({
    outlineId,
  });

  const [addTopicOpen, setAddTopicOpen] = useState(false);
  const [addQuestionFor, setAddQuestionFor] = useState<string | null>(null);
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());
  const [expandedQuestions, setExpandedQuestions] = useState<Set<string>>(
    new Set(),
  );

  const invalidate = () => {
    utils.depositionPrep.getOutline.invalidate({ outlineId });
    utils.depositionPrep.listForCase.invalidate({ caseId });
    refetch();
  };

  const finalize = trpc.depositionPrep.finalize.useMutation({
    onSuccess: () => {
      toast.success("Outline finalized");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.depositionPrep.delete.useMutation({
    onSuccess: () => {
      utils.depositionPrep.listForCase.invalidate({ caseId });
      router.push(`/cases/${caseId}?tab=trial-prep`);
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteTopic = trpc.depositionPrep.deleteTopic.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const deleteQuestion = trpc.depositionPrep.deleteQuestion.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const reorderTopics = trpc.depositionPrep.reorderTopics.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const reorderQuestions = trpc.depositionPrep.reorderQuestions.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });

  if (isLoading || !data) {
    return <p className="p-6 text-sm text-gray-500">Loading…</p>;
  }

  const { outline, topics } = data as {
    outline: any;
    topics: Array<{
      id: string;
      topicOrder: number;
      category: Category;
      title: string;
      notes: string | null;
      questions: Array<{
        id: string;
        questionOrder: number;
        text: string;
        expectedAnswer: string | null;
        notes: string | null;
        source: "library" | "manual" | "ai" | "modified";
        priority: Priority;
        exhibitRefs: string[];
      }>;
    }>;
  };

  const isDraft = outline.status === "draft";
  const isFinalized = outline.status === "finalized";

  const moveTopic = (topicId: string, dir: -1 | 1) => {
    const idx = topics.findIndex((t) => t.id === topicId);
    const target = idx + dir;
    if (target < 0 || target >= topics.length) return;
    const next = [...topics];
    [next[idx], next[target]] = [next[target], next[idx]];
    reorderTopics.mutate({ outlineId, orderedIds: next.map((t) => t.id) });
  };

  const moveQuestion = (
    topicId: string,
    questionId: string,
    dir: -1 | 1,
  ) => {
    const topic = topics.find((t) => t.id === topicId);
    if (!topic) return;
    const idx = topic.questions.findIndex((q) => q.id === questionId);
    const target = idx + dir;
    if (target < 0 || target >= topic.questions.length) return;
    const next = [...topic.questions];
    [next[idx], next[target]] = [next[target], next[idx]];
    reorderQuestions.mutate({ topicId, orderedIds: next.map((q) => q.id) });
  };

  const totalQuestions = topics.reduce((n, t) => n + t.questions.length, 0);

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
                STATUS_BADGE[outline.status] ?? "bg-gray-100 text-gray-800"
              }`}
            >
              {outline.status}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-bold">{outline.title}</h1>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-500">
            <span>Deponent: {outline.deponentName}</span>
            <span>{ROLE_LABEL[outline.deponentRole as Role]}</span>
            <span>Serving: {outline.servingParty}</span>
            <span>Outline #{outline.outlineNumber}</span>
            <span>
              {topics.length} topic{topics.length === 1 ? "" : "s"} ·{" "}
              {totalQuestions} question{totalQuestions === 1 ? "" : "s"}
            </span>
            {outline.scheduledDate && (
              <span>Scheduled: {outline.scheduledDate}</span>
            )}
            {outline.location && <span>Location: {outline.location}</span>}
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-wrap justify-end gap-2">
          {isDraft && (
            <button
              type="button"
              disabled={
                topics.length === 0 ||
                totalQuestions === 0 ||
                finalize.isPending
              }
              onClick={() => finalize.mutate({ outlineId })}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {finalize.isPending ? "Finalizing…" : "Finalize"}
            </button>
          )}
          <a
            href={`/api/deposition-outlines/${outlineId}/pdf`}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900"
          >
            Download PDF
          </a>
          <button
            type="button"
            onClick={() => {
              if (!confirm("Delete this deposition outline?")) return;
              del.mutate({ outlineId });
            }}
            disabled={del.isPending}
            className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </header>

      {isDraft && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAddTopicOpen(true)}
            className="rounded-md bg-rose-600 px-3 py-2 text-sm text-white hover:bg-rose-700"
          >
            + Add Topic
          </button>
        </div>
      )}

      {isFinalized && (
        <p className="text-xs text-zinc-500">
          Outline is finalized. Questions are locked. Use Download PDF to print
          or share.
        </p>
      )}

      {topics.length === 0 && (
        <p className="text-sm text-zinc-500">
          No topics yet. Add at least one topic with questions before finalizing.
        </p>
      )}

      {topics.map((topic, topicIdx) => {
        const isOpen = expandedTopics.has(topic.id);
        return (
          <section
            key={topic.id}
            className="rounded-md border border-zinc-800 bg-zinc-950/30"
          >
            <header className="flex items-start justify-between gap-3 p-3">
              <button
                type="button"
                onClick={() =>
                  setExpandedTopics((prev) => {
                    const n = new Set(prev);
                    if (n.has(topic.id)) n.delete(topic.id);
                    else n.add(topic.id);
                    return n;
                  })
                }
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span className="font-mono text-xs text-zinc-500">
                  #{topic.topicOrder}
                </span>
                <span className="font-medium">
                  {topic.title}{" "}
                  <span className="text-xs text-zinc-500">
                    ({CATEGORY_LABEL[topic.category]})
                  </span>
                </span>
                <span className="text-xs text-zinc-500">
                  {topic.questions.length} question
                  {topic.questions.length === 1 ? "" : "s"}
                </span>
                <span className="text-xs text-zinc-500">
                  {isOpen ? "▾" : "▸"}
                </span>
              </button>
              {isDraft && (
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => moveTopic(topic.id, -1)}
                    disabled={topicIdx === 0 || reorderTopics.isPending}
                    className="rounded border border-zinc-700 px-2 py-1 text-xs disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveTopic(topic.id, 1)}
                    disabled={
                      topicIdx === topics.length - 1 || reorderTopics.isPending
                    }
                    className="rounded border border-zinc-700 px-2 py-1 text-xs disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddQuestionFor(topic.id)}
                    className="rounded border border-rose-700 bg-rose-900/40 px-2 py-1 text-xs text-rose-100"
                  >
                    + Q
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        !confirm(
                          `Delete topic "${topic.title}" and all its questions?`,
                        )
                      )
                        return;
                      deleteTopic.mutate({ topicId: topic.id });
                    }}
                    className="rounded border border-red-300 px-2 py-1 text-xs text-red-700"
                  >
                    ✕
                  </button>
                </div>
              )}
            </header>

            {topic.notes && (
              <p className="px-3 pb-2 text-xs italic text-zinc-400">
                {topic.notes}
              </p>
            )}

            {isOpen && (
              <ul className="divide-y divide-zinc-800 border-t border-zinc-800">
                {topic.questions.map((q, qIdx) => {
                  const qOpen = expandedQuestions.has(q.id);
                  return (
                    <li key={q.id} className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedQuestions((prev) => {
                              const n = new Set(prev);
                              if (n.has(q.id)) n.delete(q.id);
                              else n.add(q.id);
                              return n;
                            })
                          }
                          className="flex min-w-0 flex-1 items-start gap-3 text-left"
                        >
                          <span className="mt-0.5 font-mono text-xs text-zinc-500">
                            {qIdx + 1}.
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="text-sm">
                              {q.text.length > 100
                                ? `${q.text.slice(0, 100)}…`
                                : q.text}
                            </span>
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${PRIORITY_BADGE[q.priority]}`}
                          >
                            {PRIORITY_LABEL[q.priority]}
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${SOURCE_BADGE[q.source]}`}
                          >
                            {q.source}
                          </span>
                        </button>
                        {isDraft && (
                          <div className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              onClick={() => moveQuestion(topic.id, q.id, -1)}
                              disabled={qIdx === 0 || reorderQuestions.isPending}
                              className="rounded border border-zinc-700 px-2 py-1 text-xs disabled:opacity-30"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveQuestion(topic.id, q.id, 1)}
                              disabled={
                                qIdx === topic.questions.length - 1 ||
                                reorderQuestions.isPending
                              }
                              className="rounded border border-zinc-700 px-2 py-1 text-xs disabled:opacity-30"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (!confirm(`Remove question ${qIdx + 1}?`))
                                  return;
                                deleteQuestion.mutate({ questionId: q.id });
                              }}
                              className="rounded border border-red-300 px-2 py-1 text-xs text-red-700"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                      {qOpen && (
                        <div className="mt-3 space-y-1 rounded-md border border-zinc-800 bg-zinc-900/50 p-3 text-sm text-zinc-200">
                          <p className="whitespace-pre-wrap">{q.text}</p>
                          {q.expectedAnswer && (
                            <p className="text-xs italic text-zinc-400">
                              Expected: {q.expectedAnswer}
                            </p>
                          )}
                          {q.notes && (
                            <p className="text-xs italic text-zinc-500">
                              Notes: {q.notes}
                            </p>
                          )}
                          {q.exhibitRefs.length > 0 && (
                            <p className="text-xs text-zinc-400">
                              Refs: {q.exhibitRefs.join(", ")}
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
                {topic.questions.length === 0 && (
                  <li className="p-3 text-xs italic text-zinc-500">
                    No questions in this topic yet.
                  </li>
                )}
              </ul>
            )}
          </section>
        );
      })}

      {addTopicOpen && (
        <AddTopicDialog
          outlineId={outlineId}
          deponentRole={outline.deponentRole as Role}
          onClose={() => setAddTopicOpen(false)}
          onAdded={() => {
            invalidate();
            setAddTopicOpen(false);
          }}
        />
      )}

      {addQuestionFor && (
        <AddQuestionDialog
          topicId={addQuestionFor}
          onClose={() => setAddQuestionFor(null)}
          onAdded={() => {
            invalidate();
            setAddQuestionFor(null);
          }}
        />
      )}
    </div>
  );
}

// ── Add Topic dialog (Library or Custom) ───────────────────────────────────

function AddTopicDialog({
  outlineId,
  deponentRole,
  onClose,
  onAdded,
}: {
  outlineId: string;
  deponentRole: Role;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [tab, setTab] = useState<"library" | "custom">("library");
  const [filterRole, setFilterRole] = useState<Role | "all">(deponentRole);
  const [filterCategory, setFilterCategory] = useState<Category | "all">("all");
  const [customCategory, setCustomCategory] = useState<Category>("custom");
  const [customTitle, setCustomTitle] = useState("");
  const [customNotes, setCustomNotes] = useState("");

  const { data: templates } =
    trpc.depositionPrep.listLibraryTemplates.useQuery({
      deponentRole: filterRole === "all" ? undefined : filterRole,
      category: filterCategory === "all" ? undefined : filterCategory,
    });

  const addFromTpl = trpc.depositionPrep.addTopicFromTemplate.useMutation({
    onSuccess: () => {
      toast.success("Topic added from library");
      onAdded();
    },
    onError: (e) => toast.error(e.message),
  });
  const addCustom = trpc.depositionPrep.addTopic.useMutation({
    onSuccess: () => {
      toast.success("Topic added");
      onAdded();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-md border border-zinc-700 bg-zinc-950 p-6 text-zinc-100">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add Topic</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-zinc-400 hover:text-zinc-100"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex border-b border-zinc-800">
          <button
            type="button"
            onClick={() => setTab("library")}
            className={`px-3 py-2 text-sm ${
              tab === "library"
                ? "border-b-2 border-rose-500 text-rose-400"
                : "text-zinc-400"
            }`}
          >
            From Template Library
          </button>
          <button
            type="button"
            onClick={() => setTab("custom")}
            className={`px-3 py-2 text-sm ${
              tab === "custom"
                ? "border-b-2 border-rose-500 text-rose-400"
                : "text-zinc-400"
            }`}
          >
            Custom
          </button>
        </div>

        {tab === "library" && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                Deponent role
                <select
                  value={filterRole}
                  onChange={(e) =>
                    setFilterRole(e.target.value as Role | "all")
                  }
                  className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
                >
                  <option value="all">All</option>
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Category
                <select
                  value={filterCategory}
                  onChange={(e) =>
                    setFilterCategory(e.target.value as Category | "all")
                  }
                  className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
                >
                  <option value="all">All</option>
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <ul className="max-h-80 divide-y divide-zinc-800 overflow-y-auto rounded-md border border-zinc-800">
              {(templates ?? []).map((t) => (
                <li key={t.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{t.title}</p>
                      <p className="text-xs text-zinc-500">
                        {ROLE_LABEL[t.deponentRole as Role]} ·{" "}
                        {CATEGORY_LABEL[t.category as Category]} ·{" "}
                        {(t.questions as string[]).length} questions
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={addFromTpl.isPending}
                      onClick={() =>
                        addFromTpl.mutate({ outlineId, templateId: t.id })
                      }
                      className="rounded-md bg-rose-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </li>
              ))}
              {(templates ?? []).length === 0 && (
                <li className="p-3 text-sm italic text-zinc-500">
                  No templates match these filters.
                </li>
              )}
            </ul>
          </div>
        )}

        {tab === "custom" && (
          <div className="mt-4 space-y-3">
            <label className="block text-sm">
              Category
              <select
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value as Category)}
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Title
              <input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
                placeholder="e.g., Foundation for Exhibit 7"
              />
            </label>
            <label className="block text-sm">
              Notes (optional)
              <textarea
                value={customNotes}
                onChange={(e) => setCustomNotes(e.target.value)}
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
                rows={3}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-zinc-700 px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={addCustom.isPending || !customTitle.trim()}
                onClick={() =>
                  addCustom.mutate({
                    outlineId,
                    category: customCategory,
                    title: customTitle.trim(),
                    notes: customNotes.trim() || null,
                  })
                }
                className="rounded-md bg-rose-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {addCustom.isPending ? "Adding…" : "Add Topic"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Add Question dialog (AI or Manual) ─────────────────────────────────────

function AddQuestionDialog({
  topicId,
  onClose,
  onAdded,
}: {
  topicId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [tab, setTab] = useState<"ai" | "manual">("manual");
  const [text, setText] = useState("");
  const [expectedAnswer, setExpectedAnswer] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<Priority>("important");
  const [exhibitRefs, setExhibitRefs] = useState("");
  const [aiCount, setAiCount] = useState(6);

  const addManual = trpc.depositionPrep.addQuestion.useMutation({
    onSuccess: () => {
      toast.success("Question added");
      onAdded();
    },
    onError: (e) => toast.error(e.message),
  });
  const aiGen = trpc.depositionPrep.generateQuestionsForTopic.useMutation({
    onSuccess: ({ count }) => {
      toast.success(`Generated ${count} question${count === 1 ? "" : "s"}`);
      onAdded();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl rounded-md border border-zinc-700 bg-zinc-950 p-6 text-zinc-100">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add Question</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-zinc-400 hover:text-zinc-100"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex border-b border-zinc-800">
          <button
            type="button"
            onClick={() => setTab("manual")}
            className={`px-3 py-2 text-sm ${
              tab === "manual"
                ? "border-b-2 border-rose-500 text-rose-400"
                : "text-zinc-400"
            }`}
          >
            Manual
          </button>
          <button
            type="button"
            onClick={() => setTab("ai")}
            className={`px-3 py-2 text-sm ${
              tab === "ai"
                ? "border-b-2 border-rose-500 text-rose-400"
                : "text-zinc-400"
            }`}
          >
            AI Generate from Case Facts
          </button>
        </div>

        {tab === "manual" && (
          <div className="mt-4 space-y-3">
            <label className="block text-sm">
              Question text
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
                placeholder="e.g., Please describe the events of January 14 in your own words."
              />
            </label>
            <label className="block text-sm">
              Expected answer (optional)
              <input
                type="text"
                value={expectedAnswer}
                onChange={(e) => setExpectedAnswer(e.target.value)}
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              Notes (optional)
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                Priority
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority)}
                  className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
                >
                  <option value="must_ask">Must Ask</option>
                  <option value="important">Important</option>
                  <option value="optional">Optional</option>
                </select>
              </label>
              <label className="block text-sm">
                Exhibit refs (comma-separated)
                <input
                  type="text"
                  value={exhibitRefs}
                  onChange={(e) => setExhibitRefs(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
                  placeholder="A, C, F"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-zinc-700 px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={addManual.isPending || !text.trim()}
                onClick={() =>
                  addManual.mutate({
                    topicId,
                    text: text.trim(),
                    expectedAnswer: expectedAnswer.trim() || null,
                    notes: notes.trim() || null,
                    priority,
                    exhibitRefs: exhibitRefs
                      .split(",")
                      .map((s) => s.trim())
                      .filter((s) => s.length > 0),
                  })
                }
                className="rounded-md bg-rose-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {addManual.isPending ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        )}

        {tab === "ai" && (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-zinc-400">
              AI drafts open-ended questions for this topic using the case
              description and the deponent's role. Review and edit before
              finalizing.
            </p>
            <label className="block text-sm">
              Number of questions
              <input
                type="number"
                min={1}
                max={20}
                value={aiCount}
                onChange={(e) => setAiCount(Number(e.target.value))}
                className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-zinc-700 px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={aiGen.isPending}
                onClick={() =>
                  aiGen.mutate({ topicId, desiredCount: aiCount })
                }
                className="rounded-md bg-purple-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {aiGen.isPending ? "Generating…" : "Generate"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
