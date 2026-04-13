// src/server/trpc/lib/permissions.ts
import { TRPCError } from "@trpc/server";
import { and, eq, or, inArray, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { cases } from "@/server/db/schema/cases";
import { caseTasks } from "@/server/db/schema/case-tasks";
import { caseMembers } from "@/server/db/schema/case-members";
import { clients } from "@/server/db/schema/clients";

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

  // Legacy case fallback: cases created before the user joined an org have
  // org_id = NULL. Allow access if the current user is the original creator.
  const legacyOwned = and(isNull(cases.orgId), eq(cases.userId, ctx.user.id));

  // Owner/admin: any case in their org + own legacy cases
  if (ctx.user.role === "owner" || ctx.user.role === "admin") {
    const [c] = await ctx.db
      .select({ id: cases.id })
      .from(cases)
      .where(and(eq(cases.id, caseId), or(eq(cases.orgId, ctx.user.orgId), legacyOwned)))
      .limit(1);
    if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
    return c;
  }

  // Member: case_members or creator (in org or legacy)
  const [c] = await ctx.db
    .select({ id: cases.id })
    .from(cases)
    .where(
      and(
        eq(cases.id, caseId),
        or(
          and(
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
          legacyOwned,
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

  const legacyOwned = and(isNull(cases.orgId), eq(cases.userId, ctx.user.id));

  if (ctx.user.role === "owner" || ctx.user.role === "admin") {
    const [c] = await ctx.db
      .select({ id: cases.id })
      .from(cases)
      .where(and(eq(cases.id, caseId), or(eq(cases.orgId, ctx.user.orgId), legacyOwned)))
      .limit(1);
    if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
    return c;
  }

  // Member: only their own (in org or legacy)
  const [c] = await ctx.db
    .select({ id: cases.id })
    .from(cases)
    .where(
      and(eq(cases.id, caseId), eq(cases.userId, ctx.user.id), or(eq(cases.orgId, ctx.user.orgId), isNull(cases.orgId))),
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

// --- Client helpers (Phase 2.1.5) ---

type ClientRow = typeof clients.$inferSelect;

/**
 * Read access for a client.
 * - Solo client (org_id IS NULL): only the creator (clients.user_id) can read.
 * - Firm client (org_id IS NOT NULL): any user whose users.org_id matches.
 *
 * Throws NOT_FOUND on miss / out-of-scope (we don't leak existence).
 */
export async function assertClientRead(ctx: Ctx, clientId: string): Promise<ClientRow> {
  const [row] = await ctx.db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
  }

  // Solo client
  if (row.orgId === null) {
    if (row.userId !== ctx.user.id) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
    }
    return row;
  }

  // Firm client
  if (row.orgId !== ctx.user.orgId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
  }
  return row;
}

/**
 * Edit access for a client. Currently equivalent to read for firm members
 * (any member can edit). Kept as a separate function so future rule changes
 * (e.g., members may only edit their own) don't ripple through call sites.
 */
export async function assertClientEdit(ctx: Ctx, clientId: string): Promise<ClientRow> {
  return assertClientRead(ctx, clientId);
}

/**
 * Manage access (archive/restore). Firm: owner+admin only. Solo: creator only.
 */
export async function assertClientManage(ctx: Ctx, clientId: string): Promise<ClientRow> {
  const row = await assertClientRead(ctx, clientId);
  if (row.orgId !== null) {
    // Firm — must be owner or admin.
    assertOrgRole(ctx, ["owner", "admin"]);
  }
  // Solo — assertClientRead already verified creator. Pass through.
  return row;
}

/**
 * Composable WHERE clause for list queries. Returns rows the current user
 * can see:
 * - Solo user: own solo clients only.
 * - Firm member/admin/owner: all clients in their org (no solo clients).
 */
export function clientListScope(ctx: Ctx): SQL {
  if (!ctx.user.orgId) {
    // Solo user — only their own solo clients.
    return and(isNull(clients.orgId), eq(clients.userId, ctx.user.id))!;
  }
  // Firm — anything in the same org. (Solo clients are filtered out by the
  // org_id equality.)
  return eq(clients.orgId, ctx.user.orgId);
}
