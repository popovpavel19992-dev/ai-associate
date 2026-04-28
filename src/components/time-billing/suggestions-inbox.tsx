"use client";

// Phase 3.9 — Suggestions inbox: lists pending suggested_time_entries
// derived from passive activity tracking. The lawyer can Accept (one
// click → real time_entry), Edit & Accept (with tweaks), or Dismiss.

import { useState } from "react";
import { toast } from "sonner";
import { Check, Edit3, X, RefreshCw, Clock } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatHours } from "@/lib/billing";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

interface PendingRow {
  id: string;
  caseId: string;
  caseName: string | null;
  sessionStartedAt: string | Date;
  totalMinutes: number;
  suggestedDescription: string;
}

function fmtDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface SuggestionsInboxProps {
  /** When provided, only suggestions for this case are shown. */
  caseId?: string;
}

export function SuggestionsInbox({ caseId }: SuggestionsInboxProps) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.activityTracking.listPendingSuggestions.useQuery();
  const refresh = trpc.activityTracking.refreshSuggestions.useMutation({
    onSuccess: async (r) => {
      toast.success(
        r.created > 0
          ? `Found ${r.created} new suggestion${r.created === 1 ? "" : "s"}`
          : "No new suggestions",
      );
      await utils.activityTracking.listPendingSuggestions.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const accept = trpc.activityTracking.acceptSuggestion.useMutation({
    onSuccess: async () => {
      toast.success("Time entry created");
      await utils.activityTracking.listPendingSuggestions.invalidate();
      await utils.timeEntries.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const dismiss = trpc.activityTracking.dismissSuggestion.useMutation({
    onSuccess: async () => {
      await utils.activityTracking.listPendingSuggestions.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const [editing, setEditing] = useState<PendingRow | null>(null);

  const all = (data?.suggestions ?? []) as PendingRow[];
  const suggestions = caseId ? all.filter((s) => s.caseId === caseId) : all;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">
          Suggestions ({suggestions.length})
        </h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refresh.mutate(undefined)}
          disabled={refresh.isPending}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <p className="text-xs text-zinc-500">Loading…</p>
      ) : suggestions.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
          No pending suggestions. Click Refresh to scan recent activity.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
          {suggestions.map((s) => (
            <li key={s.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                  <span>{fmtDate(s.sessionStartedAt)}</span>
                  {s.caseName ? (
                    <>
                      <span>·</span>
                      <span className="truncate text-zinc-300">{s.caseName}</span>
                    </>
                  ) : null}
                  <span>·</span>
                  <span className="inline-flex items-center gap-1 text-zinc-300">
                    <Clock className="h-3 w-3" />
                    {formatHours(s.totalMinutes)} hr
                  </span>
                </div>
                <p className="mt-1 truncate text-sm italic text-zinc-300">
                  {s.suggestedDescription}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  onClick={() => accept.mutate({ suggestionId: s.id })}
                  disabled={accept.isPending}
                >
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(s)}
                >
                  <Edit3 className="mr-1 h-3.5 w-3.5" />
                  Edit & Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => dismiss.mutate({ suggestionId: s.id })}
                  disabled={dismiss.isPending}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Dismiss
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <EditAndAcceptDialog
        suggestion={editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        onSubmit={async (vals) => {
          if (!editing) return;
          await accept.mutateAsync({ suggestionId: editing.id, ...vals });
          setEditing(null);
        }}
      />
    </div>
  );
}

interface EditDialogProps {
  suggestion: PendingRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (vals: {
    description?: string;
    billableRate?: number;
    billable?: boolean;
  }) => Promise<void>;
}

function EditAndAcceptDialog({
  suggestion,
  open,
  onOpenChange,
  onSubmit,
}: EditDialogProps) {
  const [description, setDescription] = useState("");
  const [billable, setBillable] = useState(true);
  const [rateDollars, setRateDollars] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Sync form state when the suggestion changes.
  if (suggestion && description === "" && open) {
    setDescription(suggestion.suggestedDescription);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => {
      onOpenChange(o);
      if (!o) {
        setDescription("");
        setBillable(true);
        setRateDollars("");
      }
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit & Accept Suggestion</DialogTitle>
        </DialogHeader>
        {suggestion ? (
          <div className="space-y-3">
            <div className="text-xs text-zinc-500">
              {fmtDate(suggestion.sessionStartedAt)} ·{" "}
              {formatHours(suggestion.totalMinutes)} hr
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="billable"
                type="checkbox"
                checked={billable}
                onChange={(e) => setBillable(e.target.checked)}
                className="h-4 w-4"
              />
              <Label htmlFor="billable">Billable</Label>
            </div>
            <div className="space-y-1">
              <Label>Override rate (USD/hr, optional)</Label>
              <Input
                type="number"
                value={rateDollars}
                onChange={(e) => setRateDollars(e.target.value)}
                placeholder="Leave blank to use default rate"
              />
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={submitting || !suggestion}
            onClick={async () => {
              if (!suggestion) return;
              setSubmitting(true);
              const rateNum = rateDollars.trim() === "" ? undefined : Number(rateDollars);
              try {
                await onSubmit({
                  description,
                  billable,
                  billableRate:
                    rateNum !== undefined && Number.isFinite(rateNum)
                      ? Math.round(rateNum * 100)
                      : undefined,
                });
              } finally {
                setSubmitting(false);
              }
            }}
          >
            Create Time Entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
