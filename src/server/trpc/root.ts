import { router } from "./trpc";
import { usersRouter } from "./routers/users";
import { documentsRouter } from "./routers/documents";
import { casesRouter } from "./routers/cases";
import { chatRouter } from "./routers/chat";
import { subscriptionsRouter } from "./routers/subscriptions";
import { presetsRouter } from "./routers/presets";

export const appRouter = router({
  users: usersRouter,
  documents: documentsRouter,
  cases: casesRouter,
  chat: chatRouter,
  subscriptions: subscriptionsRouter,
  presets: presetsRouter,
});

export type AppRouter = typeof appRouter;
