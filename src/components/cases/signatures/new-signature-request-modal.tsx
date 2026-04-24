// src/components/cases/signatures/new-signature-request-modal.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { SignerRows, isRowValid, type SignerRow } from "./signer-rows";
import { EditorStep } from "./editor-step";
import type { PlacedField, FieldType } from "./pdf-field-editor";

type Step = 1 | 2 | 3;
type SourceMode = "template" | "document";
type SigningOrder = "parallel" | "sequential";

interface CreateInput {
  caseId: string;
  title: string;
  message?: string;
  requiresCountersign: boolean;
  clientContactId: string;
  templateId?: string;
  sourceDocumentId?: string;
  signers?: Array<{
    clientContactId?: string;
    userId?: string;
    emailAddress: string;
    name: string;
    order?: number;
  }>;
  signingOrder: SigningOrder;
  formFields?: Array<{
    signerIndex: number;
    fieldType: FieldType;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    required: boolean;
  }>;
}

function makeEmptyRow(order: number): SignerRow {
  return {
    rowId: crypto.randomUUID(),
    source: "contact",
    name: "",
    email: "",
    order,
  };
}

export function NewSignatureRequestModal({
  caseId,
  open,
  onOpenChange,
  initialSourceDocumentId,
}: {
  caseId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialSourceDocumentId?: string;
}) {
  const utils = trpc.useUtils();

  // ---- Common state (used by both legacy and wizard flows) ----
  const [step, setStep] = React.useState<Step>(1);
  const [sourceMode, setSourceMode] = React.useState<SourceMode>(
    initialSourceDocumentId ? "document" : "template",
  );
  const [templateId, setTemplateId] = React.useState<string>("");
  const [sourceDocId, setSourceDocId] = React.useState<string>(
    initialSourceDocumentId ?? "",
  );
  const [title, setTitle] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [useDragDrop, setUseDragDrop] = React.useState(false);

  // ---- Legacy-only state ----
  const [clientContactId, setClientContactId] = React.useState("");
  const [requiresCountersign, setRequiresCountersign] = React.useState(true);

  // ---- Wizard-only state ----
  const [rows, setRows] = React.useState<SignerRow[]>(() => [makeEmptyRow(0)]);
  const [signingOrder, setSigningOrder] = React.useState<SigningOrder>("parallel");
  const [fields, setFields] = React.useState<PlacedField[]>([]);

  // Reset on open.
  React.useEffect(() => {
    if (!open) return;
    setStep(1);
    setSourceMode(initialSourceDocumentId ? "document" : "template");
    setTemplateId("");
    setSourceDocId(initialSourceDocumentId ?? "");
    setTitle("");
    setMessage("");
    setUseDragDrop(false);
    setClientContactId("");
    setRequiresCountersign(true);
    setRows([makeEmptyRow(0)]);
    setSigningOrder("parallel");
    setFields([]);
  }, [open, initialSourceDocumentId]);

  const templates = trpc.caseSignatures.listTemplates.useQuery(undefined, {
    enabled: open && sourceMode === "template",
  });
  const contacts = trpc.clientContacts.listForCase.useQuery(
    { caseId },
    { enabled: open },
  );
  const caseDocs = trpc.documents.listByCase.useQuery(
    { caseId },
    { enabled: open && sourceMode === "document" },
  );

  const create = trpc.caseSignatures.create.useMutation({
    onSuccess: async () => {
      toast.success("Signature request sent");
      await utils.caseSignatures.list.invalidate({ caseId });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  // ---- Derived state ----
  const titleValid = title.trim().length > 0;
  const sourceValid =
    (sourceMode === "template" && !!templateId) ||
    (sourceMode === "document" && !!sourceDocId);

  const step1NextEnabled = titleValid && sourceValid;

  const validRows = rows.filter(isRowValid);
  const step2NextEnabled =
    validRows.length === rows.length && rows.length >= 1;

  const fieldsBySigner = React.useMemo(() => {
    const set = new Set<number>();
    for (const f of fields) set.add(f.signerIndex);
    return set;
  }, [fields]);
  const everySignerHasField =
    rows.length > 0 && rows.every((_, i) => fieldsBySigner.has(i));
  const step3SendEnabled = fields.length >= 1 && everySignerHasField;

  const templateBlocksDragDrop = useDragDrop && sourceMode === "template";

  // ---- Handlers ----

  const sendLegacy = () => {
    if (!clientContactId) return;
    const payload: CreateInput = {
      caseId,
      title: title.trim(),
      message: message.trim() || undefined,
      requiresCountersign,
      clientContactId,
      templateId: sourceMode === "template" ? templateId : undefined,
      sourceDocumentId: sourceMode === "document" ? sourceDocId : undefined,
      signingOrder: "parallel",
    };
    create.mutate(payload);
  };

  const sendWizard = () => {
    // Multi-party path needs a top-level clientContactId (still required by
    // schema). Pick the first row that has one; fall back to the first contact
    // known for this case if none of the rows is a client contact.
    const firstContactRow = rows.find((r) => r.clientContactId);
    const fallbackContact = (contacts.data?.contacts ?? [])[0] as
      | { id: string }
      | undefined;
    const resolvedClientContactId =
      firstContactRow?.clientContactId ?? fallbackContact?.id;
    if (!resolvedClientContactId) {
      toast.error(
        "This case has no client contacts yet — add one before sending a multi-party request.",
      );
      return;
    }

    const payload: CreateInput = {
      caseId,
      title: title.trim(),
      message: message.trim() || undefined,
      requiresCountersign: rows.some((r) => r.source === "member"),
      clientContactId: resolvedClientContactId,
      templateId: sourceMode === "template" ? templateId : undefined,
      sourceDocumentId: sourceMode === "document" ? sourceDocId : undefined,
      signingOrder,
      signers: rows.map((r, i) => ({
        clientContactId: r.clientContactId,
        userId: r.userId,
        emailAddress: r.email.trim(),
        name: r.name.trim() || r.email.trim(),
        order: signingOrder === "sequential" ? i : undefined,
      })),
      formFields: fields.map((f) => ({
        signerIndex: f.signerIndex,
        fieldType: f.fieldType,
        page: f.page,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        required: true,
      })),
    };
    create.mutate(payload);
  };

  // ---- Render ----

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            New signature request
            {useDragDrop ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                · Step {step} of 3
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <Label>Source</Label>
              <div className="flex gap-3">
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    checked={sourceMode === "template"}
                    onChange={() => setSourceMode("template")}
                  />
                  Saved template
                </label>
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    checked={sourceMode === "document"}
                    onChange={() => setSourceMode("document")}
                  />
                  Case document
                </label>
              </div>
            </div>

            {sourceMode === "template" ? (
              <div>
                <Label>Template</Label>
                <select
                  className="w-full rounded border p-2"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  <option value="">Pick a template…</option>
                  {(templates.data ?? []).map(
                    (t: { templateId: string; title: string }) => (
                      <option key={t.templateId} value={t.templateId}>
                        {t.title}
                      </option>
                    ),
                  )}
                </select>
              </div>
            ) : (
              <div>
                <Label>Document</Label>
                <select
                  className="w-full rounded border p-2"
                  value={sourceDocId}
                  onChange={(e) => setSourceDocId(e.target.value)}
                >
                  <option value="">Pick a PDF…</option>
                  {(caseDocs.data ?? [])
                    .filter(
                      (d: { fileType: string | null }) => d.fileType === "pdf",
                    )
                    .map((d: { id: string; filename: string }) => (
                      <option key={d.id} value={d.id}>
                        {d.filename}
                      </option>
                    ))}
                </select>
              </div>
            )}

            <div>
              <Label>Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={500}
                placeholder="Retainer Agreement — Acme"
              />
            </div>

            <div>
              <Label>Cover message (optional)</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={10_000}
                rows={3}
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useDragDrop}
                onChange={(e) => setUseDragDrop(e.target.checked)}
              />
              Use drag-drop editor (custom field placement, up to 5 signers)
            </label>

            {templateBlocksDragDrop && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Template PDFs are placed automatically — drag-drop only
                available for case documents in MVP. Switch Source to "Case
                document" to continue.
              </div>
            )}

            {/* Legacy single-contact controls (only when drag-drop off) */}
            {!useDragDrop && (
              <>
                <div>
                  <Label>Client contact</Label>
                  <select
                    className="w-full rounded border p-2"
                    value={clientContactId}
                    onChange={(e) => setClientContactId(e.target.value)}
                  >
                    <option value="">Pick contact…</option>
                    {(contacts.data?.contacts ?? [])
                      .filter((c: { email: string | null }) => !!c.email)
                      .map(
                        (c: { id: string; name: string; email: string | null }) => (
                          <option key={c.id} value={c.id}>
                            {c.name ? `${c.name} — ` : ""}
                            {c.email}
                          </option>
                        ),
                      )}
                  </select>
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={requiresCountersign}
                    onChange={(e) => setRequiresCountersign(e.target.checked)}
                  />
                  Also require my signature
                </label>
              </>
            )}
          </div>
        )}

        {step === 2 && useDragDrop && (
          <SignerRows
            caseId={caseId}
            rows={rows}
            onChange={setRows}
            signingOrder={signingOrder}
            onSigningOrderChange={setSigningOrder}
          />
        )}

        {step === 3 && useDragDrop && sourceDocId && (
          <EditorStep
            sourceDocumentId={sourceDocId}
            rows={rows}
            fields={fields}
            onFieldsChange={setFields}
          />
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>

          {/* Legacy flow: Step 1 only, Send button */}
          {!useDragDrop && step === 1 && (
            <Button
              disabled={
                !step1NextEnabled || !clientContactId || create.isPending
              }
              onClick={sendLegacy}
            >
              {create.isPending ? "Sending…" : "Send"}
            </Button>
          )}

          {/* Wizard flow navigation */}
          {useDragDrop && step === 1 && (
            <Button
              disabled={!step1NextEnabled || templateBlocksDragDrop}
              onClick={() => setStep(2)}
            >
              Next
            </Button>
          )}
          {useDragDrop && step === 2 && (
            <>
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button disabled={!step2NextEnabled} onClick={() => setStep(3)}>
                Next
              </Button>
            </>
          )}
          {useDragDrop && step === 3 && (
            <>
              <Button variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button
                disabled={!step3SendEnabled || create.isPending}
                onClick={sendWizard}
              >
                {create.isPending ? "Sending…" : "Send"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
