"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface Props {
  caseId: string;
  onClose: () => void;
  onCreated: (requestId: string) => void;
}

export function AddIncomingDiscoveryDialog({ caseId, onClose, onCreated }: Props) {
  const [mode, setMode] = useState<"paste" | "document">("paste");
  const [text, setText] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [requestType, setRequestType] = useState<
    "interrogatories" | "rfp" | "rfa"
  >("interrogatories");
  const [setNumber, setSetNumber] = useState(1);
  const [servingParty, setServingParty] = useState("");
  const [dueAt, setDueAt] = useState("");

  const parse = trpc.discoveryResponseDrafter.parseAndSave.useMutation({
    onSuccess: (r) => {
      toast.success("Parsed and saved");
      onCreated(r.id);
    },
    onError: (e) => toast.error(e.message),
  });

  const onSubmit = () => {
    parse.mutate({
      caseId,
      requestType,
      setNumber,
      servingParty,
      dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
      source:
        mode === "paste" ? { mode, text } : { mode, documentId },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 className="text-lg font-semibold text-zinc-100">
          Add incoming discovery
        </h3>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="text-zinc-400">Type</span>
            <select
              value={requestType}
              onChange={(e) =>
                setRequestType(e.target.value as "interrogatories" | "rfp" | "rfa")
              }
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-zinc-200"
            >
              <option value="interrogatories">Interrogatories</option>
              <option value="rfp">Requests for Production</option>
              <option value="rfa">Requests for Admission</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-zinc-400">Set #</span>
            <input
              type="number"
              min={1}
              max={99}
              value={setNumber}
              onChange={(e) => setSetNumber(Number(e.target.value))}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-zinc-200"
            />
          </label>
          <label className="block text-sm md:col-span-2">
            <span className="text-zinc-400">Serving party</span>
            <input
              type="text"
              placeholder="Plaintiff Smith"
              value={servingParty}
              onChange={(e) => setServingParty(e.target.value)}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-zinc-200"
            />
          </label>
          <label className="block text-sm md:col-span-2">
            <span className="text-zinc-400">Due date (optional)</span>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-zinc-200"
            />
          </label>
        </div>

        <div className="flex gap-2 border-b border-zinc-800">
          <button
            type="button"
            onClick={() => setMode("paste")}
            className={`px-3 py-2 text-sm ${
              mode === "paste"
                ? "border-b-2 border-white text-white"
                : "text-zinc-500"
            }`}
          >
            Paste
          </button>
          <button
            type="button"
            onClick={() => setMode("document")}
            className={`px-3 py-2 text-sm ${
              mode === "document"
                ? "border-b-2 border-white text-white"
                : "text-zinc-500"
            }`}
          >
            Use uploaded document
          </button>
        </div>

        {mode === "paste" ? (
          <textarea
            placeholder="Paste interrogatories / RFP / RFA text here..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[200px] w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-200"
          />
        ) : (
          <div className="space-y-2">
            <label className="block text-sm">
              <span className="text-zinc-400">Document ID</span>
              <input
                type="text"
                placeholder="Paste a document UUID from the case"
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2 font-mono text-zinc-200"
              />
            </label>
            <p className="text-xs text-zinc-500">
              Upload your file via the case Documents tab first, then paste its
              ID here. The file must finish text extraction before parsing.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={
              parse.isPending ||
              !servingParty ||
              (mode === "paste" ? !text : !documentId)
            }
            onClick={onSubmit}
          >
            {parse.isPending ? (
              <Loader2 className="mr-1.5 size-3 animate-spin" />
            ) : null}
            Parse &amp; save (1cr)
          </Button>
        </div>
      </div>
    </div>
  );
}
