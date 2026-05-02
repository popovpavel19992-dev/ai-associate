import { createHash } from "node:crypto";
import { and, asc, desc, eq, max } from "drizzle-orm";
import { db } from "@/server/db";
import { cases } from "@/server/db/schema/cases";
import { documents } from "@/server/db/schema/documents";
import { caseWitnesses } from "@/server/db/schema/case-witnesses";
import { caseWitnessLists } from "@/server/db/schema/case-witness-lists";
import { caseWitnessStatements } from "@/server/db/schema/case-witness-statements";
import {
  caseWitnessImpeachmentScans,
  type CaseWitnessImpeachmentScan,
  type StatementSnapshot,
} from "@/server/db/schema/case-witness-impeachment-scans";
import { opposingCounselPostures } from "@/server/db/schema/opposing-counsel-postures";
import { decrementCredits, refundCredits } from "@/server/services/credits";
import { collectEvidenceSources } from "./sources";
import { extractClaims } from "./extract";
import { scanContradictions } from "./scan";
import { computeStatementsHash, contentHash } from "./compute";

const COST = 4;

export class NotBetaOrgError extends Error {
  constructor() {
    super("Org not in AI beta");
    this.name = "NotBetaOrgError";
  }
}
export class InsufficientCreditsError extends Error {
  constructor() {
    super("Insufficient credits");
    this.name = "InsufficientCreditsError";
  }
}
export class WitnessNotFoundError extends Error {
  constructor() {
    super("Witness not found");
    this.name = "WitnessNotFoundError";
  }
}
export class NoStatementsError extends Error {
  constructor() {
    super("No statements attached to witness");
    this.name = "NoStatementsError";
  }
}
export class NotExtractedError extends Error {
  filenames: string[];
  constructor(filenames: string[]) {
    super(
      `Some statement documents are not yet extracted: ${filenames.join(", ")}`,
    );
    this.name = "NotExtractedError";
    this.filenames = filenames;
  }
}
export class NoClaimsError extends Error {
  constructor() {
    super("No factual claims extracted from any statement");
    this.name = "NoClaimsError";
  }
}

function assertBetaOrg(orgId: string) {
  const allowed = (process.env.STRATEGY_BETA_ORG_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes(orgId)) throw new NotBetaOrgError();
}

