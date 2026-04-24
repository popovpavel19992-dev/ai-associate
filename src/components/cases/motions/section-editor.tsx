"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";

type SectionKey = "facts" | "argument" | "conclusion";

interface Props {
  motionId: string;
  sectionKey: SectionKey;
  heading: string;
  initialText: string;
  initialCitations: Array<{ memoId: string; snippet: string }>;
  onUpdated: () => void;
}

export function SectionEditor({ motionId, sectionKey, heading, initialText, initialCitations, onUpdated }: Props) {
  const [text, setText] = useState(initialText);
  const [citations, setCitations] = useState(initialCitations);
  const [error, setError] = useState<string | null>(null);

  const generate = trpc.motions.generateSection.useMutation({
    onSuccess: (data) => {
      setText(data.text);
      setCitations(data.citations);
      setError(null);
      onUpdated();
    },
    onError: (e) => setError(e.message),
  });

  const save = trpc.motions.updateSection.useMutation({
    onSuccess: () => {
      setError(null);
      onUpdated();
    },
    onError: (e) => setError(e.message),
  });

  return (
    <section className="rounded-md border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{heading}</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => generate.mutate({ motionId, sectionKey })}
            disabled={generate.isPending}
            className="rounded-md bg-purple-600 px-3 py-1 text-sm text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {generate.isPending ? "Generating…" : text ? "Regenerate" : "Generate with AI"}
          </button>
          <button
            type="button"
            onClick={() => save.mutate({ motionId, sectionKey, text })}
            disabled={save.isPending}
            className="rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        className="mt-3 w-full rounded-md border border-gray-300 p-2 font-mono text-sm"
        placeholder={`${heading} will appear here after generation, or type manually.`}
      />

      {citations.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-gray-700">Citations</p>
          <ul className="mt-1 space-y-1">
            {citations.map((c, i) => (
              <li key={i} className="text-xs text-gray-600">
                from: <span className="font-medium">{c.snippet}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
