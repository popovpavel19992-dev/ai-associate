"use client";
import * as React from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type Exhibit = {
  id: string;
  label: string;
  displayOrder: number;
  originalFilename: string;
  mimeType: string;
};

export function ExhibitList({
  packageId,
  caseId,
  exhibits,
  onChanged,
}: {
  packageId: string;
  caseId: string;
  exhibits: Exhibit[];
  onChanged: () => void;
}) {
  const utils = trpc.useUtils();
  const { data: caseDocs } = trpc.documents.listByCase.useQuery({ caseId });
  const [selectedDocs, setSelectedDocs] = React.useState<string[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);

  const addExhibits = trpc.filingPackages.addExhibits.useMutation({
    onSuccess: async () => {
      setSelectedDocs([]);
      await utils.filingPackages.get.invalidate({ packageId });
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });

  const reorder = trpc.filingPackages.reorderExhibits.useMutation({
    onSuccess: async () => utils.filingPackages.get.invalidate({ packageId }),
  });

  const updateLabel = trpc.filingPackages.updateExhibitLabel.useMutation();
  const remove = trpc.filingPackages.removeExhibit.useMutation({
    onSuccess: async () => utils.filingPackages.get.invalidate({ packageId }),
  });

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/packages/${packageId}/upload`, { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        toast.error(err.error ?? "Upload failed");
        return;
      }
      const { s3Key, originalFilename, mimeType } = await res.json();
      await addExhibits.mutateAsync({
        packageId,
        caseDocumentIds: [],
        adHocUploads: [{ s3Key, originalFilename, mimeType }],
      });
    } finally {
      setUploading(false);
    }
  }

  function handleDragStart(i: number) {
    setDragIndex(i);
  }
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }
  function handleDrop(i: number) {
    if (dragIndex === null || dragIndex === i) return;
    const ids = exhibits.map((e) => e.id);
    const [moved] = ids.splice(dragIndex, 1);
    ids.splice(i, 0, moved);
    reorder.mutate({ packageId, exhibitIds: ids });
    setDragIndex(null);
  }

  return (
    <section className="rounded-md border border-gray-200 p-4">
      <h2 className="font-semibold mb-3">Exhibits</h2>

      {caseDocs && caseDocs.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium mb-2">Attach from case documents</h3>
          <ul className="space-y-1 max-h-48 overflow-y-auto border rounded p-2">
            {caseDocs.map((d) => (
              <li key={d.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedDocs.includes(d.id)}
                    onChange={() =>
                      setSelectedDocs((s) =>
                        s.includes(d.id) ? s.filter((x) => x !== d.id) : [...s, d.id],
                      )
                    }
                  />
                  {d.filename}
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={selectedDocs.length === 0 || addExhibits.isPending}
            onClick={() =>
              addExhibits.mutate({ packageId, caseDocumentIds: selectedDocs, adHocUploads: [] })
            }
            className="mt-2 rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            Attach {selectedDocs.length > 0 ? `(${selectedDocs.length})` : ""}
          </button>
        </div>
      )}

      <div className="mb-4">
        <h3 className="text-sm font-medium mb-2">Or upload</h3>
        <input
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
            e.target.value = "";
          }}
        />
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">Attached exhibits ({exhibits.length})</h3>
        {exhibits.length === 0 && <p className="text-sm text-gray-500">None yet.</p>}
        <ul className="space-y-2">
          {exhibits.map((ex, i) => (
            <li
              key={ex.id}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(i)}
              className={`flex items-center gap-3 rounded border p-2 cursor-move ${
                dragIndex === i ? "opacity-50" : ""
              }`}
            >
              <input
                type="text"
                defaultValue={ex.label}
                onBlur={(e) => {
                  if (e.target.value !== ex.label) {
                    updateLabel.mutate({ exhibitId: ex.id, packageId, label: e.target.value });
                  }
                }}
                className="w-16 rounded border px-2 py-1 text-sm font-semibold"
              />
              <span className="flex-1 text-sm truncate">{ex.originalFilename}</span>
              <span className="text-xs text-gray-500">{ex.mimeType}</span>
              <button
                type="button"
                onClick={() => remove.mutate({ exhibitId: ex.id, packageId })}
                className="text-xs text-red-600 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
