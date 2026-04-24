"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";

export function MotionWizard({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [selectedMemos, setSelectedMemos] = useState<string[] | null>(null);
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [splitMemo, setSplitMemo] = useState<boolean>(false);

  const { data: templates } = trpc.motions.listTemplates.useQuery();
  const { data: suggestions } = trpc.motions.suggestMemos.useQuery({ caseId });
  const create = trpc.motions.create.useMutation({
    onSuccess: (m) => router.push(`/cases/${caseId}/motions/${m.id}`),
  });

  // Derive default selection from suggestions without useEffect (avoids
  // react-hooks/set-state-in-effect cascading renders). `null` means
  // "user has not interacted yet — fall back to suggestion defaults".
  const effectiveSelectedMemos: string[] =
    selectedMemos ?? (suggestions?.memos.map((m) => m.id) ?? []);

  const selectedTemplate = templates?.find((t) => t.id === templateId);

  const toggleMemo = (id: string) =>
    setSelectedMemos((prev) => {
      const s = prev ?? effectiveSelectedMemos;
      return s.includes(id) ? s.filter((x) => x !== id) : [...s, id];
    });
  const toggleCollection = (id: string) =>
    setSelectedCollections((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  if (step === 1) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">New Motion — Step 1 of 2: Pick a template</h1>
        <div className="grid gap-3 md:grid-cols-3">
          {templates?.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setTemplateId(t.id); setTitle(t.name); }}
              className={`rounded-md border p-4 text-left hover:bg-gray-50 ${templateId === t.id ? "border-blue-600 bg-blue-50" : "border-gray-200"}`}
            >
              <div className="font-semibold">{t.name}</div>
              <div className="mt-1 text-xs text-gray-600">{t.description}</div>
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            disabled={!templateId}
            onClick={() => setStep(2)}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Next: Attach research
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">New Motion — Step 2 of 2: Attach research &amp; title</h1>

      <div>
        <label className="block text-sm font-medium">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 p-2"
        />
      </div>

      <div>
        <h2 className="text-sm font-semibold">Research memos</h2>
        {suggestions?.memos.length === 0 && (
          <p className="mt-1 text-sm text-amber-700">
            No research memos on this case yet. Argument generation will be disabled until you attach at least one memo (create via 2.2.3 Research Memos).
          </p>
        )}
        <ul className="mt-2 space-y-1">
          {suggestions?.memos.map((m) => (
            <li key={m.id}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={effectiveSelectedMemos.includes(m.id)} onChange={() => toggleMemo(m.id)} />
                {m.title}
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="text-sm font-semibold">Research collections</h2>
        <ul className="mt-2 space-y-1">
          {suggestions?.collections.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selectedCollections.includes(c.id)} onChange={() => toggleCollection(c.id)} />
                {c.name}
              </label>
            </li>
          ))}
        </ul>
      </div>

      {selectedTemplate?.supportsMemoSplit && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={splitMemo}
              onChange={(e) => setSplitMemo(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Generate as separate Memorandum of Law</span>
              <span className="ml-1 text-xs text-gray-600">
                — produces a short notice motion plus a full memorandum carrying the
                facts, argument, and conclusion sections (recommended for argument-heavy motions).
              </span>
            </span>
          </label>
        </div>
      )}

      <div className="flex justify-between">
        <button type="button" onClick={() => setStep(1)} className="rounded-md border px-4 py-2 text-sm">Back</button>
        <button
          type="button"
          disabled={!templateId || !title || create.isPending}
          onClick={() =>
            templateId &&
            create.mutate({
              caseId,
              templateId,
              title,
              memoIds: effectiveSelectedMemos,
              collectionIds: selectedCollections,
              splitMemo: selectedTemplate?.supportsMemoSplit ? splitMemo : undefined,
            })
          }
          className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {create.isPending ? "Creating…" : "Create draft"}
        </button>
      </div>
    </div>
  );
}
