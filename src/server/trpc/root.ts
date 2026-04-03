import { router } from "./trpc";
import { usersRouter } from "./routers/users";
import { documentsRouter } from "./routers/documents";

export const appRouter = router({
  users: usersRouter,
  documents: documentsRouter,
});

export type AppRouter = typeof appRouter;
