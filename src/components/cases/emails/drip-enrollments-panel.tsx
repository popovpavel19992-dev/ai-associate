"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, X } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

function statusLabel(s: string): string {
  if (s === "active") return "Active";
  if (s === "completed") return "Completed";
  if (s.startsWith("cancelled_")) return `Cancelled (${s.slice("cancelled_".length)})`;
  return s;
}

export function DripEnrollmentsPanel({ caseId }: { caseId: string }) {
  const utils = trpc.useUtils();
  const [enrollOpen, setEnrollOpen] = React.useState(false);

  const { data, isLoading } = trpc.dripSequences.listEnrollmentsForCase.useQuery({ caseId });

  const cancel = trpc.dripSequences.cancelEnrollment.useMutation({
    onSuccess: async () => {
      await utils.dripSequences.listEnrollmentsForCase.invalidate({ caseId });
      toast.success("Enrollment cancelled");
    },
    onError: (e) => toast.error(e.message),
  });

  const enrollments = (data ?? []) as Array<any>;

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">Drip enrollments</h3>
        <Button size="sm" onClick={() => setEnrollOpen(true)}>
          <Plus className="size-4 mr-1" /> Enroll contact
        </Button>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : enrollments.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No active drip enrollments for this case.
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {enrollments.map((e) => (
            <li key={e.id} className="flex items-center gap-2 border-b last:border-0 py-1">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{e.sequenceName}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {e.clientContactName}
                  {e.clientContactEmail ? ` <${e.clientContactEmail}>` : ""}
                  {" · step "}
                  {e.currentStepOrder + 1}
                  {" · "}
                  {statusLabel(e.status)}
                  {e.nextSendAt && e.status === "active"
                    ? ` · next ${format(new Date(e.nextSendAt), "PP p")}`
                    : ""}
                </div>
              </div>
              {e.status === "active" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => cancel.mutate({ enrollmentId: e.id })}
                  disabled={cancel.isPending}
                  title="Cancel enrollment"
                >
                  <X className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <EnrollContactDialog
        caseId={caseId}
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
      />
    </div>
  );
}

function EnrollContactDialog({
  caseId,
  open,
  onOpenChange,
}: {
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const contacts = trpc.clientContacts.listForCase.useQuery({ caseId }, { enabled: open });
  const sequences = trpc.dripSequences.listSequences.useQuery(undefined, { enabled: open });

  const [contactId, setContactId] = React.useState("");
  const [sequenceId, setSequenceId] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setContactId("");
      setSequenceId("");
    }
  }, [open]);

  const enroll = trpc.dripSequences.enrollContact.useMutation({
    onSuccess: async () => {
      await utils.dripSequences.listEnrollmentsForCase.invalidate({ caseId });
      toast.success("Contact enrolled");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const activeSequences = (sequences.data ?? []).filter((s: any) => s.isActive && s.stepCount > 0);
  const contactRows = contacts.data?.contacts ?? [];

  function submit() {
    if (!contactId) {
      toast.error("Pick a contact");
      return;
    }
    if (!sequenceId) {
      toast.error("Pick a sequence");
      return;
    }
    enroll.mutate({
      sequenceId,
      clientContactId: contactId,
      // MVP constraint: enrollments require caseId — sweeper skips otherwise.
      caseId,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enroll contact in drip sequence</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Contact</Label>
            <select
              className="w-full rounded border bg-background px-2 py-1 text-sm"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
            >
              <option value="">Select contact…</option>
              {contactRows.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.email ? ` <${c.email}>` : ""}
                </option>
              ))}
            </select>
            {contactRows.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                No contacts on this case&apos;s client.
              </p>
            )}
          </div>

          <div>
            <Label>Sequence</Label>
            <select
              className="w-full rounded border bg-background px-2 py-1 text-sm"
              value={sequenceId}
              onChange={(e) => setSequenceId(e.target.value)}
            >
              <option value="">Select sequence…</option>
              {activeSequences.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.stepCount} steps)
                </option>
              ))}
            </select>
            {activeSequences.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                No active sequences. Create one in Settings → Email sequences.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={enroll.isPending}>
            {enroll.isPending ? "Enrolling…" : "Enroll"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
