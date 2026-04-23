"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";

export function MotionWizard({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [selectedMemos, setSelectedMemos] = useState<string[]>([]);
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);

  const { data: templates } = trpc.motions.listTemplates.useQuery();
  const { data: suggestions } = trpc.motions.suggestMemos.useQuery({ caseId });
  const create = trpc.motions.create.useMutation({
    onSuccess: (m) => router.push(`/cases/${caseId}/motions/${m.id}`),
  });

  useEffect(() => {
    if (suggestions && suggestions.memos.length && selectedMemos.length === 0) {
      setSelectedMemos(suggestions.memos.map((m) => m.id));
    }
  }, [suggestions, selectedMemos.length]);

  const toggleMemo = (id: string) =>
    setSelectedMemos((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
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
                <input type="checkbox" checked={selectedMemos.includes(m.id)} onChange={() => toggleMemo(m.id)} />
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

      <div className="flex justify-between">
        <button type="button" onClick={() => setStep(1)} className="rounded-md border px-4 py-2 text-sm">Back</button>
        <button
          type="button"
          disabled={!templateId || !title || create.isPending}
          onClick={() =>
            templateId &&
            create.mutate({ caseId, templateId, title, memoIds: selectedMemos, collectionIds: selectedCollections })
          }
          className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {create.isPending ? "Creating…" : "Create draft"}
        </button>
      </div>
    </div>
  );
}
