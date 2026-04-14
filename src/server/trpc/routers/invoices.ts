// src/server/trpc/routers/invoices.ts
import { z } from "zod/v4";
import { and, eq, desc, sql, isNull, lt } from "drizzle-orm";
import { addDays } from "date-fns";
import { router, protectedProcedure } from "../trpc";
import { invoices } from "@/server/db/schema/invoices";
import { invoiceLineItems } from "@/server/db/schema/invoice-line-items";
import { timeEntries } from "@/server/db/schema/time-entries";
import { expenses } from "@/server/db/schema/expenses";
import { cases } from "@/server/db/schema/cases";
import { clients } from "@/server/db/schema/clients";
import { users } from "@/server/db/schema/users";
import { assertInvoiceAccess, assertInvoiceManage } from "../lib/permissions";
import { inngest } from "@/server/inngest/client";
import {
  computeAmountCents,
  formatInvoiceNumber,
  INVOICE_STATUSES,
  PAYMENT_TERMS,
} from "@/lib/billing";

export const invoicesRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(INVOICE_STATUSES).optional(),
        clientId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = ctx.user.orgId
        ? [eq(invoices.orgId, ctx.user.orgId)]
        : [eq(invoices.userId, ctx.user.id), isNull(invoices.orgId)];

      if (input.status) conditions.push(eq(invoices.status, input.status));
      if (input.clientId) conditions.push(eq(invoices.clientId, input.clientId));

      const rows = await ctx.db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          status: invoices.status,
          issuedDate: invoices.issuedDate,
          dueDate: invoices.dueDate,
          paidDate: invoices.paidDate,
          subtotalCents: invoices.subtotalCents,
          taxCents: invoices.taxCents,
          totalCents: invoices.totalCents,
          notes: invoices.notes,
          paymentTerms: invoices.paymentTerms,
          clientId: invoices.clientId,
          createdAt: invoices.createdAt,
          updatedAt: invoices.updatedAt,
          clientDisplayName: clients.displayName,
        })
        .from(invoices)
        .innerJoin(clients, eq(clients.id, invoices.clientId))
        .where(and(...conditions))
        .orderBy(desc(invoices.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return { invoices: rows };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const invoice = await assertInvoiceAccess(ctx, input.id);

      const lineItemRows = await ctx.db
        .select({
          id: invoiceLineItems.id,
          invoiceId: invoiceLineItems.invoiceId,
          caseId: invoiceLineItems.caseId,
          timeEntryId: invoiceLineItems.timeEntryId,
          expenseId: invoiceLineItems.expenseId,
          type: invoiceLineItems.type,
          description: invoiceLineItems.description,
          quantity: invoiceLineItems.quantity,
          unitPriceCents: invoiceLineItems.unitPriceCents,
          amountCents: invoiceLineItems.amountCents,
          sortOrder: invoiceLineItems.sortOrder,
          createdAt: invoiceLineItems.createdAt,
          caseName: cases.name,
        })
        .from(invoiceLineItems)
        .innerJoin(cases, eq(cases.id, invoiceLineItems.caseId))
        .where(eq(invoiceLineItems.invoiceId, input.id))
        .orderBy(invoiceLineItems.sortOrder, invoiceLineItems.createdAt);

      const [client] = await ctx.db
        .select()
        .from(clients)
        .where(eq(clients.id, invoice.clientId))
        .limit(1);

      return { invoice, lineItems: lineItemRows, client: client ?? null };
    }),

  create: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        lineItems: z
          .array(
            z.object({
              type: z.enum(["time", "expense"]),
              sourceId: z.string().uuid(),
              caseId: z.string().uuid(),
            }),
          )
          .min(1),
        paymentTerms: z.enum(PAYMENT_TERMS).optional(),
        taxCents: z.number().int().min(0).default(0),
        notes: z.string().max(5000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scopeId = ctx.user.orgId ?? ctx.user.id;

      const result = await ctx.db.transaction(async (tx) => {
        // Upsert invoice counter and get the next number
        const counterResult = await tx.execute<{ last_number: number }>(
          sql`INSERT INTO invoice_counters (scope_id, last_number) VALUES (${scopeId}, 1)
              ON CONFLICT (scope_id) DO UPDATE SET last_number = invoice_counters.last_number + 1
              RETURNING last_number`,
        );
        const lastNumber = (counterResult as unknown as Array<{ last_number: number }>)[0]
          ?.last_number as number;
        const invoiceNumber = formatInvoiceNumber(lastNumber);

        // Resolve each line item's source data
        const resolvedItems: Array<{
          type: string;
          sourceId: string;
          caseId: string;
          description: string;
          quantity: string;
          unitPriceCents: number;
          amountCents: number;
          timeEntryId: string | null;
          expenseId: string | null;
        }> = [];

        for (const item of input.lineItems) {
          if (item.type === "time") {
            const [entry] = await tx
              .select()
              .from(timeEntries)
              .where(eq(timeEntries.id, item.sourceId))
              .limit(1);
            if (!entry) throw new Error(`Time entry not found: ${item.sourceId}`);
            const hours = (entry.durationMinutes / 60).toFixed(2);
            resolvedItems.push({
              type: "time",
              sourceId: item.sourceId,
              caseId: item.caseId,
              description: entry.description,
              quantity: hours,
              unitPriceCents: entry.rateCents,
              amountCents: entry.amountCents,
              timeEntryId: entry.id,
              expenseId: null,
            });
          } else {
            const [expense] = await tx
              .select()
              .from(expenses)
              .where(eq(expenses.id, item.sourceId))
              .limit(1);
            if (!expense) throw new Error(`Expense not found: ${item.sourceId}`);
            resolvedItems.push({
              type: "expense",
              sourceId: item.sourceId,
              caseId: item.caseId,
              description: expense.description,
              quantity: "1.00",
              unitPriceCents: expense.amountCents,
              amountCents: expense.amountCents,
              timeEntryId: null,
              expenseId: expense.id,
            });
          }
        }

        const subtotalCents = resolvedItems.reduce((sum, item) => sum + item.amountCents, 0);
        const totalCents = subtotalCents + input.taxCents;

        const [invoice] = await tx
          .insert(invoices)
          .values({
            orgId: ctx.user.orgId,
            userId: ctx.user.id,
            clientId: input.clientId,
            invoiceNumber,
            status: "draft",
            subtotalCents,
            taxCents: input.taxCents,
            totalCents,
            notes: input.notes ?? null,
            paymentTerms: input.paymentTerms ?? null,
          })
          .returning();

        await tx.insert(invoiceLineItems).values(
          resolvedItems.map((item, index) => ({
            invoiceId: invoice!.id,
            caseId: item.caseId,
            timeEntryId: item.timeEntryId,
            expenseId: item.expenseId,
            type: item.type,
            description: item.description,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            amountCents: item.amountCents,
            sortOrder: index,
          })),
        );

        return invoice!;
      });

      return { invoice: result };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        notes: z.string().max(5000).optional(),
        paymentTerms: z.enum(PAYMENT_TERMS).optional(),
        taxCents: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const invoice = await assertInvoiceManage(ctx, input.id);

      if (invoice.status !== "draft") {
        throw new Error("Can only update draft invoices");
      }

      const { id, ...patch } = input;
      const updates: Record<string, unknown> = { ...patch, updatedAt: new Date() };

      if (patch.taxCents !== undefined) {
        updates.totalCents = invoice.subtotalCents + patch.taxCents;
      }

      const [updated] = await ctx.db
        .update(invoices)
        .set(updates)
        .where(eq(invoices.id, id))
        .returning();

      return { invoice: updated };
    }),

  send: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const invoice = await assertInvoiceManage(ctx, input.id);

      if (invoice.status !== "draft") {
        throw new Error("Can only send draft invoices");
      }

      const today = new Date();
      let dueDate: Date = today;

      if (invoice.paymentTerms) {
        const terms = invoice.paymentTerms;
        if (terms === "Due on receipt") {
          dueDate = today;
        } else if (terms === "Net 15") {
          dueDate = addDays(today, 15);
        } else if (terms === "Net 30") {
          dueDate = addDays(today, 30);
        } else if (terms === "Net 45") {
          dueDate = addDays(today, 45);
        } else if (terms === "Net 60") {
          dueDate = addDays(today, 60);
        }
      }

      const [updated] = await ctx.db
        .update(invoices)
        .set({ status: "sent", issuedDate: today, dueDate, updatedAt: new Date() })
        .where(eq(invoices.id, input.id))
        .returning();

      // Notify org owner/admins (not actor)
      if (ctx.user.orgId) {
        const orgMembers = await ctx.db
          .select({ id: users.id, role: users.role })
          .from(users)
          .where(eq(users.orgId, ctx.user.orgId));
        const [clientRecord] = await ctx.db
          .select({ displayName: clients.displayName })
          .from(clients)
          .where(eq(clients.id, invoice.clientId))
          .limit(1);
        const amountStr = `$${(invoice.totalCents / 100).toFixed(2)}`;
        for (const member of orgMembers) {
          if (member.id === ctx.user.id) continue;
          if (member.role !== "owner" && member.role !== "admin") continue;
          await inngest.send({
            name: "notification/send",
            data: {
              userId: member.id,
              orgId: ctx.user.orgId,
              type: "invoice_sent",
              title: `Invoice ${invoice.invoiceNumber} sent`,
              body: `Invoice ${invoice.invoiceNumber} for ${clientRecord?.displayName ?? "client"} — ${amountStr}`,
              actionUrl: `/invoices/${invoice.id}`,
              metadata: {
                invoiceNumber: invoice.invoiceNumber,
                clientName: clientRecord?.displayName ?? "",
                amount: amountStr,
              },
            },
          });
        }
      }

      return { invoice: updated };
    }),

  markPaid: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const invoice = await assertInvoiceManage(ctx, input.id);

      if (invoice.status !== "sent") {
        throw new Error("Can only mark sent invoices as paid");
      }

      const [updated] = await ctx.db
        .update(invoices)
        .set({ status: "paid", paidDate: new Date(), updatedAt: new Date() })
        .where(eq(invoices.id, input.id))
        .returning();

      // Notify org owner/admins (not actor)
      if (ctx.user.orgId) {
        const orgMembers = await ctx.db
          .select({ id: users.id, role: users.role })
          .from(users)
          .where(eq(users.orgId, ctx.user.orgId));
        const [clientRecord] = await ctx.db
          .select({ displayName: clients.displayName })
          .from(clients)
          .where(eq(clients.id, invoice.clientId))
          .limit(1);
        const amountStr = `$${(invoice.totalCents / 100).toFixed(2)}`;
        for (const member of orgMembers) {
          if (member.id === ctx.user.id) continue;
          if (member.role !== "owner" && member.role !== "admin") continue;
          await inngest.send({
            name: "notification/send",
            data: {
              userId: member.id,
              orgId: ctx.user.orgId,
              type: "invoice_paid",
              title: `Invoice ${invoice.invoiceNumber} paid`,
              body: `Invoice ${invoice.invoiceNumber} for ${clientRecord?.displayName ?? "client"} — ${amountStr}`,
              actionUrl: `/invoices/${invoice.id}`,
              metadata: {
                invoiceNumber: invoice.invoiceNumber,
                clientName: clientRecord?.displayName ?? "",
                amount: amountStr,
              },
            },
          });
        }
      }

      return { invoice: updated };
    }),

  void: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const invoice = await assertInvoiceManage(ctx, input.id);

      if (invoice.status !== "draft" && invoice.status !== "sent") {
        throw new Error("Can only void draft or sent invoices");
      }

      const [updated] = await ctx.db
        .update(invoices)
        .set({ status: "void", updatedAt: new Date() })
        .where(eq(invoices.id, input.id))
        .returning();

      return { invoice: updated };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const invoice = await assertInvoiceManage(ctx, input.id);

      if (invoice.status !== "draft") {
        throw new Error("Can only delete draft invoices");
      }

      await ctx.db.delete(invoices).where(eq(invoices.id, input.id));

      return { success: true };
    }),

  getSummary: protectedProcedure.query(async ({ ctx }) => {
    const scopeCondition = ctx.user.orgId
      ? eq(invoices.orgId, ctx.user.orgId)
      : and(eq(invoices.userId, ctx.user.id), isNull(invoices.orgId))!;

    const rows = await ctx.db
      .select({
        status: invoices.status,
        count: sql<number>`count(*)::int`,
        totalCents: sql<number>`coalesce(sum(total_cents), 0)::int`,
      })
      .from(invoices)
      .where(scopeCondition)
      .groupBy(invoices.status);

    // Overdue: sent invoices with due_date < today
    const overdueRows = await ctx.db
      .select({
        count: sql<number>`count(*)::int`,
        totalCents: sql<number>`coalesce(sum(total_cents), 0)::int`,
      })
      .from(invoices)
      .where(
        and(
          scopeCondition,
          eq(invoices.status, "sent"),
          lt(invoices.dueDate, new Date()),
        ),
      );

    const summary = {
      draft: { count: 0, totalCents: 0 },
      sent: { count: 0, totalCents: 0 },
      overdue: { count: 0, totalCents: 0 },
      paid: { count: 0, totalCents: 0 },
    };

    for (const row of rows) {
      if (row.status === "draft") {
        summary.draft = { count: Number(row.count), totalCents: Number(row.totalCents) };
      } else if (row.status === "sent") {
        summary.sent = { count: Number(row.count), totalCents: Number(row.totalCents) };
      } else if (row.status === "paid") {
        summary.paid = { count: Number(row.count), totalCents: Number(row.totalCents) };
      }
    }

    if (overdueRows[0]) {
      summary.overdue = {
        count: Number(overdueRows[0].count),
        totalCents: Number(overdueRows[0].totalCents),
      };
    }

    return { summary };
  }),

  generatePdf: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const invoice = await assertInvoiceAccess(ctx, input.id);

      const lineItemRows = await ctx.db
        .select({
          id: invoiceLineItems.id,
          caseId: invoiceLineItems.caseId,
          type: invoiceLineItems.type,
          description: invoiceLineItems.description,
          quantity: invoiceLineItems.quantity,
          unitPriceCents: invoiceLineItems.unitPriceCents,
          amountCents: invoiceLineItems.amountCents,
          sortOrder: invoiceLineItems.sortOrder,
          caseName: cases.name,
        })
        .from(invoiceLineItems)
        .innerJoin(cases, eq(cases.id, invoiceLineItems.caseId))
        .where(eq(invoiceLineItems.invoiceId, input.id))
        .orderBy(invoiceLineItems.sortOrder);

      const [client] = await ctx.db
        .select()
        .from(clients)
        .where(eq(clients.id, invoice.clientId))
        .limit(1);

      if (!client) throw new Error("Client not found");

      // Load firm info from org or user context
      let firmName = "Law Firm";
      if (ctx.user.orgId) {
        const { organizations } = await import("@/server/db/schema/organizations");
        const [org] = await ctx.db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, ctx.user.orgId))
          .limit(1);
        if (org) firmName = org.name;
      } else {
        const { users } = await import("@/server/db/schema/users");
        const [user] = await ctx.db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, ctx.user.id))
          .limit(1);
        if (user?.name) firmName = user.name;
      }

      const { renderToBuffer } = await import("@react-pdf/renderer");
      const { InvoicePdf } = await import("@/lib/invoice-pdf");

      const issuedDateStr = invoice.issuedDate
        ? invoice.issuedDate instanceof Date
          ? invoice.issuedDate.toISOString().slice(0, 10)
          : String(invoice.issuedDate)
        : null;

      const dueDateStr = invoice.dueDate
        ? invoice.dueDate instanceof Date
          ? invoice.dueDate.toISOString().slice(0, 10)
          : String(invoice.dueDate)
        : null;

      // Call InvoicePdf as a plain function so the return value is the
      // inner <Document> element that renderToBuffer expects.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const docElement = InvoicePdf({
        invoice: {
          invoiceNumber: invoice.invoiceNumber,
          issuedDate: issuedDateStr,
          dueDate: dueDateStr,
          notes: invoice.notes,
          paymentTerms: invoice.paymentTerms,
          subtotalCents: invoice.subtotalCents,
          taxCents: invoice.taxCents,
          totalCents: invoice.totalCents,
        },
        client: {
          displayName: client.displayName,
          addressLine1: client.addressLine1,
          city: client.city,
          state: client.state,
          zipCode: client.zipCode,
          country: client.country,
        },
        firm: {
          name: firmName,
        },
        lineItems: lineItemRows.map((item) => ({
          caseTitle: item.caseName,
          type: item.type,
          description: item.description,
          quantity: String(item.quantity),
          unitPriceCents: item.unitPriceCents,
          amountCents: item.amountCents,
        })),
      }) as Parameters<typeof renderToBuffer>[0];

      const buffer = await renderToBuffer(docElement);

      return { pdf: Buffer.from(buffer).toString("base64") };
    }),
});
