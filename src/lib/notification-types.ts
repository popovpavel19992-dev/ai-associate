// src/lib/notification-types.ts

export const NOTIFICATION_TYPES = [
  "case_ready",
  "document_failed",
  "stage_changed",
  "task_assigned",
  "task_completed",
  "task_overdue",
  "invoice_sent",
  "invoice_paid",
  "invoice_overdue",
  "credits_low",
  "credits_exhausted",
  "team_member_invited",
  "team_member_joined",
  "added_to_case",
  "event_reminder",
  "calendar_sync_failed",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ["in_app", "email", "push"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_CATEGORIES = {
  cases: ["case_ready", "document_failed", "stage_changed", "task_assigned", "task_completed", "task_overdue"],
  billing: ["invoice_sent", "invoice_paid", "invoice_overdue", "credits_low", "credits_exhausted"],
  team: ["team_member_invited", "team_member_joined", "added_to_case"],
  calendar: ["event_reminder", "calendar_sync_failed"],
} as const;

export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;

export function getCategoryForType(type: NotificationType): NotificationCategory {
  for (const [category, types] of Object.entries(NOTIFICATION_CATEGORIES)) {
    if ((types as readonly string[]).includes(type)) return category as NotificationCategory;
  }
  return "cases";
}

export type NotificationMetadata = {
  case_ready: { caseName: string; documentCount: number };
  document_failed: { caseName: string; documentName: string; error: string };
  stage_changed: { caseName: string; fromStage: string; toStage: string };
  task_assigned: { caseName: string; taskTitle: string };
  task_completed: { caseName: string; taskTitle: string; completedBy: string };
  task_overdue: { caseName: string; taskTitle: string; dueDate: string };
  invoice_sent: { invoiceNumber: string; clientName: string; amount: string };
  invoice_paid: { invoiceNumber: string; clientName: string; amount: string };
  invoice_overdue: { invoiceNumber: string; clientName: string; amount: string; dueDate: string };
  credits_low: { creditsUsed: number; creditsLimit: number };
  credits_exhausted: { creditsLimit: number };
  team_member_invited: { inviterName: string; orgName: string };
  team_member_joined: { memberName: string };
  added_to_case: { caseName: string; addedBy: string };
  event_reminder: { eventTitle: string; startTime: string; minutesBefore: number };
  calendar_sync_failed: { providerName: string; error: string };
};

/** Inngest event payload for notification/send */
export interface NotificationSendEvent {
  userId?: string;
  recipientEmail?: string;
  orgId?: string;
  type: NotificationType;
  title: string;
  body: string;
  caseId?: string;
  actionUrl?: string;
  metadata?: NotificationMetadata[NotificationType];
  dedupKey?: string;
}
