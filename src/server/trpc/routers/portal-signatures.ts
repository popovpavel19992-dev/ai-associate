import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq, and, inArray } from "drizzle-orm";
import { router, portalProcedure } from "../trpc";
import { caseSignatureRequests } from "@/server/db/schema/case-signature-requests";
import { caseSignatureRequestSigners } from "@/server/db/schema/case-signature-request-signers";
import { clientContacts } from "@/server/db/schema/client-contacts";
import { DropboxSignClient } from "@/server/services/esignature/dropbox-sign-client";
import { decrypt } from "@/server/lib/crypto";
import { organizations } from "@/server/db/schema/organizations";
import { cases } from "@/server/db/schema/cases";

export const portalSignaturesRouter = router({
  list: portalProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [caseRow] = await ctx.db
        .select({ id: cases.id, clientId: cases.clientId })
        .from(cases)
        .where(eq(cases.id, input.caseId))
        .limit(1);
      if (!caseRow || caseRow.clientId !== ctx.portalUser.clientId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No access" });
      }

      const requests = await ctx.db
        .select()
        .from(caseSignatureRequests)
        .where(eq(caseSignatureRequests.caseId, input.caseId));

      const clientContactRows = await ctx.db
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(eq(clientContacts.clientId, caseRow.clientId));
      const contactIds = clientContactRows.map((c) => c.id);
      if (contactIds.length === 0) return { requests: [] };

      const reqIds = requests.map((r) => r.id);
      if (reqIds.length === 0) return { requests: [] };

      const signers = await ctx.db
        .select()
        .from(caseSignatureRequestSigners)
        .where(
          and(
            inArray(caseSignatureRequestSigners.requestId, reqIds),
            inArray(caseSignatureRequestSigners.clientContactId, contactIds),
          ),
        );
      const reqIdsWithClient = new Set(signers.map((s) => s.requestId));
      const filtered = requests.filter((r) => reqIdsWithClient.has(r.id));
      const signerByReqId = new Map<string, typeof signers[number]>();
      for (const s of signers) {
        if (!signerByReqId.has(s.requestId)) signerByReqId.set(s.requestId, s);
      }

      return {
        requests: filtered.map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          createdAt: r.createdAt,
          clientSigner: signerByReqId.get(r.id) ?? null,
        })),
      };
    }),

  getSignUrl: portalProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [req] = await ctx.db
        .select({
          id: caseSignatureRequests.id,
          hellosignRequestId: caseSignatureRequests.hellosignRequestId,
          caseId: caseSignatureRequests.caseId,
        })
        .from(caseSignatureRequests)
        .where(eq(caseSignatureRequests.id, input.requestId))
        .limit(1);
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });

      const [caseRow] = await ctx.db
        .select({ clientId: cases.clientId, orgId: cases.orgId })
        .from(cases)
        .where(eq(cases.id, req.caseId))
        .limit(1);
      if (!caseRow || caseRow.clientId !== ctx.portalUser.clientId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No access" });
      }
      if (!caseRow.orgId) throw new TRPCError({ code: "BAD_REQUEST", message: "Org missing" });

      const [org] = await ctx.db
        .select({ key: organizations.hellosignApiKeyEncrypted })
        .from(organizations)
        .where(eq(organizations.id, caseRow.orgId))
        .limit(1);
      if (!org?.key) throw new TRPCError({ code: "BAD_REQUEST", message: "Not configured" });

      const client = new DropboxSignClient({ apiKey: decrypt(org.key) });
      const result = await client.getSignatureRequest(req.hellosignRequestId!);

      const [signer] = await ctx.db
        .select({ email: caseSignatureRequestSigners.email })
        .from(caseSignatureRequestSigners)
        .where(
          and(
            eq(caseSignatureRequestSigners.requestId, req.id),
            eq(caseSignatureRequestSigners.signerRole, "client"),
          ),
        )
        .limit(1);
      const url = signer ? result.signUrls[signer.email] : undefined;
      if (!url) throw new TRPCError({ code: "BAD_REQUEST", message: "No signing URL available" });
      return { url };
    }),
});
