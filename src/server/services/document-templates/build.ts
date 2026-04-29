// src/server/services/document-templates/build.ts
//
// Phase 3.12 — assemble the inputs for DocumentPdf for a given generated
// document and render to a PDF buffer.

import * as React from "react";
import { eq } from "drizzle-orm";
import { renderToBuffer } from "@react-pdf/renderer";
import { db as defaultDb } from "@/server/db";
import { caseGeneratedDocuments } from "@/server/db/schema/case-generated-documents";
import { organizations } from "@/server/db/schema/organizations";
import { users } from "@/server/db/schema/users";
import { clients } from "@/server/db/schema/clients";
import { cases } from "@/server/db/schema/cases";
import { DocumentPdf } from "./renderers/document-pdf";
import { formatDateLong } from "./merge-renderer";

type DB = typeof defaultDb;

export async function buildDocumentPdf(input: { docId: string; orgId: string }, deps: { db?: DB } = {}): Promise<Buffer> {
  const db = deps.db ?? defaultDb;
  const [doc] = await db
    .select()
    .from(caseGeneratedDocuments)
    .where(eq(caseGeneratedDocuments.id, input.docId))
    .limit(1);
  if (!doc) throw new Error("Document not found");
  if (doc.orgId !== input.orgId) throw new Error("Document not in this org");

  const [org] = await db
    .select({ name: organizations.name, ownerUserId: organizations.ownerUserId })
    .from(organizations)
    .where(eq(organizations.id, doc.orgId))
    .limit(1);

  // Prefer the doc's creator as the signer; fall back to org owner.
  const [creator] = await db
    .select({ name: users.name, barNumber: users.barNumber })
    .from(users)
    .where(eq(users.id, doc.createdBy))
    .limit(1);

  let attorneyName = creator?.name ?? null;
  let barNumber = creator?.barNumber ?? null;
  if (!attorneyName && org?.ownerUserId) {
    const [owner] = await db
      .select({ name: users.name, barNumber: users.barNumber })
      .from(users)
      .where(eq(users.id, org.ownerUserId))
      .limit(1);
    attorneyName = owner?.name ?? null;
    barNumber = owner?.barNumber ?? null;
  }

  let clientName: string | null = null;
  let resolvedClientId = doc.clientId;
  if (!resolvedClientId && doc.caseId) {
    const [c] = await db
      .select({ clientId: cases.clientId })
      .from(cases)
      .where(eq(cases.id, doc.caseId))
      .limit(1);
    resolvedClientId = c?.clientId ?? null;
  }
  if (resolvedClientId) {
    const [cl] = await db
      .select({ displayName: clients.displayName })
      .from(clients)
      .where(eq(clients.id, resolvedClientId))
      .limit(1);
    clientName = cl?.displayName ?? null;
  }

  const referenceDate = doc.finalizedAt ?? doc.createdAt;
  const isoDate = referenceDate.toISOString().slice(0, 10);

  const buf = (await renderToBuffer(
    React.createElement(DocumentPdf, {
      input: {
        title: doc.title,
        body: doc.body,
        category: doc.category,
        firm: {
          name: org?.name ?? "Firm",
          address: null,
          attorneyName: attorneyName ?? "Attorney",
          barNumber,
        },
        client: { name: clientName },
        date: formatDateLong(isoDate),
      },
    }) as Parameters<typeof renderToBuffer>[0],
  )) as unknown as Uint8Array;
  return Buffer.from(buf);
}
