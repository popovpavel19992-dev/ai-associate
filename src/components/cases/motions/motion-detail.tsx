"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { SectionEditor } from "./section-editor";

export function MotionDetail({ caseId, motionId }: { caseId: string; motionId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: motion, refetch } = trpc.motions.get.useQuery({ motionId });
  const [showFileModal, setShowFileModal] = useState(false);
  const [createTrigger, setCreateTrigger] = useState(true);
  const [filedAt, setFiledAt] = useState(() => new Date().toISOString().slice(0, 16));

  const markFiled = trpc.motions.markFiled.useMutation({
    onSuccess: () => {
      setShowFileModal(false);
      refetch();
      utils.motions.list.invalidate({ caseId });
    },
  });

  const del = trpc.motions.delete.useMutation({
    onSuccess: () => router.push(`/cases/${caseId}`),
  });

  if (!motion) return <p className="p-6 text-sm text-gray-500">Loading…</p>;

  const sections = motion.sections as Record<string, { text: string; citations: Array<{ memoId: string; snippet: string }> } | undefined>;
  const isFiled = motion.status === "filed";
  const noMemos = motion.attachedMemoIds.length === 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{motion.title}</h1>
          <p className="text-sm text-gray-600">Status: {motion.status}</p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/motions/${motionId}/docx`} className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50">
            Export DOCX
          </a>
          {!isFiled && (
            <>
              <button
                type="button"
                onClick={() => setShowFileModal(true)}
                className="rounded-md bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700"
              >
                Mark as Filed
              </button>
              <button
                type="button"
                onClick={() => confirm("Delete this draft?") && del.mutate({ motionId })}
                className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </header>

      {noMemos && (
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          No research memos attached. Argument generation is disabled until you attach a memo.
        </div>
      )}

      <SectionEditor
        motionId={motionId}
        sectionKey="facts"
        heading="Statement of Facts"
        initialText={sections.facts?.text ?? ""}
        initialCitations={sections.facts?.citations ?? []}
        onUpdated={() => refetch()}
      />
      <SectionEditor
        motionId={motionId}
        sectionKey="argument"
        heading="Argument"
        initialText={sections.argument?.text ?? ""}
        initialCitations={sections.argument?.citations ?? []}
        onUpdated={() => refetch()}
      />
      <SectionEditor
        motionId={motionId}
        sectionKey="conclusion"
        heading="Conclusion"
        initialText={sections.conclusion?.text ?? ""}
        initialCitations={sections.conclusion?.citations ?? []}
        onUpdated={() => refetch()}
      />

      {showFileModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-md bg-white p-6">
            <h2 className="text-lg font-semibold">Mark motion as filed</h2>
            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                Filed at
                <input
                  type="datetime-local"
                  value={filedAt}
                  onChange={(e) => setFiledAt(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 p-2"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={createTrigger}
                  onChange={(e) => setCreateTrigger(e.target.checked)}
                />
                Create filing deadlines (opposition / reply briefs) from this motion
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setShowFileModal(false)} className="rounded-md border px-3 py-2 text-sm">
                Cancel
              </button>
              <button
                type="button"
                disabled={markFiled.isPending}
                onClick={() => markFiled.mutate({ motionId, filedAt: new Date(filedAt).toISOString(), createTrigger })}
                className="rounded-md bg-green-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {markFiled.isPending ? "Filing…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
