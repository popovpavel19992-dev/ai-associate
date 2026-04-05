// src/server/trpc/lib/case-auth.ts
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { cases } from "@/server/db/schema/cases";
import { caseTasks } from "@/server/db/schema/case-tasks";

type Ctx = {
  db: typeof import("@/server/db").db;
  user: { id: string };
};

export async function assertCaseOwnership(ctx: Ctx, caseId: string) {
  const [c] = await ctx.db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.userId, ctx.user.id)))
    .limit(1);
  if (!c)
    throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
  return c;
}

export async function assertTaskOwnership(ctx: Ctx, taskId: string) {
  const [row] = await ctx.db
    .select({ task: caseTasks, case: cases })
    .from(caseTasks)
    .innerJoin(cases, eq(cases.id, caseTasks.caseId))
    .where(and(eq(caseTasks.id, taskId), eq(cases.userId, ctx.user.id)))
    .limit(1);
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  return row.task;
}
