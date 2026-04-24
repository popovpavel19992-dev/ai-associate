"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";

type StepRow = { templateId: string; delayDays: number };

export function EditSequenceDialog({
  sequenceId,
  open,
  onOpenChange,
}: {
  sequenceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const templates = trpc.emailTemplates.list.useQuery(undefined, { enabled: open });
  const seq = trpc.dripSequences.getSequence.useQuery(
    { sequenceId: sequenceId ?? "" },
    { enabled: open && !!sequenceId },
  );

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [steps, setSteps] = React.useState<StepRow[]>([]);

  React.useEffect(() => {
    if (open && seq.data) {
      setName(seq.data.sequence.name);
      setDescription(seq.data.sequence.description ?? "");
      setSteps(
        seq.data.steps.map((s: any) => ({
          templateId: s.templateId,
          delayDays: s.delayDays,
        })),
      );
    }
  }, [open, seq.data]);

  const updateSeq = trpc.dripSequences.updateSequence.useMutation({
    onError: (e) => toast.error(e.message),
  });
  const replaceSteps = trpc.dripSequences.replaceSteps.useMutation({
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.dripSequences.deleteSequence.useMutation({
    onSuccess: async () => {
      await utils.dripSequences.listSequences.invalidate();
      toast.success("Sequence deleted");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  function addStep() {
    if (steps.length >= 10) {
      toast.error("Max 10 steps per sequence");
      return;
    }
    setSteps((s) => [...s, { templateId: "", delayDays: 1 }]);
  }
  function removeStep(idx: number) {
    setSteps((s) => (s.length === 1 ? s : s.filter((_, i) => i !== idx)));
  }
  function moveStep(idx: number, dir: -1 | 1) {
    setSteps((s) => {
      const j = idx + dir;
      if (j < 0 || j >= s.length) return s;
      const copy = s.slice();
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });
  }
  function updateStep(idx: number, patch: Partial<StepRow>) {
    setSteps((s) => s.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  async function save() {
    if (!sequenceId) return;
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (steps.length === 0) {
      toast.error("At least one step required");
      return;
    }
    for (const [i, st] of steps.entries()) {
      if (!st.templateId) {
        toast.error(`Step ${i + 1}: pick a template`);
        return;
      }
      if (st.delayDays < 0 || st.delayDays > 365) {
        toast.error(`Step ${i + 1}: delay must be 0..365`);
        return;
      }
    }
    try {
      await updateSeq.mutateAsync({
        sequenceId,
        patch: {
          name: name.trim(),
          description: description.trim(),
        },
      });
      await replaceSteps.mutateAsync({ sequenceId, steps });
      await utils.dripSequences.listSequences.invalidate();
      await utils.dripSequences.getSequence.invalidate({ sequenceId });
      toast.success("Saved");
      onOpenChange(false);
    } catch {
      // toasts already surfaced via onError
    }
  }

  const tpls = templates.data?.templates ?? [];
  const isPending = updateSeq.isPending || replaceSteps.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit drip sequence</DialogTitle>
        </DialogHeader>

        {seq.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
                rows={2}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Steps</Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addStep}
                  disabled={steps.length >= 10}
                >
                  <Plus className="size-4 mr-1" /> Add step
                </Button>
              </div>
              <div className="space-y-2">
                {steps.map((st, idx) => (
                  <div key={idx} className="flex items-center gap-2 rounded border p-2">
                    <span className="w-6 text-xs font-mono text-muted-foreground">
                      #{idx + 1}
                    </span>
                    <select
                      className="flex-1 rounded border bg-background px-2 py-1 text-sm"
                      value={st.templateId}
                      onChange={(e) => updateStep(idx, { templateId: e.target.value })}
                    >
                      <option value="">Select template…</option>
                      {tpls.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min={0}
                        max={365}
                        value={st.delayDays}
                        onChange={(e) =>
                          updateStep(idx, { delayDays: Number(e.target.value) || 0 })
                        }
                        className="w-20"
                      />
                      <span className="text-xs text-muted-foreground">days</span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => moveStep(idx, -1)}
                      disabled={idx === 0}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => moveStep(idx, 1)}
                      disabled={idx === steps.length - 1}
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeStep(idx)}
                      disabled={steps.length === 1}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="destructive"
            onClick={() => {
              if (
                sequenceId &&
                confirm(`Delete "${name}"? This fails if there are existing enrollments.`)
              ) {
                del.mutate({ sequenceId });
              }
            }}
            disabled={!sequenceId || del.isPending}
          >
            <Trash2 className="size-4 mr-1" /> Delete
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
