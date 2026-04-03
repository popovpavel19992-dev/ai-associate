import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as organizations from "./schema/organizations";
import * as users from "./schema/users";
import * as cases from "./schema/cases";
import * as documents from "./schema/documents";
import * as documentAnalyses from "./schema/document-analyses";

const client = postgres(process.env.DATABASE_URL!);

export const db = drizzle(client, {
  schema: {
    ...organizations,
    ...users,
    ...cases,
    ...documents,
    ...documentAnalyses,
  },
});
