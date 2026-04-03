import { router } from "./trpc";
import { usersRouter } from "./routers/users";
import { documentsRouter } from "./routers/documents";
import { casesRouter } from "./routers/cases";
import { chatRouter } from "./routers/chat";

export const appRouter = router({
  users: usersRouter,
  documents: documentsRouter,
  cases: casesRouter,
  chat: chatRouter,
});

export type AppRouter = typeof appRouter;
