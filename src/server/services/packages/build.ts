import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { caseFilingPackages } from "@/server/db/schema/case-filing-packages";
import { caseFilingPackageExhibits } from "@/server/db/schema/case-filing-package-exhibits";
import { caseMotions } from "@/server/db/schema/case-motions";
import { motionTemplates } from "@/server/db/schema/motion-templates";
import { documents } from "@/server/db/schema/documents";
import { users } from "@/server/db/schema/users";
import { downloadObjectToBuffer } from "@/server/services/s3";
import { TitlePage } from "./renderers/title-page";
import { ExhibitDivider } from "./renderers/exhibit-divider";
import { ProposedOrder } from "./renderers/proposed-order";
import { CertificateOfService, type ServiceEntry } from "./renderers/certificate-of-service";
import { caseFilings } from "@/server/db/schema/case-filings";
import { caseFilingServices } from "@/server/db/schema/case-filing-services";
import { caseParties } from "@/server/db/schema/case-parties";
import { MotionPdf } from "./renderers/motion-pdf";
import { normalizeExhibitToPdf } from "./exhibits";
import { mergePdfsWithPageNumbers } from "./merge";
import type { CoverSheetData, SignerInfo } from "./types";

export class MissingSourceDocumentError extends Error {
  constructor(label: string) {
    super(`Exhibit ${label} source document is no longer available. Remove and re-add.`);
    this.name = "MissingSourceDocumentError";
  }
}

export class MissingMotionSectionsError extends Error {
  constructor(missing: string[]) {
    super(`Motion sections not drafted: ${missing.join(", ")}. Finalize the motion first.`);
    this.name = "MissingMotionSectionsError";
  }
}

type RenderElement = Parameters<typeof renderToBuffer>[0];

export async function buildPackagePdf(input: {
  packageId: string;
}): Promise<{ buffer: Buffer; pageCount: number }> {
  const pkgRows = await db
    .select()
    .from(caseFilingPackages)
    .where(eq(caseFilingPackages.id, input.packageId))
    .limit(1);
  const pkg = pkgRows[0];
  if (!pkg) throw new Error("Package not found");

  const caption = pkg.coverSheetData as CoverSheetData;

  const signerRows = await db
    .select()
    .from(users)
    .where(eq(users.id, pkg.createdBy))
    .limit(1);
  const signer: SignerInfo = {
    name: signerRows[0]?.name ?? "Attorney",
    date: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  };

  const buffers: Buffer[] = [];

  buffers.push(
    Buffer.from(
      (await renderToBuffer(
        React.createElement(TitlePage, { caption }) as RenderElement,
      )) as unknown as Uint8Array,
    ),
  );

  if (pkg.motionId) {
    const motionRows = await db
      .select()
      .from(caseMotions)
      .where(eq(caseMotions.id, pkg.motionId))
      .limit(1);
    const motion = motionRows[0];
    if (motion) {
      const tplRows = await db
        .select()
        .from(motionTemplates)
        .where(eq(motionTemplates.id, motion.templateId))
        .limit(1);
      const tpl = tplRows[0]!;

      const sections = (motion.sections ?? {}) as Record<
        string,
        { text?: string } | undefined
      >;
      const missing = (["facts", "argument", "conclusion"] as const).filter(
        (k) => !sections[k]?.text?.trim(),
      );
      if (missing.length > 0) throw new MissingMotionSectionsError(missing);

      buffers.push(
        Buffer.from(
          (await renderToBuffer(
            React.createElement(MotionPdf, {
              caption,
              skeleton: tpl.skeleton as never,
              sections: motion.sections as never,
              signer,
            }) as RenderElement,
          )) as unknown as Uint8Array,
        ),
      );
    }
  }

  const exhibitRows = await db
    .select()
    .from(caseFilingPackageExhibits)
    .where(eq(caseFilingPackageExhibits.packageId, pkg.id))
    .orderBy(asc(caseFilingPackageExhibits.displayOrder));

  const docIds = exhibitRows
    .map((e) => e.documentId)
    .filter((id): id is string => id !== null);
  const docRows = docIds.length
    ? await db
        .select({ id: documents.id, s3Key: documents.s3Key })
        .from(documents)
        .where(inArray(documents.id, docIds))
    : [];
  const s3KeyByDocId = new Map(docRows.map((d) => [d.id, d.s3Key]));

  for (const ex of exhibitRows) {
    buffers.push(
      Buffer.from(
        (await renderToBuffer(
          React.createElement(ExhibitDivider, {
            label: ex.label,
            filename: ex.originalFilename,
          }) as RenderElement,
        )) as unknown as Uint8Array,
      ),
    );
    const s3Key =
      ex.sourceType === "case_document" && ex.documentId
        ? s3KeyByDocId.get(ex.documentId)
        : ex.adHocS3Key ?? undefined;
    if (!s3Key) throw new MissingSourceDocumentError(ex.label);

    const contentBuf = await normalizeExhibitToPdf({
      mimeType: ex.mimeType,
      originalFilename: ex.originalFilename,
      getContent: () => downloadObjectToBuffer(s3Key),
    });
    buffers.push(contentBuf);
  }

  const proposedBody = pkg.proposedOrderText?.trim()
    ? pkg.proposedOrderText
    : "Upon consideration of the Motion and the papers submitted therewith, IT IS HEREBY ORDERED that the Motion is GRANTED.";
  buffers.push(
    Buffer.from(
      (await renderToBuffer(
        React.createElement(ProposedOrder, {
          caption,
          body: proposedBody,
        }) as RenderElement,
      )) as unknown as Uint8Array,
    ),
  );

  // Load services on this package's motion's filings (if any) for filled CoS
  let serviceEntries: ServiceEntry[] = [];
  if (pkg.motionId) {
    const filings = await db
      .select({ id: caseFilings.id })
      .from(caseFilings)
      .where(eq(caseFilings.motionId, pkg.motionId));
    if (filings.length > 0) {
      const filingIds = filings.map((f) => f.id);
      const rows = await db
        .select({
          partyName: caseParties.name,
          partyRole: caseParties.role,
          method: caseFilingServices.method,
          servedAt: caseFilingServices.servedAt,
          servedEmail: caseFilingServices.servedEmail,
          servedAddress: caseFilingServices.servedAddress,
          trackingReference: caseFilingServices.trackingReference,
        })
        .from(caseFilingServices)
        .innerJoin(caseParties, eq(caseParties.id, caseFilingServices.partyId))
        .where(inArray(caseFilingServices.filingId, filingIds));
      serviceEntries = rows.map((r) => ({
        partyName: r.partyName,
        partyRole: r.partyRole,
        method: r.method,
        servedAt: r.servedAt instanceof Date ? r.servedAt.toISOString() : r.servedAt,
        servedEmail: r.servedEmail,
        servedAddress: r.servedAddress,
        trackingReference: r.trackingReference,
      }));
    }
  }

  buffers.push(
    Buffer.from(
      (await renderToBuffer(
        React.createElement(CertificateOfService, {
          caption,
          signer,
          services: serviceEntries,
        }) as RenderElement,
      )) as unknown as Uint8Array,
    ),
  );

  return await mergePdfsWithPageNumbers(buffers);
}
