"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CATEGORIES,
  type NotificationType,
  type NotificationChannel,
} from "@/lib/notification-types";

const TYPE_LABELS: Record<NotificationType, string> = {
  case_ready: "Case ready",
  document_failed: "Document failed",
  stage_changed: "Stage changed",
  task_assigned: "Task assigned",
  task_completed: "Task completed",
  task_overdue: "Task overdue",
  invoice_sent: "Invoice sent",
  invoice_paid: "Invoice paid",
  invoice_overdue: "Invoice overdue",
  credits_low: "Credits low",
  credits_exhausted: "Credits exhausted",
  team_member_invited: "Member invited",
  team_member_joined: "Member joined",
  added_to_case: "Added to case",
  event_reminder: "Event reminder",
  calendar_sync_failed: "Calendar sync failed",
  portal_message_received: "Portal message received",
  portal_document_uploaded: "Portal document uploaded",
  research_bookmark_added: "Research bookmark added",
  research_session_linked: "Research session linked",
  research_memo_ready: "Memo ready",
  research_memo_failed: "Memo generation failed",
  research_collection_shared: "Collection shared with you",
  case_message_received: "New message in case",
  document_request_created: "Document request created",
  document_request_item_uploaded: "Document request item uploaded",
  document_request_submitted: "Document request submitted",
  document_request_item_rejected: "Document request item rejected",
  document_request_cancelled: "Document request cancelled",
  intake_form_sent: "Intake form received",
  intake_form_submitted: "Intake form submitted",
  intake_form_cancelled: "Intake form cancelled",
  milestone_published: "Case update published",
  milestone_retracted: "Case update retracted",
  email_reply_received: "Client replied to sent email",
  email_complained: "Recipient marked a sent email as spam",
  signature_request_signed: "A signer signed a request",
  signature_request_all_signed: "All parties signed a request",
  signature_request_declined: "A signer declined a request",
  signature_request_expired: "A signature request expired",
  deadline_upcoming: "Deadline coming up",
  deadline_due_today: "Deadline due today",
  deadline_overdue: "Deadline is overdue",
  filing_submitted: "Filing submitted to court",
};

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  in_app: "In-app",
  email: "Email",
  push: "Push",
};

const CATEGORY_LABELS: Record<string, string> = {
  cases: "Cases",
  billing: "Billing",
  team: "Team",
  calendar: "Calendar",
  deadlines: "Deadlines",
  filings: "Filings",
};

// Types that are email-only (no in_app/push toggle)
const EMAIL_ONLY_TYPES: NotificationType[] = ["team_member_invited"];

export function NotificationPreferencesMatrix() {
  const utils = trpc.useUtils();
  const { data: matrix, isLoading } = trpc.notificationPreferences.get.useQuery();

  const update = trpc.notificationPreferences.update.useMutation({
    onSuccess: () => utils.notificationPreferences.get.invalidate(),
  });

  const resetDefaults = trpc.notificationPreferences.resetDefaults.useMutation({
    onSuccess: () => utils.notificationPreferences.get.invalidate(),
  });

  if (isLoading || !matrix) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {Object.entries(NOTIFICATION_CATEGORIES).map(([categoryKey, types]) => (
        <div key={categoryKey}>
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            {CATEGORY_LABELS[categoryKey] ?? categoryKey}
          </h3>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-muted/50 dark:border-zinc-800">
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                    Notification
                  </th>
                  {NOTIFICATION_CHANNELS.map((ch) => (
                    <th
                      key={ch}
                      className="px-4 py-2 text-center font-medium text-muted-foreground"
                    >
                      {CHANNEL_LABELS[ch]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(types as readonly NotificationType[]).map((type) => (
                  <tr
                    key={type}
                    className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50"
                  >
                    <td className="px-4 py-2.5 text-sm">
                      {TYPE_LABELS[type] ?? type}
                    </td>
                    {NOTIFICATION_CHANNELS.map((channel) => {
                      const isDisabled =
                        EMAIL_ONLY_TYPES.includes(type) && channel !== "email";
                      const enabled = isDisabled
                        ? false
                        : (matrix[type]?.[channel] ?? true);

                      return (
                        <td key={channel} className="px-4 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={enabled}
                            disabled={isDisabled || update.isPending}
                            onChange={(e) =>
                              update.mutate({ type, channel, enabled: e.target.checked })
                            }
                            className="h-4 w-4 rounded border-zinc-300 accent-zinc-900 disabled:opacity-40 dark:accent-zinc-100"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => resetDefaults.mutate()}
          disabled={resetDefaults.isPending}
        >
          {resetDefaults.isPending && (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          )}
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}
