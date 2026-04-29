"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { PublicIntakeFieldDef } from "@/server/db/schema/public-intake-templates";

function renderAnswer(field: PublicIntakeFieldDef | undefined, value: unknown) {
  if (value === null || value === undefined || value === "") return <span className="text-zinc-400">—</span>;
  if (Array.isArray(value)) return <span>{value.join(", ")}</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "object") return <pre className="text-xs">{JSON.stringify(value, null, 2)}</pre>;
  return <span className="whitespace-pre-wrap">{String(value)}</span>;
}

export default function IntakeSubmissionDetailPage() {
  const params = useParams<{ submissionId: string }>();
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.publicIntake.submissions.get.useQuery(
    { submissionId: params.submissionId },
    { enabled: !!params.submissionId },
  );

  const refresh = () => {
    utils.publicIntake.submissions.get.invalidate({ submissionId: params.submissionId });
    utils.publicIntake.submissions.list.invalidate();
  };

  const reviewMut = trpc.publicIntake.submissions.markReviewing.useMutation({
    onSuccess: () => { refresh(); toast.success("Marked as reviewing"); },
    onError: (e) => toast.error(e.message),
  });
  const spamMut = trpc.publicIntake.submissions.markSpam.useMutation({
    onSuccess: () => { refresh(); toast.success("Marked as spam"); },
    onError: (e) => toast.error(e.message),
  });
  const declineMut = trpc.publicIntake.submissions.decline.useMutation({
    onSuccess: () => { refresh(); toast.success("Declined"); },
    onError: (e) => toast.error(e.message),
  });
  const acceptMut = trpc.publicIntake.submissions.accept.useMutation({
    onSuccess: (res) => {
      refresh();
      setAcceptResult(res);
    },
    onError: (e) => toast.error(e.message),
  });

  const [declineReason, setDeclineReason] = React.useState("");
  const [declineOpen, setDeclineOpen] = React.useState(false);
  const [acceptResult, setAcceptResult] = React.useState<{ clientId: string; caseId: string; alreadyAccepted: boolean } | null>(null);

  if (isLoading || !data) return <div className="p-6 text-sm text-zinc-500">Loading…</div>;

  const { submission, template } = data;
  const fields = (template.fields as PublicIntakeFieldDef[]) ?? [];
  const fieldsByKey = new Map(fields.map((f) => [f.key, f]));
  const answerEntries = Object.entries((submission.answers as Record<string, unknown>) ?? {});

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/intake-inbox" className="text-sm text-zinc-500 hover:underline">
            ← Back to inbox
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{template.name}</h1>
          <p className="text-sm text-zinc-500">
            Submitted {new Date(submission.submittedAt).toLocaleString()}
          </p>
        </div>
        <Badge variant={submission.status === "spam" ? "destructive" : "default"}>
          {submission.status}
        </Badge>
      </div>

      {submission.honeypotValue && submission.honeypotValue.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          Honeypot triggered — this submission was automatically flagged as spam.
        </div>
      )}

      <section className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-medium">Submitter</h2>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
          <dt className="text-zinc-500">Name</dt>
          <dd className="col-span-2">{submission.submitterName ?? "—"}</dd>
          <dt className="text-zinc-500">Email</dt>
          <dd className="col-span-2">{submission.submitterEmail ?? "—"}</dd>
          <dt className="text-zinc-500">Phone</dt>
          <dd className="col-span-2">{submission.submitterPhone ?? "—"}</dd>
        </dl>
      </section>

      <section className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-medium">Answers</h2>
        {answerEntries.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">No answers were submitted.</p>
        ) : (
          <dl className="mt-2 space-y-3 text-sm">
            {answerEntries.map(([key, value]) => {
              const field = fieldsByKey.get(key);
              return (
                <div key={key}>
                  <dt className="font-medium">{field?.label ?? key}</dt>
                  <dd className="mt-0.5 text-zinc-700 dark:text-zinc-300">{renderAnswer(field, value)}</dd>
                </div>
              );
            })}
          </dl>
        )}
      </section>

      <section className="flex flex-wrap gap-2">
        {submission.status === "new" && (
          <Button variant="outline" onClick={() => reviewMut.mutate({ submissionId: submission.id })}>
            Mark reviewing
          </Button>
        )}
        {submission.status !== "accepted" && (
          <Button onClick={() => acceptMut.mutate({ submissionId: submission.id })} disabled={acceptMut.isPending}>
            Accept (create client + case)
          </Button>
        )}
        <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
          <DialogTrigger render={<Button variant="outline" />}>Decline</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Decline submission</DialogTitle>
            </DialogHeader>
            <div>
              <Textarea
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                placeholder="Optional internal note explaining why this was declined."
                rows={4}
              />
            </div>
            <DialogFooter>
              <Button
                variant="destructive"
                onClick={() => {
                  declineMut.mutate(
                    { submissionId: submission.id, reason: declineReason.trim() || undefined },
                    {
                      onSuccess: () => {
                        setDeclineOpen(false);
                        setDeclineReason("");
                      },
                    },
                  );
                }}
              >
                Confirm decline
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {submission.status !== "spam" && (
          <Button variant="ghost" onClick={() => spamMut.mutate({ submissionId: submission.id })}>
            Mark spam
          </Button>
        )}
      </section>

      {(acceptResult || (submission.status === "accepted" && submission.createdCaseId)) && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
          <p className="font-medium">
            {acceptResult?.alreadyAccepted ? "Already accepted" : "Accepted!"} Client and case have been created.
          </p>
          <p className="mt-2">
            <Link
              href={`/cases/${acceptResult?.caseId ?? submission.createdCaseId}`}
              className="underline"
            >
              View created case →
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
