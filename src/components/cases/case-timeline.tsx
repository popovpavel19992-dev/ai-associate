"use client";

import { useState } from "react";
import { ArrowRight, FileText, Brain, Pencil, Link2, Plus, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";

const EVENT_ICONS: Record<string, typeof ArrowRight> = {
  stage_changed: ArrowRight,
  document_added: FileText,
  analysis_completed: Brain,
  manual: Pencil,
  contract_linked: Link2,
  draft_linked: Link2,
};

interface CaseTimelineProps {
  caseId: string;
}

export function CaseTimeline({ caseId }: CaseTimelineProps) {
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const { data, isLoading } = trpc.cases.getEvents.useQuery({ caseId, limit, offset });
  const utils = trpc.useUtils();

  const addEvent = trpc.cases.addEvent.useMutation({
    onSuccess: () => {
      utils.cases.getEvents.invalidate({ caseId });
      setShowForm(false);
      setTitle("");
      setDescription("");
    },
  });

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-zinc-500" />
      </div>
    );
  }

  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const hasMore = offset + limit < total;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Timeline</h3>
        <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="mr-1 size-3" />
          Add Event
        </Button>
      </div>

      {showForm && (
        <div className="space-y-2 rounded-md border border-zinc-800 p-3">
          <input
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
            placeholder="Event title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
            placeholder="Description (optional)"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => addEvent.mutate({ caseId, title, description: description || undefined })}
              disabled={!title.trim() || addEvent.isPending}
            >
              {addEvent.isPending && <Loader2 className="mr-1 size-3 animate-spin" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {events.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">No events yet</p>
      ) : (
        <div className="space-y-0">
          {events.map((event) => {
            const Icon = EVENT_ICONS[event.type] ?? Pencil;
            return (
              <div key={event.id} className="flex gap-3 border-l border-zinc-800 py-3 pl-4">
                <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-800">
                  <Icon className="size-3 text-zinc-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{event.title}</p>
                  {event.description && (
                    <p className="mt-0.5 text-xs text-zinc-500">{event.description}</p>
                  )}
                  <p className="mt-1 text-xs text-zinc-600">
                    {formatDistanceToNow(new Date(event.occurredAt), { addSuffix: true })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => setOffset((prev) => prev + limit)}
        >
          Load more
        </Button>
      )}
    </div>
  );
}
