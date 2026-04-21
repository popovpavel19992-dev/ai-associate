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

type SingleProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  multiple?: false;
  onSelect: (doc: { id: string; filename: string }) => void;
  onSelectMany?: undefined;
};

type MultiProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  multiple: true;
  onSelect?: undefined;
  onSelectMany: (docs: Array<{ id: string; filename: string }>) => void;
};

export type AttachDocumentModalProps = SingleProps | MultiProps;

export function AttachDocumentModal(props: AttachDocumentModalProps) {
  const { open, onOpenChange, caseId } = props;
  const isMulti = props.multiple === true;

  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const { data, isLoading } = trpc.caseMessages.attachableDocuments.useQuery(
    { caseId, search: search || undefined },
    { enabled: open },
  );

  React.useEffect(() => {
    if (open) {
      setSearch("");
      setSelected(new Set());
    }
  }, [open]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (isMulti) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
  }

  const submit = () => {
    const chosen = (data?.documents ?? []).filter((d) => selected.has(d.id));
    if (chosen.length === 0) return;
    if (isMulti) {
      (props as MultiProps).onSelectMany(chosen.map((d) => ({ id: d.id, filename: d.filename })));
    } else {
      const first = chosen[0];
      (props as SingleProps).onSelect({ id: first.id, filename: first.filename });
    }
    onOpenChange(false);
  };

  const selectedCount = selected.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isMulti ? "Attach documents" : "Attach a document"}</DialogTitle>
          <DialogDescription>
            Choose {isMulti ? "one or more documents" : "a document"} already uploaded to this case.
          </DialogDescription>
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
                        type={isMulti ? "checkbox" : "radio"}
                        name="doc"
                        checked={selected.has(d.id)}
                        onChange={() => toggle(d.id)}
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
          <Button onClick={submit} disabled={selectedCount === 0}>
            {isMulti ? `Attach ${selectedCount || ""}`.trim() : "Attach selected"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
