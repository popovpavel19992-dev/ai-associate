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
});

export type AppRouter = typeof appRouter;
