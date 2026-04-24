"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { NewSequenceDialog } from "@/components/drip-sequences/new-sequence-dialog";
import { EditSequenceDialog } from "@/components/drip-sequences/edit-sequence-dialog";

export default function EmailSequencesPage() {
  const utils = trpc.useUtils();
  const [newOpen, setNewOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  const { data, isLoading } = trpc.dripSequences.listSequences.useQuery();
  const update = trpc.dripSequences.updateSequence.useMutation({
    onSuccess: () => utils.dripSequences.listSequences.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.dripSequences.deleteSequence.useMutation({
    onSuccess: () => {
      utils.dripSequences.listSequences.invalidate();
      toast.success("Sequence deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Email sequences</h1>
          <p className="text-sm text-muted-foreground">
            Drip emails on a schedule. Enroll contacts from any case.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          <Plus className="size-4 mr-1" /> New sequence
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sequences yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2">Name</th>
              <th className="p-2">Steps</th>
              <th className="p-2">Active enrollments</th>
              <th className="p-2">Status</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {data.map((s: any) => (
              <tr key={s.id} className="border-t hover:bg-muted/50">
                <td className="p-2">
                  <button
                    className="font-medium hover:underline"
                    onClick={() => setEditingId(s.id)}
                  >
                    {s.name}
                  </button>
                  {s.description && (
                    <p className="text-xs text-muted-foreground">{s.description}</p>
                  )}
                </td>
                <td className="p-2">{s.stepCount}</td>
                <td className="p-2">
                  {s.activeEnrollmentCount}
                  <span className="text-xs text-muted-foreground"> / {s.totalEnrollmentCount}</span>
                </td>
                <td className="p-2">
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={s.isActive}
                      onChange={(e) =>
                        update.mutate({
                          sequenceId: s.id,
                          patch: { isActive: e.target.checked },
                        })
                      }
                    />
                    {s.isActive ? "Active" : "Inactive"}
                  </label>
                </td>
                <td className="p-2 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (
                        confirm(
                          `Delete "${s.name}"? This fails if there are existing enrollments.`,
                        )
                      ) {
                        del.mutate({ sequenceId: s.id });
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <NewSequenceDialog open={newOpen} onOpenChange={setNewOpen} />
      <EditSequenceDialog
        sequenceId={editingId}
        open={editingId !== null}
        onOpenChange={(o) => {
          if (!o) setEditingId(null);
        }}
      />
    </div>
  );
}
