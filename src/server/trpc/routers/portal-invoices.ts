import { z } from "zod/v4";
import { and, eq, desc, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, portalProcedure } from "../trpc";
import { invoices } from "@/server/db/schema/invoices";
import { invoiceLineItems } from "@/server/db/schema/invoice-line-items";
import { cases } from "@/server/db/schema/cases";
import { getStripe } from "@/server/services/stripe";

export const portalInvoicesRouter = router({
  list: portalProcedure
    .input(z.object({
      caseId: z.string().uuid().optional(),
      cursor: z.string().uuid().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const conditions = [eq(invoices.clientId, ctx.portalUser.clientId)];

      if (input?.caseId) {
        const [caseRow] = await ctx.db
          .select({ id: cases.id, portalVisibility: cases.portalVisibility })
          .from(cases)
          .where(and(eq(cases.id, input.caseId), eq(cases.clientId, ctx.portalUser.clientId)))
          .limit(1);
        if (!caseRow) throw new TRPCError({ code: "NOT_FOUND" });
        const vis = caseRow.portalVisibility as Record<string, boolean> | null;
        if (!vis || vis.billing === false) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const lineItemInvoiceIds = ctx.db
          .selectDistinct({ invoiceId: invoiceLineItems.invoiceId })
          .from(invoiceLineItems)
          .where(eq(invoiceLineItems.caseId, input.caseId));

        conditions.push(inArray(invoices.id, lineItemInvoiceIds));
      }

      const rows = await ctx.db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          status: invoices.status,
          issuedDate: invoices.issuedDate,
          dueDate: invoices.dueDate,
          paidDate: invoices.paidDate,
          totalCents: invoices.totalCents,
        })
        .from(invoices)
        .where(and(...conditions))
        .orderBy(desc(invoices.issuedDate))
        .limit(21);

      return {
        invoices: rows.slice(0, 20),
        nextCursor: rows.length > 20 ? rows[19]!.id : undefined,
      };
    }),

  get: portalProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [invoice] = await ctx.db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, input.invoiceId), eq(invoices.clientId, ctx.portalUser.clientId)))
        .limit(1);
      if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });

      const lines = await ctx.db
        .select()
        .from(invoiceLineItems)
        .where(eq(invoiceLineItems.invoiceId, invoice.id))
        .orderBy(invoiceLineItems.sortOrder);

      return { ...invoice, lineItems: lines };
    }),

  createCheckoutSession: portalProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [invoice] = await ctx.db
        .select()
        .from(invoices)
        .where(and(
          eq(invoices.id, input.invoiceId),
          eq(invoices.clientId, ctx.portalUser.clientId),
          eq(invoices.status, "sent"),
        ))
        .limit(1);

      if (!invoice) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found or already paid" });

      // If a previous checkout session exists, check if it's still active
      if (invoice.stripeCheckoutSessionId) {
        const stripe = getStripe();
        const existingSession = await stripe.checkout.sessions.retrieve(invoice.stripeCheckoutSessionId);
        if (existingSession.status === "open") {
          return { url: existingSession.url };
        }
        // Session expired/completed — allow creating a new one
      }

      const stripe = getStripe();
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd",
            unit_amount: invoice.totalCents,
            product_data: {
              name: `Invoice ${invoice.invoiceNumber}`,
            },
          },
          quantity: 1,
        }],
        metadata: {
          invoiceId: invoice.id,
          orgId: invoice.orgId ?? "",
          portalUserId: ctx.portalUser.id,
        },
        success_url: `${appUrl}/portal/invoices/${invoice.id}?paid=true`,
        cancel_url: `${appUrl}/portal/invoices/${invoice.id}`,
      });

      await ctx.db
        .update(invoices)
        .set({ stripeCheckoutSessionId: session.id })
        .where(eq(invoices.id, invoice.id));

      return { url: session.url };
    }),
});
