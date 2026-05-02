"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { STATEMENT_KIND, type StatementKind } from "@/server/db/schema/case-witness-statements";

export function AttachStatementsDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  caseId: string;
  witnessId: string;
  onAttached?: () => void;
}) {
  const utils = trpc.useUtils();
  const caseQ = trpc.cases.getById.useQuery({ caseId: props.caseId });
  const docs =
    (caseQ.data as { documents?: Array<{ id: string; filename: string; status: string }> } | undefined)?.documents ??
    [];
  const [documentId, setDocumentId] = useState<string>("");
  const [statementKind, setStatementKind] = useState<StatementKind>("deposition");
  const [statementDate, setStatementDate] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const attach = trpc.witnessImpeachment.attachStatement.useMutation({
    onSuccess: () => {
      utils.witnessImpeachment.listStatementsForWitness.invalidate({
        caseId: props.caseId,
        witnessId: props.witnessId,
      });
      props.onAttached?.();
      props.onOpenChange(false);
    },
  });

  const submit = () => {
    if (!documentId) return;
    attach.mutate({
      caseId: props.caseId,
      witnessId: props.witnessId,
      documentId,
      statementKind,
      statementDate: statementDate || null,
      notes: notes || null,
    });
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        role="dialog"
        aria-modal="true"
        aria-labelledby="attach-stmt-dialog-title"
        className="max-w-lg"
      >
        <DialogHeader>
          <DialogTitle id="attach-stmt-dialog-title">Attach statement</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <label className="block text-sm">
            Document
            <select
              className="mt-1 w-full rounded border p-2"
              value={documentId}
              onChange={(e) => setDocumentId(e.target.value)}
            >
              <option value="">— pick document —</option>
              {docs
                .filter((d) => d.status === "ready")
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.filename}
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-sm">
            Statement kind
            <select
              className="mt-1 w-full rounded border p-2"
              value={statementKind}
              onChange={(e) => setStatementKind(e.target.value as StatementKind)}
            >
              {STATEMENT_KIND.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Statement date (optional)
            <Input type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} />
          </label>
          <label className="block text-sm">
            Notes (optional)
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={submit} disabled={!documentId || attach.isPending}>
              {attach.isPending ? "Attaching…" : "Attach"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
