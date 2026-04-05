// src/components/calendar/event-edit-modal.tsx
"use client";

import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EventForm, type EventFormSubmit } from "./event-form";

interface Props {
  eventId: string | null;
  onClose: () => void;
}

function toDatetimeLocal(d: Date | null | undefined): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventEditModal({ eventId, onClose }: Props) {
  const utils = trpc.useUtils();
  const { data: event, isLoading } = trpc.calendar.getById.useQuery(
    { id: eventId! },
    { enabled: !!eventId },
  );

  const updateMutation = trpc.calendar.update.useMutation({
    onSuccess: (updated) => {
      toast.success("Event updated");
      utils.calendar.list.invalidate({ caseId: updated.caseId });
      utils.calendar.listByDateRange.invalidate();
      utils.calendar.getById.invalidate({ id: updated.id });
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.calendar.delete.useMutation({
    onSuccess: () => {
      toast.success("Event deleted");
      if (event) {
        utils.calendar.list.invalidate({ caseId: event.caseId });
      }
      utils.calendar.listByDateRange.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = async (values: EventFormSubmit) => {
    if (!event) return;
    await updateMutation.mutateAsync({
      id: event.id,
      kind: values.kind,
      title: values.title,
      description: values.description,
      startsAt: values.startsAt,
      endsAt: values.endsAt,
      location: values.location,
      linkedTaskId: values.linkedTaskId,
    });
  };

  const handleDelete = () => {
    if (!event) return;
    if (!confirm("Delete this event?")) return;
    deleteMutation.mutate({ id: event.id });
  };

  return (
    <Dialog open={!!eventId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit event</DialogTitle>
        </DialogHeader>
        {isLoading || !event ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            <EventForm
              defaults={{
                caseId: event.caseId,
                kind: event.kind,
                title: event.title,
                description: event.description ?? "",
                startsAt: toDatetimeLocal(event.startsAt),
                endsAt: toDatetimeLocal(event.endsAt),
                location: event.location ?? "",
                linkedTaskId: event.linkedTaskId ?? "",
              }}
              disableCaseSelect
              submitLabel="Save"
              onSubmit={handleSubmit}
              onCancel={onClose}
              isSubmitting={updateMutation.isPending}
            />
            <DialogFooter>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                Delete
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
