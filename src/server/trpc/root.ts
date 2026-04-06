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
});

export type AppRouter = typeof appRouter;
