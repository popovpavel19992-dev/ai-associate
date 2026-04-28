// src/server/trpc/routers/client-comms.ts
//
// Phase 3.10 — Client Communication Center router.
// Pure read-only aggregation across all per-case comm sources for one client.

import { z } from "zod/v4";
import { router, protectedProcedure } from "../trpc";
import { assertClientRead } from "../lib/permissions";
import {
  aggregateForClient,
  type CommEventKind,
} from "@/server/services/client-comms/aggregator";

const KIND_VALUES = [
  "email_outbound",
  "email_reply",
  "email_auto_reply",
  "signature_request",
  "signature_completed",
  "drip_enrolled",
  "drip_cancelled",
  "demand_letter_sent",
  "demand_letter_response",
  "case_message",
  "document_request",
  "document_response",
  "intake_submitted",
  "mediation_scheduled",
  "mediation_completed",
  "settlement_offer",
] as const satisfies readonly CommEventKind[];

const kindEnum = z.enum(KIND_VALUES);
const directionEnum = z.enum(["inbound", "outbound", "internal"]);

export const clientCommsRouter = router({
  getTimeline: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        kinds: z.array(kindEnum).optional(),
        caseId: z.string().uuid().optional(),
        direction: directionEnum.optional(),
        limit: z.number().int().min(1).max(500).default(100),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Authorize client visibility before doing any aggregation.
      await assertClientRead(ctx, input.clientId);
      return aggregateForClient(ctx.db, ctx.user.orgId, ctx.user.id, input.clientId, {
        startDate: input.startDate,
        endDate: input.endDate,
        kinds: input.kinds,
        caseId: input.caseId,
        direction: input.direction,
        limit: input.limit,
        offset: input.offset,
      });
    }),

  getCounts: protectedProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertClientRead(ctx, input.clientId);
      const res = await aggregateForClient(
        ctx.db,
        ctx.user.orgId,
        ctx.user.id,
        input.clientId,
        { limit: 1 },
      );
      return res.counts;
    }),
});
