import { router } from "./trpc";
import { usersRouter } from "./routers/users";
import { documentsRouter } from "./routers/documents";
import { casesRouter } from "./routers/cases";
import { chatRouter } from "./routers/chat";
import { subscriptionsRouter } from "./routers/subscriptions";
import { presetsRouter } from "./routers/presets";
import { contractsRouter } from "./routers/contracts";
import { comparisonsRouter } from "./routers/comparisons";
import { draftsRouter } from "./routers/drafts";
import { caseTasksRouter } from "./routers/case-tasks";
import { calendarRouter } from "./routers/calendar";
import { calendarConnectionsRouter } from "./routers/calendar-connections";
import { teamRouter } from "./routers/team";
import { caseMembersRouter } from "./routers/case-members";
import { clientsRouter } from "./routers/clients";
import { clientContactsRouter } from "./routers/client-contacts";
import { timeEntriesRouter } from "./routers/time-entries";
import { expensesRouter } from "./routers/expenses";
import { billingRatesRouter } from "./routers/billing-rates";
import { invoicesRouter } from "./routers/invoices";
import { notificationsRouter } from "./routers/notifications";
import { notificationPreferencesRouter } from "./routers/notification-preferences";
import { notificationMutesRouter } from "./routers/notification-mutes";
import { pushSubscriptionsRouter } from "./routers/push-subscriptions";
import { portalAuthRouter } from "./routers/portal-auth";
import { portalCasesRouter } from "./routers/portal-cases";
import { portalDocumentsRouter } from "./routers/portal-documents";
import { portalMessagesRouter } from "./routers/portal-messages";
import { portalInvoicesRouter } from "./routers/portal-invoices";
import { portalCalendarRouter } from "./routers/portal-calendar";
import { portalTasksRouter } from "./routers/portal-tasks";
import { portalNotificationsRouter } from "./routers/portal-notifications";
import { portalUsersRouter } from "./routers/portal-users";
import { portalNotificationPreferencesRouter } from "./routers/portal-notification-preferences";
import { portalLawyerRouter } from "./routers/portal-lawyer";
import { researchRouter } from "./routers/research";
import { caseMessagesRouter } from "./routers/case-messages";
import { documentRequestsRouter } from "./routers/document-requests";
import { portalDocumentRequestsRouter } from "./routers/portal-document-requests";
import { intakeFormsRouter } from "./routers/intake-forms";
import { portalIntakeFormsRouter } from "./routers/portal-intake-forms";
import { milestonesRouter } from "./routers/milestones";
import { portalMilestonesRouter } from "./routers/portal-milestones";
import { emailTemplatesRouter } from "./routers/email-templates";
import { caseEmailsRouter } from "./routers/case-emails";
import { caseSignaturesRouter } from "./routers/case-signatures";
import { portalSignaturesRouter } from "./routers/portal-signatures";
import { deadlinesRouter } from "./routers/deadlines";
import { motionsRouter } from "./routers/motions";
import { filingPackagesRouter } from "./routers/filing-packages";
import { filingsRouter } from "./routers/filings";
import { partiesRouter } from "./routers/parties";
import { servicesRouter } from "./routers/services";
import { dripSequencesRouter } from "./routers/drip-sequences";
import { discoveryRouter } from "./routers/discovery";
import { privilegeLogRouter } from "./routers/privilege-log";
import { witnessListsRouter } from "./routers/witness-lists";
import { exhibitListsRouter } from "./routers/exhibit-lists";
import { juryInstructionsRouter } from "./routers/jury-instructions";
import { voirDireRouter } from "./routers/voir-dire";
import { depositionPrepRouter } from "./routers/deposition-prep";
import { motionsInLimineRouter } from "./routers/motions-in-limine";
import { subpoenasRouter } from "./routers/subpoenas";
import { settlementRouter } from "./routers/settlement";
import { analyticsRouter } from "./routers/analytics";
import { calendarExportRouter } from "./routers/calendar-export";
import { conflictCheckerRouter } from "./routers/conflict-checker";
import { trustAccountingRouter } from "./routers/trust-accounting";
import { activityTrackingRouter } from "./routers/activity-tracking";
import { clientCommsRouter } from "./routers/client-comms";
import { publicIntakeRouter } from "./routers/public-intake";
import { documentTemplatesRouter } from "./routers/document-templates";
import { courtRulesRouter } from "./routers/court-rules";
import { outOfOfficeRouter } from "./routers/out-of-office";
import { bulkOperationsRouter } from "./routers/bulk-operations";
import { discoveryResponsesRouter } from "./routers/discovery-responses";
import { caseDigestRouter } from "./routers/case-digest";
import { caseStrategyRouter } from "./routers/case-strategy";
import { caseStrategyChatRouter } from "./routers/case-strategy-chat";

