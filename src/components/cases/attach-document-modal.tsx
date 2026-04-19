// src/components/cases/attach-document-modal.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Paperclip } from "lucide-react";

interface AttachDocumentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  onSelect: (doc: { id: string; filename: string }) => void;
}

export function AttachDocumentModal({ open, onOpenChange, caseId, onSelect }: AttachDocumentModalProps) {
  const [search, setSearch] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const { data, isLoading } = trpc.caseMessages.attachableDocuments.useQuery(
    { caseId, search: search || undefined },
    { enabled: open },
  );

  React.useEffect(() => {
    if (open) {
      setSearch("");
      setSelectedId(null);
    }
  }, [open]);

  const submit = () => {
    const doc = data?.documents.find((d) => d.id === selectedId);
    if (!doc) return;
    onSelect({ id: doc.id, filename: doc.filename });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Attach a document</DialogTitle>
          <DialogDescription>Choose a document already uploaded to this case.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents…"
            maxLength={200}
          />
          <div className="max-h-72 overflow-y-auto">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (data?.documents ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No documents in this case yet. Upload via Documents tab first.
              </p>
            ) : (
              <ul className="space-y-1">
                {(data?.documents ?? []).map((d) => (
                  <li key={d.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded p-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">
                      <input
                        type="radio"
                        name="doc"
                        checked={selectedId === d.id}
                        onChange={() => setSelectedId(d.id)}
                      />
                      <Paperclip className="size-3.5 text-muted-foreground" aria-hidden />
                      <span className="flex-1 truncate">{d.filename}</span>
                      <span className="text-xs text-muted-foreground">
                        {Math.round((d.fileSize ?? 0) / 1024)} KB
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!selectedId}>Attach selected</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
