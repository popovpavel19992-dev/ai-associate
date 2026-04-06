// src/server/trpc/lib/permissions.ts
import { TRPCError } from "@trpc/server";
import { and, eq, or, inArray } from "drizzle-orm";
import { cases } from "@/server/db/schema/cases";
import { caseTasks } from "@/server/db/schema/case-tasks";
import { caseMembers } from "@/server/db/schema/case-members";

type Ctx = {
  db: typeof import("@/server/db").db;
  user: { id: string; orgId: string | null; role: string | null };
};

type OrgRole = "owner" | "admin" | "member";

/**
 * Assert user has one of the required org-level roles.
 * Throws FORBIDDEN if user has no org or insufficient role.
 */
export function assertOrgRole(ctx: Ctx, allowedRoles: OrgRole[]) {
  if (!ctx.user.orgId || !ctx.user.role) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
  }
  if (!allowedRoles.includes(ctx.user.role as OrgRole)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient permissions" });
  }
}

/**
 * Assert user has access to a case.
 * - Solo user (no org): must be case creator
 * - Owner/admin: access all org cases
 * - Member: must be in case_members or be case creator
 */
export async function assertCaseAccess(ctx: Ctx, caseId: string) {
  // Solo user fallback
  if (!ctx.user.orgId) {
    const [c] = await ctx.db
      .select({ id: cases.id })
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.userId, ctx.user.id)))
      .limit(1);
    if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
    return c;
  }

  // Owner/admin: any case in their org
  if (ctx.user.role === "owner" || ctx.user.role === "admin") {
    const [c] = await ctx.db
      .select({ id: cases.id })
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.orgId, ctx.user.orgId)))
      .limit(1);
    if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
    return c;
  }

  // Member: case_members or creator
  const [c] = await ctx.db
    .select({ id: cases.id })
    .from(cases)
    .where(
      and(
        eq(cases.id, caseId),
        eq(cases.orgId, ctx.user.orgId),
        or(
          eq(cases.userId, ctx.user.id),
          inArray(
            cases.id,
            ctx.db
              .select({ caseId: caseMembers.caseId })
              .from(caseMembers)
              .where(eq(caseMembers.userId, ctx.user.id)),
          ),
        ),
      ),
    )
    .limit(1);
  if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
  return c;
}

/**
 * Assert user can delete a case.
 * - Owner/admin: any org case
 * - Member: only cases they created
 */
export async function assertCaseDelete(ctx: Ctx, caseId: string) {
  if (!ctx.user.orgId) {
    // Solo user: must be creator
    const [c] = await ctx.db
      .select({ id: cases.id })
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.userId, ctx.user.id)))
      .limit(1);
    if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
    return c;
  }

  if (ctx.user.role === "owner" || ctx.user.role === "admin") {
    const [c] = await ctx.db
      .select({ id: cases.id })
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.orgId, ctx.user.orgId)))
      .limit(1);
    if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
    return c;
  }

  // Member: only their own
  const [c] = await ctx.db
    .select({ id: cases.id })
    .from(cases)
    .where(
      and(eq(cases.id, caseId), eq(cases.orgId, ctx.user.orgId), eq(cases.userId, ctx.user.id)),
    )
    .limit(1);
  if (!c)
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the case creator can delete this case" });
  return c;
}

/**
 * Assert user has access to a task's case.
 * Resolves task → case, then delegates to assertCaseAccess.
 */
export async function assertTaskAccess(ctx: Ctx, taskId: string) {
  const [row] = await ctx.db
    .select({ task: caseTasks, caseId: cases.id })
    .from(caseTasks)
    .innerJoin(cases, eq(cases.id, caseTasks.caseId))
    .where(eq(caseTasks.id, taskId))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });

  await assertCaseAccess(ctx, row.caseId);
  return row.task;
}
