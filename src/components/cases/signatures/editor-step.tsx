// src/components/cases/signatures/editor-step.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { PdfFieldEditor, type PlacedField, type Signer } from "./pdf-field-editor";
import type { SignerRow } from "./signer-rows";
import { colorForIndex } from "./signer-rows";

interface EditorStepProps {
  sourceDocumentId: string;
  rows: SignerRow[];
  fields: PlacedField[];
  onFieldsChange: (f: PlacedField[]) => void;
}

export function EditorStep({
  sourceDocumentId,
  rows,
  fields,
  onFieldsChange,
}: EditorStepProps) {
  const urlQuery = trpc.documents.getDownloadUrl.useQuery(
    { documentId: sourceDocumentId },
    { enabled: !!sourceDocumentId, staleTime: 60_000 },
  );

  const signers: Signer[] = React.useMemo(
    () =>
      rows.map((r, i) => ({
        index: i,
        label: r.name || r.email || `Signer ${i + 1}`,
        color: colorForIndex(i),
      })),
    [rows],
  );

  // Track how many fields each signer has — surface red dot for 0.
  const fieldCountBySigner = React.useMemo(() => {
    const counts = new Map<number, number>();
    for (const f of fields) {
      counts.set(f.signerIndex, (counts.get(f.signerIndex) ?? 0) + 1);
    }
    return counts;
  }, [fields]);

  if (urlQuery.isLoading) {
    return (
      <div className="text-sm text-muted-foreground">Loading document…</div>
    );
  }
  if (urlQuery.error || !urlQuery.data?.url) {
    return (
      <div className="text-sm text-destructive">
        Failed to load document URL
        {urlQuery.error ? `: ${urlQuery.error.message}` : ""}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        {rows.map((r, i) => {
          const count = fieldCountBySigner.get(i) ?? 0;
          return (
            <div
              key={r.rowId}
              className="flex items-center gap-1.5 rounded-full border px-2 py-0.5"
            >
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: colorForIndex(i) }}
              />
              <span>{r.name || r.email || `Signer ${i + 1}`}</span>
              {count === 0 ? (
                <span
                  aria-label="No fields assigned"
                  className="inline-block h-2 w-2 rounded-full bg-red-500"
                />
              ) : (
                <span className="text-muted-foreground">({count})</span>
              )}
            </div>
          );
        })}
      </div>

      <PdfFieldEditor
        pdfUrl={urlQuery.data.url}
        signers={signers}
        fields={fields}
        onChange={onFieldsChange}
      />
    </div>
  );
}
