"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

export interface Component {
  label: string;
  lowCents: number;
  likelyCents: number;
  highCents: number;
  source: string;
}

export function ComponentsEditor(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  caseId: string;
  caseSummary: string;
  initial: Component[];
}) {
  const [rows, setRows] = useState<Component[]>(props.initial);
  const utils = trpc.useUtils();
  const compute = trpc.settlementCoach.computeBatna.useMutation({
    onSuccess: async () => {
      toast.success("BATNA recomputed");
      await utils.settlementCoach.getBatna.invalidate({ caseId: props.caseId });
      props.onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const submit = () => {
    compute.mutate({
      caseId: props.caseId,
      caseSummary: props.caseSummary,
      overrides: { damagesComponents: rows },
    });
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(v) => {
        if (!compute.isPending) props.onOpenChange(v);
      }}
    >
      <DialogContent
        role="dialog"
        aria-modal="true"
        aria-labelledby="components-editor-title"
        className="max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle id="components-editor-title">
            Edit damage components
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-5 gap-2 items-center"
            >
              <Input
                value={r.label}
                onChange={(e) =>
                  setRows(
                    rows.map((x, j) =>
                      j === i ? { ...x, label: e.target.value } : x,
                    ),
                  )
                }
                placeholder="Label"
              />
              <Input
                type="number"
                value={r.lowCents}
                onChange={(e) =>
                  setRows(
                    rows.map((x, j) =>
                      j === i
                        ? { ...x, lowCents: Number(e.target.value) }
                        : x,
                    ),
                  )
                }
                placeholder="Low (cents)"
              />
              <Input
                type="number"
                value={r.likelyCents}
                onChange={(e) =>
                  setRows(
                    rows.map((x, j) =>
                      j === i
                        ? { ...x, likelyCents: Number(e.target.value) }
                        : x,
                    ),
                  )
                }
                placeholder="Likely (cents)"
              />
              <Input
                type="number"
                value={r.highCents}
                onChange={(e) =>
                  setRows(
                    rows.map((x, j) =>
                      j === i
                        ? { ...x, highCents: Number(e.target.value) }
                        : x,
                    ),
                  )
                }
                placeholder="High (cents)"
              />
              <Button
                variant="ghost"
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
                disabled={compute.isPending}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() =>
              setRows([
                ...rows,
                {
                  label: "",
                  lowCents: 0,
                  likelyCents: 0,
                  highCents: 0,
                  source: "manual",
                },
              ])
            }
            disabled={compute.isPending}
          >
            + Add row
          </Button>
          <div className="flex justify-end gap-2 pt-3">
            <Button
              variant="ghost"
              onClick={() => props.onOpenChange(false)}
              disabled={compute.isPending}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={compute.isPending}>
              {compute.isPending ? "Recomputing…" : "Recompute (3cr)"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
