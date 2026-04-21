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
  "portal_message_received",
  "portal_document_uploaded",
  "research_bookmark_added",
  "research_session_linked",
  "research_memo_ready",
  "research_memo_failed",
  "research_collection_shared",
  "case_message_received",
  "document_request_created",
  "document_request_item_uploaded",
  "document_request_submitted",
  "document_request_item_rejected",
  "document_request_cancelled",
  "intake_form_sent",
  "intake_form_submitted",
  "intake_form_cancelled",
  "milestone_published",
  "milestone_retracted",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ["in_app", "email", "push"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_CATEGORIES = {
  cases: [
    "case_ready",
    "document_failed",
    "stage_changed",
    "task_assigned",
    "task_completed",
    "task_overdue",
    "case_message_received",
    "document_request_created",
    "document_request_item_uploaded",
    "document_request_submitted",
    "document_request_item_rejected",
    "document_request_cancelled",
    "intake_form_sent",
    "intake_form_submitted",
    "intake_form_cancelled",
    "milestone_published",
    "milestone_retracted",
  ],
  billing: ["invoice_sent", "invoice_paid", "invoice_overdue", "credits_low", "credits_exhausted"],
  team: ["team_member_invited", "team_member_joined", "added_to_case"],
  calendar: ["event_reminder", "calendar_sync_failed"],
  portal: ["portal_message_received", "portal_document_uploaded"],
  research: ["research_bookmark_added", "research_session_linked", "research_memo_ready", "research_memo_failed", "research_collection_shared"],
} as const;

export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;

export function getCategoryForType(type: NotificationType): NotificationCategory {
  for (const [category, types] of Object.entries(NOTIFICATION_CATEGORIES)) {
    if ((types as readonly string[]).includes(type)) return category as NotificationCategory;
  }
  throw new Error(`No category found for notification type: ${type}`);
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
  portal_message_received: { caseName: string; clientName: string; messagePreview: string };
  portal_document_uploaded: { caseName: string; clientName: string; documentName: string };
  research_bookmark_added: { caseName: string; citation: string; opinionId: string };
  research_session_linked: { caseName: string; sessionTitle: string; sessionId: string };
  research_memo_ready: { memoId: string; title: string };
  research_memo_failed: { memoId: string; title: string; errorMessage?: string };
  research_collection_shared: {
    collectionId: string;
    name: string;
    sharerName: string;
    sharerUserId: string;
    recipientUserId: string;
  };
  case_message_received: {
    caseId: string;
    caseName: string;
    messageId: string;
    authorName: string;
    bodyPreview: string;
    recipientUserId: string;
    recipientPortalUserId?: string;
    recipientType: "lawyer" | "portal";
  };
  document_request_created: {
    caseId: string;
    caseName: string;
    requestId: string;
    requestTitle: string;
    itemCount: number;
    recipientPortalUserId: string;
  };
  document_request_item_uploaded: {
    caseId: string;
    caseName: string;
    requestId: string;
    requestTitle: string;
    itemId: string;
    itemName: string;
    recipientUserId: string;
  };
  document_request_submitted: {
    caseId: string;
    caseName: string;
    requestId: string;
    requestTitle: string;
    recipientUserId: string;
  };
  document_request_item_rejected: {
    caseId: string;
    caseName: string;
    requestId: string;
    requestTitle: string;
    itemId: string;
    itemName: string;
    rejectionNote: string;
    recipientPortalUserId: string;
  };
  document_request_cancelled: {
    caseId: string;
    caseName: string;
    requestId: string;
    requestTitle: string;
    recipientPortalUserId: string;
  };
  intake_form_sent: {
    caseId: string;
    caseName: string;
    formId: string;
    formTitle: string;
    fieldCount: number;
    recipientPortalUserId: string;
  };
  intake_form_submitted: {
    caseId: string;
    caseName: string;
    formId: string;
    formTitle: string;
    recipientUserId: string;
  };
  intake_form_cancelled: {
    caseId: string;
    caseName: string;
    formId: string;
    formTitle: string;
    recipientPortalUserId: string;
  };
  milestone_published: {
    caseId: string;
    caseName: string;
    milestoneId: string;
    title: string;
    category: string;
    occurredAt: string;
    recipientPortalUserId: string;
  };
  milestone_retracted: {
    caseId: string;
    caseName: string;
    milestoneId: string;
    title: string;
    recipientPortalUserId: string;
  };
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