function sha(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

async function caseStateHash(caseId: string, orgId: string): Promise<string> {
  const [row] = await db
    .select({ latest: max(documents.createdAt) })
    .from(documents)
    .where(eq(documents.caseId, caseId));
  const latest = row?.latest;
  const docTime =
    latest instanceof Date
      ? latest.toISOString()
      : typeof latest === "string"
        ? latest
        : "";
  return sha(`${orgId}:${caseId}:${docTime}`);
}

/** Verify witness belongs to the given case+org via witness-list FK chain. */
async function loadWitnessForCase(args: {
  orgId: string;
  caseId: string;
  witnessId: string;
}) {
  const [row] = await db
    .select({ witness: caseWitnesses, list: caseWitnessLists })
    .from(caseWitnesses)
    .innerJoin(
      caseWitnessLists,
      eq(caseWitnessLists.id, caseWitnesses.listId),
    )
    .where(
      and(
        eq(caseWitnesses.id, args.witnessId),
        eq(caseWitnessLists.caseId, args.caseId),
        eq(caseWitnessLists.orgId, args.orgId),
      ),
    );
  return row?.witness ?? null;
}

// ---------- attach / detach / list ----------

export interface AttachStatementArgs {
  orgId: string;
  userId: string;
  caseId: string;
  witnessId: string;
  documentId: string;
  statementKind: string;
  statementDate?: string | null;
  notes?: string | null;
}

export async function attachStatement(args: AttachStatementArgs) {
  const witness = await loadWitnessForCase(args);
  if (!witness) throw new WitnessNotFoundError();

  // Verify document belongs to the same case+org.
  const [doc] = await db
    .select()
    .from(documents)
    .where(
      and(eq(documents.id, args.documentId), eq(documents.caseId, args.caseId)),
    );
  if (!doc) throw new WitnessNotFoundError(); // map to NOT_FOUND in router

  const [row] = await db
    .insert(caseWitnessStatements)
    .values({
      orgId: args.orgId,
      caseId: args.caseId,
      witnessId: args.witnessId,
      documentId: args.documentId,
      statementKind: args.statementKind as never,
      statementDate: args.statementDate ?? null,
      notes: args.notes ?? null,
      attachedBy: args.userId,
    })
    .returning();
  return row;
}

export async function detachStatement(args: {
  orgId: string;
  statementId: string;
}) {
  await db
    .delete(caseWitnessStatements)
    .where(
      and(
        eq(caseWitnessStatements.id, args.statementId),
        eq(caseWitnessStatements.orgId, args.orgId),
      ),
    );
}

export async function listStatementsForWitness(args: {
  orgId: string;
  caseId: string;
  witnessId: string;
}) {
  return await db
    .select({
      id: caseWitnessStatements.id,
      documentId: caseWitnessStatements.documentId,
      statementKind: caseWitnessStatements.statementKind,
      statementDate: caseWitnessStatements.statementDate,
      notes: caseWitnessStatements.notes,
      createdAt: caseWitnessStatements.createdAt,
      filename: documents.filename,
      status: documents.status,
    })
    .from(caseWitnessStatements)
    .innerJoin(documents, eq(documents.id, caseWitnessStatements.documentId))
    .where(
      and(
        eq(caseWitnessStatements.orgId, args.orgId),
        eq(caseWitnessStatements.caseId, args.caseId),
        eq(caseWitnessStatements.witnessId, args.witnessId),
      ),
    )
    .orderBy(asc(caseWitnessStatements.createdAt));
}

// ---------- runScan ----------

export interface RunScanArgs {
  orgId: string;
  userId: string;
  caseId: string;
  witnessId: string;
  regenerateSalt?: number;
}

const CONCURRENCY = 3;

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

export async function runScanFlow(
  args: RunScanArgs,
): Promise<CaseWitnessImpeachmentScan> {
  assertBetaOrg(args.orgId);

  const witness = await loadWitnessForCase(args);
  if (!witness) throw new WitnessNotFoundError();

  // Load attached statements with their documents (org+case scoped).
  const attached = await db
    .select({
      statementId: caseWitnessStatements.id,
      documentId: caseWitnessStatements.documentId,
      statementKind: caseWitnessStatements.statementKind,
      statementDate: caseWitnessStatements.statementDate,
      filename: documents.filename,
      extractedText: documents.extractedText,
    })
    .from(caseWitnessStatements)
    .innerJoin(documents, eq(documents.id, caseWitnessStatements.documentId))
    .where(
      and(
        eq(caseWitnessStatements.orgId, args.orgId),
        eq(caseWitnessStatements.caseId, args.caseId),
        eq(caseWitnessStatements.witnessId, args.witnessId),
      ),
    )
    .orderBy(asc(caseWitnessStatements.createdAt));
  if (attached.length === 0) throw new NoStatementsError();

  const missing = attached.filter(
    (s) => !s.extractedText || s.extractedText.length === 0,
  );
  if (missing.length > 0)
    throw new NotExtractedError(missing.map((s) => s.filename ?? "Untitled"));

  const statementsForHash = attached.map((s) => ({
    statementId: s.statementId,
    text: s.extractedText!,
  }));
  const stmtsHash = computeStatementsHash(statementsForHash);
  const stateHash = await caseStateHash(args.caseId, args.orgId);
  const cacheHash = sha(
    `${args.witnessId}:${stmtsHash}:${stateHash}:${args.regenerateSalt ?? 0}`,
  );

  const [hit] = await db
    .select()
    .from(caseWitnessImpeachmentScans)
    .where(
      and(
        eq(caseWitnessImpeachmentScans.orgId, args.orgId),
        eq(caseWitnessImpeachmentScans.cacheHash, cacheHash),
      ),
    );
  if (hit) return hit;

  const ok = await decrementCredits(args.userId, COST);
  if (!ok) throw new InsufficientCreditsError();

  try {
    // Step 1: extract per-statement claims (parallel, capped concurrency)
    const claimsByStatement = await runWithConcurrency(
      attached,
      CONCURRENCY,
      async (s) => {
        const r = await extractClaims({
          statementId: s.statementId,
          statementKind: s.statementKind,
          statementText: s.extractedText!,
          witnessFullName: witness.fullName,
        });
        return { statementId: s.statementId, claims: r.claims };
      },
    );

    const totalClaims = claimsByStatement.reduce(
      (sum, c) => sum + c.claims.length,
      0,
    );
    if (totalClaims === 0) throw new NoClaimsError();

    // Step 2: collect evidence sources (Voyage RAG, exclude statement docs)
    const topicsForQuery = Array.from(
      new Set(
        claimsByStatement.flatMap((c) => c.claims.map((cl) => cl.topic)),
      ),
    )
      .slice(0, 8)
      .join(" ");
    const sources = await collectEvidenceSources({
      caseId: args.caseId,
      witnessName: witness.fullName,
      excludeDocumentIds: attached.map((s) => s.documentId),
      query: topicsForQuery || "factual claims",
    });

    // Step 3: load case summary
    const [c] = await db
      .select({ name: cases.name, description: cases.description })
      .from(cases)
      .where(and(eq(cases.id, args.caseId), eq(cases.orgId, args.orgId)));
    const caseSummary = (c?.description ?? c?.name) ?? "";

    // Step 4: load latest opposing posture (best-effort)
    const [posture] = await db
      .select()
      .from(opposingCounselPostures)
      .where(
        and(
          eq(opposingCounselPostures.orgId, args.orgId),
          eq(opposingCounselPostures.caseId, args.caseId),
        ),
      )
      .orderBy(desc(opposingCounselPostures.createdAt))
      .limit(1);

    // Step 5: scan
    const result = await scanContradictions({
      witness: {
        fullName: witness.fullName,
        titleOrRole: witness.titleOrRole,
        category: witness.category,
        partyAffiliation: witness.partyAffiliation,
      },
      caseSummary,
      statements: attached.map((s) => ({
        statementId: s.statementId,
        statementKind: s.statementKind,
        filename: s.filename ?? "Untitled",
      })),
      claims: claimsByStatement,
      sources,
      posture: posture
        ? {
            aggressiveness: posture.aggressiveness,
            reasoningMd: posture.reasoningMd,
          }
        : null,
    });

    // Step 6: persist
    const snapshot: StatementSnapshot[] = attached.map((s) => ({
      statementId: s.statementId,
      documentId: s.documentId,
      statementKind: s.statementKind,
      statementDate: s.statementDate ?? null,
      contentHash: contentHash(s.extractedText!),
    }));

    const [row] = await db
      .insert(caseWitnessImpeachmentScans)
      .values({
        orgId: args.orgId,
        caseId: args.caseId,
        witnessId: args.witnessId,
        cacheHash,
        statementsSnapshot: snapshot,
        claimsJson: claimsByStatement,
        contradictionsJson: result.contradictions,
        reasoningMd: result.reasoningMd,
        sourcesJson: result.sources,
        confidenceOverall: result.confidenceOverall,
      })
      .returning();
    return row;
  } catch (e) {
    await refundCredits(args.userId, COST);
    throw e;
  }
}

// ---------- getScan ----------

export async function getScanForWitness(args: {
  orgId: string;
  caseId: string;
  witnessId: string;
}) {
  const [row] = await db
    .select()
    .from(caseWitnessImpeachmentScans)
    .where(
      and(
        eq(caseWitnessImpeachmentScans.orgId, args.orgId),
        eq(caseWitnessImpeachmentScans.caseId, args.caseId),
        eq(caseWitnessImpeachmentScans.witnessId, args.witnessId),
      ),
    )
    .orderBy(desc(caseWitnessImpeachmentScans.createdAt))
    .limit(1);
  return row ?? null;
}
