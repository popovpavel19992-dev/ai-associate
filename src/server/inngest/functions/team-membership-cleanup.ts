import { inngest } from "../client";
import { db } from "../../db";
import { caseMembers } from "../../db/schema/case-members";
import { cases } from "../../db/schema/cases";
import { eq, and, inArray } from "drizzle-orm";

export const teamMembershipCleanup = inngest.createFunction(
  {
    id: "team-membership-cleanup",
    retries: 3,
    triggers: [{ event: "team/membership.cleanup" }],
  },
  async ({ event, step }) => {
    const { userId, orgId } = event.data as { userId: string; orgId: string };

    const deleted = await step.run("delete-case-members", async () => {
      const orgCaseIds = db
        .select({ id: cases.id })
        .from(cases)
        .where(eq(cases.orgId, orgId));

      const result = await db
        .delete(caseMembers)
        .where(
          and(
            eq(caseMembers.userId, userId),
            inArray(caseMembers.caseId, orgCaseIds),
          ),
        )
        .returning({ id: caseMembers.id });

      return result.length;
    });

    return { cleaned: true, deletedCount: deleted };
  },
);
