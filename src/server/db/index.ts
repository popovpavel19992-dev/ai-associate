import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as organizations from "./schema/organizations";
import * as users from "./schema/users";
import * as cases from "./schema/cases";
import * as documents from "./schema/documents";
import * as documentAnalyses from "./schema/document-analyses";
import * as chatMessages from "./schema/chat-messages";
import * as subscriptions from "./schema/subscriptions";
import * as sectionPresets from "./schema/section-presets";
import * as contracts from "./schema/contracts";
import * as contractComparisons from "./schema/contract-comparisons";
import * as contractDrafts from "./schema/contract-drafts";
import * as caseStages from "./schema/case-stages";

const client = postgres(process.env.DATABASE_URL!);

export const db = drizzle(client, {
  schema: {
    ...organizations,
    ...users,
    ...cases,
    ...documents,
    ...documentAnalyses,
    ...chatMessages,
    ...subscriptions,
    ...sectionPresets,
    ...contracts,
    ...contractComparisons,
    ...contractDrafts,
    ...caseStages,
  },
});
