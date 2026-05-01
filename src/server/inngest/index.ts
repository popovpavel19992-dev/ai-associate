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
import {
  calendarInboundSweep,
  calendarInboundPullOne,
} from "./functions/calendar-inbound-sweep";
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
import {
  intakeFormSentBroadcast,
  intakeFormSubmittedBroadcast,
  intakeFormCancelledBroadcast,
} from "./functions/intake-form-broadcast";
import {
  intakeFormSentNotify,
  intakeFormSubmittedNotify,
  intakeFormCancelledNotify,
} from "./functions/intake-form-notifications";
import {
  milestonePublishedBroadcast,
  milestoneRetractedBroadcast,
} from "./functions/milestone-broadcast";
import {
  milestonePublishedNotify,
  milestoneRetractedNotify,
} from "./functions/milestone-notifications";
import { emailReplyNotification } from "./functions/email-reply-notification";
import { deadlineRemindersDaily } from "./functions/deadline-reminders";
import { dripSequenceSweeper } from "./functions/drip-sequence-sweeper";
import { autoBillableSuggestionSweep } from "./functions/auto-billable-suggestion-sweep";
import { publicIntakeSubmissionCreated } from "./functions/public-intake-notifications";
import { oooStatusSweep } from "./functions/ooo-status-sweep";
import { discoveryDeadlineSweep } from "./functions/discovery-deadline-sweep";
import { caseDigestSweep } from "./functions/case-digest-sweep";
import { strategyEmbedDocument } from "./functions/strategy-embed-document";
import { strategyRefresh } from "./functions/strategy-refresh";

export const functions = [extractDocument, caseAnalyze, contractAnalyze, contractCompare, contractGenerate, creditReset, autoDelete, calendarEventSync, calendarSweep, calendarConnectionInit, calendarConnectionCleanup, calendarInboundSweep, calendarInboundPullOne, teamMembershipCleanup, handleNotification, notificationReminders, notificationOverdueCheck, handlePortalNotification, researchEnrichOpinion, researchEnrichStatute, researchMemoGenerate, caseMessageBroadcast, documentRequestCreatedBroadcast, documentRequestItemUploadedBroadcast, documentRequestSubmittedBroadcast, documentRequestItemRejectedBroadcast, documentRequestCancelledBroadcast, documentRequestCreatedNotify, documentRequestItemUploadedNotify, documentRequestSubmittedNotify, documentRequestItemRejectedNotify, documentRequestCancelledNotify, intakeFormSentBroadcast, intakeFormSubmittedBroadcast, intakeFormCancelledBroadcast, intakeFormSentNotify, intakeFormSubmittedNotify, intakeFormCancelledNotify, milestonePublishedBroadcast, milestoneRetractedBroadcast, milestonePublishedNotify, milestoneRetractedNotify, emailReplyNotification, deadlineRemindersDaily, dripSequenceSweeper, autoBillableSuggestionSweep, publicIntakeSubmissionCreated, oooStatusSweep, discoveryDeadlineSweep, caseDigestSweep, strategyEmbedDocument, strategyRefresh];