export const appRouter = router({
  users: usersRouter,
  documents: documentsRouter,
  cases: casesRouter,
  chat: chatRouter,
  subscriptions: subscriptionsRouter,
  presets: presetsRouter,
  contracts: contractsRouter,
  comparisons: comparisonsRouter,
  drafts: draftsRouter,
  caseTasks: caseTasksRouter,
  calendar: calendarRouter,
  calendarConnections: calendarConnectionsRouter,
  calendarExport: calendarExportRouter,
  team: teamRouter,
  caseMembers: caseMembersRouter,
  clients: clientsRouter,
  clientContacts: clientContactsRouter,
  timeEntries: timeEntriesRouter,
  expenses: expensesRouter,
  billingRates: billingRatesRouter,
  invoices: invoicesRouter,
  notifications: notificationsRouter,
  notificationPreferences: notificationPreferencesRouter,
  notificationMutes: notificationMutesRouter,
  pushSubscriptions: pushSubscriptionsRouter,
  portalAuth: portalAuthRouter,
  portalCases: portalCasesRouter,
  portalDocuments: portalDocumentsRouter,
  portalMessages: portalMessagesRouter,
  portalInvoices: portalInvoicesRouter,
  portalCalendar: portalCalendarRouter,
  portalTasks: portalTasksRouter,
  portalNotifications: portalNotificationsRouter,
  portalUsers: portalUsersRouter,
  portalNotificationPreferences: portalNotificationPreferencesRouter,
  portalLawyer: portalLawyerRouter,
  research: researchRouter,
  caseMessages: caseMessagesRouter,
  documentRequests: documentRequestsRouter,
  portalDocumentRequests: portalDocumentRequestsRouter,
  intakeForms: intakeFormsRouter,
  portalIntakeForms: portalIntakeFormsRouter,
  milestones: milestonesRouter,
  portalMilestones: portalMilestonesRouter,
  emailTemplates: emailTemplatesRouter,
  caseEmails: caseEmailsRouter,
  caseSignatures: caseSignaturesRouter,
  portalSignatures: portalSignaturesRouter,
  deadlines: deadlinesRouter,
  motions: motionsRouter,
  filingPackages: filingPackagesRouter,
  filings: filingsRouter,
  parties: partiesRouter,
  services: servicesRouter,
  dripSequences: dripSequencesRouter,
  discovery: discoveryRouter,
  privilegeLog: privilegeLogRouter,
  witnessLists: witnessListsRouter,
  exhibitLists: exhibitListsRouter,
  juryInstructions: juryInstructionsRouter,
  voirDire: voirDireRouter,
  depositionPrep: depositionPrepRouter,
  motionsInLimine: motionsInLimineRouter,
  subpoenas: subpoenasRouter,
  settlement: settlementRouter,
  analytics: analyticsRouter,
  conflictChecker: conflictCheckerRouter,
  trustAccounting: trustAccountingRouter,
  activityTracking: activityTrackingRouter,
  clientComms: clientCommsRouter,
  publicIntake: publicIntakeRouter,
  documentTemplates: documentTemplatesRouter,
  courtRules: courtRulesRouter,
  outOfOffice: outOfOfficeRouter,
  bulkOperations: bulkOperationsRouter,
  discoveryResponses: discoveryResponsesRouter,
  caseDigest: caseDigestRouter,
  caseStrategy: caseStrategyRouter,
  caseStrategyChat: caseStrategyChatRouter,
});

export type AppRouter = typeof appRouter;
