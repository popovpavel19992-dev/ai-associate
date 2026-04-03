import { inngest } from "../client";
import { db } from "../../db";
import { users } from "../../db/schema/users";
import { organizations } from "../../db/schema/organizations";
import { sql } from "drizzle-orm";

export const creditReset = inngest.createFunction(
  {
    id: "credit-reset",
    retries: 3,
    triggers: [{ cron: "0 0 1 * *" }],
  },
  async () => {
    await db
      .update(users)
      .set({ creditsUsedThisMonth: 0 })
      .where(sql`${users.creditsUsedThisMonth} > 0`);

    await db
      .update(organizations)
      .set({ creditsUsedThisMonth: 0 })
      .where(sql`${organizations.creditsUsedThisMonth} > 0`);

    return { reset: true };
  },
);
