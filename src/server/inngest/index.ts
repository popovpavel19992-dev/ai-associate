import { extractDocument } from "./functions/extract-document";
import { caseAnalyze } from "./functions/case-analyze";
import { contractAnalyze } from "./functions/contract-analyze";
import { contractCompare } from "./functions/contract-compare";
import { contractGenerate } from "./functions/contract-generate";
import { creditReset } from "./functions/credit-reset";
import { autoDelete } from "./functions/auto-delete";
import { calendarEventSync } from "./functions/calendar-event-sync";
import { calendarSweep } from "./functions/calendar-sweep";
import { calendarConnectionInit } from "./functions/calendar-connection-init";
import { calendarConnectionCleanup } from "./functions/calendar-connection-cleanup";
import { teamMembershipCleanup } from "./functions/team-membership-cleanup";
import { handleNotification } from "./functions/handle-notification";
import { notificationReminders } from "./functions/notification-reminders";
import { notificationOverdueCheck } from "./functions/notification-overdue-check";
import { handlePortalNotification } from "./functions/handle-portal-notification";
import { researchEnrichOpinion } from "./functions/research-enrich-opinion";
import { researchEnrichStatute } from "./functions/research-enrich-statute";
import { researchMemoGenerate } from "./functions/research-memo-generate";
import { caseMessageBroadcast } from "./functions/case-message-broadcast";
import {
  documentRequestCreatedBroadcast,
  documentRequestItemUploadedBroadcast,
  documentRequestSubmittedBroadcast,
  documentRequestItemRejectedBroadcast,
  documentRequestCancelledBroadcast,
} from "./functions/document-request-broadcast";
import {
  documentRequestCreatedNotify,
  documentRequestItemUploadedNotify,
  documentRequestSubmittedNotify,
  documentRequestItemRejectedNotify,
  documentRequestCancelledNotify,
} from "./functions/document-request-notifications";

export const functions = [extractDocument, caseAnalyze, contractAnalyze, contractCompare, contractGenerate, creditReset, autoDelete, calendarEventSync, calendarSweep, calendarConnectionInit, calendarConnectionCleanup, teamMembershipCleanup, handleNotification, notificationReminders, notificationOverdueCheck, handlePortalNotification, researchEnrichOpinion, researchEnrichStatute, researchMemoGenerate, caseMessageBroadcast, documentRequestCreatedBroadcast, documentRequestItemUploadedBroadcast, documentRequestSubmittedBroadcast, documentRequestItemRejectedBroadcast, documentRequestCancelledBroadcast, documentRequestCreatedNotify, documentRequestItemUploadedNotify, documentRequestSubmittedNotify, documentRequestItemRejectedNotify, documentRequestCancelledNotify];
