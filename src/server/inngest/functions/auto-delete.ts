import { inngest } from "../client";
import { db } from "../../db";
import { cases } from "../../db/schema/cases";
import { documents } from "../../db/schema/documents";
import { eq, lte, and, gte } from "drizzle-orm";
import { deleteObject } from "../../services/s3";

export const autoDelete = inngest.createFunction(
  {
    id: "auto-delete",
    triggers: [{ cron: "0 1 * * *" }],
  },
  async () => {
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    // Cases expiring in 3 days (for future warning emails)
    const _warningCases = await db
      .select({ id: cases.id, name: cases.name, userId: cases.userId })
      .from(cases)
      .where(and(lte(cases.deleteAt, threeDaysFromNow), gte(cases.deleteAt, now)));

    // Delete expired cases
    const expiredCases = await db
      .select({ id: cases.id })
      .from(cases)
      .where(lte(cases.deleteAt, now));

    let deletedCount = 0;

    for (const expiredCase of expiredCases) {
      const docs = await db
        .select({ s3Key: documents.s3Key })
        .from(documents)
        .where(eq(documents.caseId, expiredCase.id));

      for (const doc of docs) {
        await deleteObject(doc.s3Key).catch(() => {});
      }

      await db.delete(cases).where(eq(cases.id, expiredCase.id));
      deletedCount++;
    }

    return { deletedCount, warningsSent: _warningCases.length };
  },
);
