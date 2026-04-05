// src/components/calendar/event-create-modal.tsx
"use client";

import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EventForm, type EventFormSubmit } from "./event-form";

interface Props {
  open: boolean;
  onClose: () => void;
  caseId?: string;
  caseOptions?: Array<{ id: string; name: string }>;
  defaultStartsAt?: Date;
}

function toDatetimeLocal(d: Date | undefined): string | undefined {
  if (!d) return undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventCreateModal({
  open,
  onClose,
  caseId,
  caseOptions,
  defaultStartsAt,
}: Props) {
  const utils = trpc.useUtils();
  const createMutation = trpc.calendar.create.useMutation({
    onSuccess: (created) => {
      toast.success("Event created");
      utils.calendar.list.invalidate({ caseId: created.caseId });
      utils.calendar.listByDateRange.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = async (values: EventFormSubmit) => {
    await createMutation.mutateAsync(values);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New event</DialogTitle>
        </DialogHeader>
        <EventForm
          defaults={{
            caseId: caseId ?? "",
            startsAt: toDatetimeLocal(defaultStartsAt) ?? "",
          }}
          caseOptions={caseOptions}
          disableCaseSelect={!!caseId}
          submitLabel="Create"
          onSubmit={handleSubmit}
          onCancel={onClose}
          isSubmitting={createMutation.isPending}
        />
      </DialogContent>
    </Dialog>
  );
}
