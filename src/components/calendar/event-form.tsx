// src/components/calendar/event-form.tsx
"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import {
  CALENDAR_EVENT_KINDS,
  CALENDAR_EVENT_KIND_META,
} from "@/lib/calendar-events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

/**
 * Form-local schema. Uses datetime-local strings that we convert to Date on submit.
 * The server-side schema (`calendarEventCreateSchema`) is the source of truth.
 */
const formSchema = z
  .object({
    caseId: z.string().uuid(),
    kind: z.enum(CALENDAR_EVENT_KINDS),
    title: z.string().min(1, "Title is required").max(200),
    description: z.string().max(5000).optional().or(z.literal("")),
    startsAt: z.string().min(1, "Start is required"),
    endsAt: z.string().optional().or(z.literal("")),
    location: z.string().max(300).optional().or(z.literal("")),
    linkedTaskId: z.string().uuid().optional().or(z.literal("")),
  })
  .refine(
    (d) => !d.endsAt || new Date(d.endsAt) > new Date(d.startsAt),
    { path: ["endsAt"], message: "End must be after start" },
  );

export type EventFormValues = z.infer<typeof formSchema>;

export interface EventFormSubmit {
  caseId: string;
  kind: (typeof CALENDAR_EVENT_KINDS)[number];
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  location: string | null;
  linkedTaskId: string | null;
}

interface Props {
  defaults?: Partial<EventFormValues>;
  caseOptions?: Array<{ id: string; name: string }>;
  disableCaseSelect?: boolean;
  submitLabel: string;
  onSubmit: (values: EventFormSubmit) => Promise<void> | void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

export function EventForm({
  defaults,
  caseOptions,
  disableCaseSelect,
  submitLabel,
  onSubmit,
  onCancel,
  isSubmitting,
}: Props) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<EventFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      kind: "meeting",
      ...defaults,
    },
  });

  const submit = handleSubmit(async (values) => {
    await onSubmit({
      caseId: values.caseId,
      kind: values.kind,
      title: values.title,
      description: values.description?.trim() ? values.description : null,
      startsAt: new Date(values.startsAt),
      endsAt: values.endsAt ? new Date(values.endsAt) : null,
      location: values.location?.trim() ? values.location : null,
      linkedTaskId: values.linkedTaskId || null,
    });
  });

  return (
    <form onSubmit={submit} className="space-y-4">
      {!disableCaseSelect && caseOptions && (
        <div>
          <Label htmlFor="caseId">Case</Label>
          <Controller
            control={control}
            name="caseId"
            render={({ field }) => (
              <select
                id="caseId"
                {...field}
                className="w-full rounded-md border border-zinc-800 bg-zinc-950 p-2 text-sm"
              >
                <option value="">Select a case…</option>
                {caseOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          />
          {errors.caseId && (
            <p className="mt-1 text-xs text-red-500">Case is required</p>
          )}
        </div>
      )}

      <div>
        <Label htmlFor="title">Title</Label>
        <Input id="title" {...register("title")} />
        {errors.title && (
          <p className="mt-1 text-xs text-red-500">{errors.title.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="kind">Kind</Label>
        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <select
              id="kind"
              {...field}
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 p-2 text-sm"
            >
              {CALENDAR_EVENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CALENDAR_EVENT_KIND_META[k].label}
                </option>
              ))}
            </select>
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="startsAt">Starts</Label>
          <Input
            id="startsAt"
            type="datetime-local"
            {...register("startsAt")}
          />
          {errors.startsAt && (
            <p className="mt-1 text-xs text-red-500">
              {errors.startsAt.message}
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="endsAt">Ends (optional)</Label>
          <Input id="endsAt" type="datetime-local" {...register("endsAt")} />
          {errors.endsAt && (
            <p className="mt-1 text-xs text-red-500">{errors.endsAt.message}</p>
          )}
        </div>
      </div>

      <div>
        <Label htmlFor="location">Location (optional)</Label>
        <Input id="location" {...register("location")} />
      </div>

      <div>
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea id="description" rows={3} {...register("description")} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
