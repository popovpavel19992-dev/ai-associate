import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as organizations from "./schema/organizations";
import * as users from "./schema/users";
import * as cases from "./schema/cases";
import * as documents from "./schema/documents";
import * as documentAnalyses from "./schema/document-analyses";
import * as chatMessages from "./schema/chat-messages";
import * as subscriptions from "./schema/subscriptions";
import * as sectionPresets from "./schema/section-presets";
import * as contracts from "./schema/contracts";
import * as contractComparisons from "./schema/contract-comparisons";
import * as contractDrafts from "./schema/contract-drafts";
import * as caseStages from "./schema/case-stages";
import * as notificationsSchema from "./schema/notifications";
import * as notificationPreferences from "./schema/notification-preferences";
import * as notificationMutes from "./schema/notification-mutes";
import * as pushSubscriptions from "./schema/push-subscriptions";
import * as portalUsersSchema from "./schema/portal-users";
import * as portalSessionsSchema from "./schema/portal-sessions";
import * as portalMagicLinksSchema from "./schema/portal-magic-links";
import * as caseMessagesSchema from "./schema/case-messages";
import * as portalNotificationsSchema from "./schema/portal-notifications";
import * as portalNotificationPreferencesSchema from "./schema/portal-notification-preferences";
import * as researchSessionsSchema from "./schema/research-sessions";
import * as researchQueriesSchema from "./schema/research-queries";
import * as researchChatMessagesSchema from "./schema/research-chat-messages";
import * as cachedOpinionsSchema from "./schema/cached-opinions";
import * as cachedStatutesSchema from "./schema/cached-statutes";
import * as opinionBookmarksSchema from "./schema/opinion-bookmarks";
import * as researchUsageSchema from "./schema/research-usage";
import * as emailDripSequencesSchema from "./schema/email-drip-sequences";
import * as emailDripSequenceStepsSchema from "./schema/email-drip-sequence-steps";
import * as emailDripEnrollmentsSchema from "./schema/email-drip-enrollments";
import * as discoveryRequestTemplatesSchema from "./schema/discovery-request-templates";
import * as caseDiscoveryRequestsSchema from "./schema/case-discovery-requests";
import * as casePrivilegeLogEntriesSchema from "./schema/case-privilege-log-entries";
import * as caseWitnessListsSchema from "./schema/case-witness-lists";
import * as caseWitnessesSchema from "./schema/case-witnesses";
import * as caseExhibitListsSchema from "./schema/case-exhibit-lists";
import * as caseExhibitsSchema from "./schema/case-exhibits";
import * as juryInstructionTemplatesSchema from "./schema/jury-instruction-templates";
import * as caseJuryInstructionSetsSchema from "./schema/case-jury-instruction-sets";
import * as caseJuryInstructionsSchema from "./schema/case-jury-instructions";

const client = postgres(process.env.DATABASE_URL!);

export const db = drizzle(client, {
  schema: {
    ...organizations,
    ...users,
    ...cases,
    ...documents,
    ...documentAnalyses,
    ...chatMessages,
    ...subscriptions,
    ...sectionPresets,
    ...contracts,
    ...contractComparisons,
    ...contractDrafts,
    ...caseStages,
    ...notificationsSchema,
    ...notificationPreferences,
    ...notificationMutes,
    ...pushSubscriptions,
    ...portalUsersSchema,
    ...portalSessionsSchema,
    ...portalMagicLinksSchema,
    ...caseMessagesSchema,
    ...portalNotificationsSchema,
    ...portalNotificationPreferencesSchema,
    ...researchSessionsSchema,
    ...researchQueriesSchema,
    ...researchChatMessagesSchema,
    ...cachedOpinionsSchema,
    ...cachedStatutesSchema,
    ...opinionBookmarksSchema,
    ...researchUsageSchema,
    ...emailDripSequencesSchema,
    ...emailDripSequenceStepsSchema,
    ...emailDripEnrollmentsSchema,
    ...discoveryRequestTemplatesSchema,
    ...caseDiscoveryRequestsSchema,
    ...casePrivilegeLogEntriesSchema,
    ...caseWitnessListsSchema,
    ...caseWitnessesSchema,
    ...caseExhibitListsSchema,
    ...caseExhibitsSchema,
    ...juryInstructionTemplatesSchema,
    ...caseJuryInstructionSetsSchema,
    ...caseJuryInstructionsSchema,
  },
});
