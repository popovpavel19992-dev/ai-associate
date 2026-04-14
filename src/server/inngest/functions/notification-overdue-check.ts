import { and, eq, isNotNull, lt, ne } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../db";
import { caseTasks } from "../../db/schema/case-tasks";
import { invoices } from "../../db/schema/invoices";
import { users } from "../../db/schema/users";
import { cases } from "../../db/schema/cases";
import { clients } from "../../db/schema/clients";
import type { NotificationSendEvent } from "@/lib/notification-types";

export const notificationOverdueCheck = inngest.createFunction(
  {
    id: "notification-overdue-check",
    triggers: [{ cron: "0 9 * * *" }],
  },
  async ({ step }) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateStr = today.toISOString().slice(0, 10);

    // --- Overdue tasks ---
    await step.run("check-overdue-tasks", async () => {
      const overdueTasks = await db
        .select({
          id: caseTasks.id,
          title: caseTasks.title,
          caseId: caseTasks.caseId,
          assignedTo: caseTasks.assignedTo,
          dueDate: caseTasks.dueDate,
        })
        .from(caseTasks)
        .where(
          and(
            isNotNull(caseTasks.assignedTo),
            isNotNull(caseTasks.dueDate),
            lt(caseTasks.dueDate, today),
            ne(caseTasks.status, "done"),
          ),
        );

      for (const task of overdueTasks) {
        if (!task.assignedTo) continue;

        // Fetch case name
        const [caseRow] = await db
          .select({ name: cases.name })
          .from(cases)
          .where(eq(cases.id, task.caseId))
          .limit(1);

        const caseName = caseRow?.name ?? "Unknown case";
        const dueDate = task.dueDate!.toISOString().slice(0, 10);
        const dedupKey = `task_overdue:${task.id}:${dateStr}`;

        const payload: NotificationSendEvent = {
          userId: task.assignedTo,
          type: "task_overdue",
          title: `Task Overdue: ${task.title}`,
          body: `"${task.title}" in case "${caseName}" was due on ${dueDate}.`,
          caseId: task.caseId,
          actionUrl: `/cases/${task.caseId}`,
          metadata: {
            caseName,
            taskTitle: task.title,
            dueDate,
          },
          dedupKey,
        };

        await inngest.send({ name: "notification/send", data: payload });
      }
    });

    // --- Overdue invoices ---
    await step.run("check-overdue-invoices", async () => {
      const overdueInvoices = await db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          orgId: invoices.orgId,
          userId: invoices.userId,
          clientId: invoices.clientId,
          dueDate: invoices.dueDate,
          totalCents: invoices.totalCents,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.status, "sent"),
            isNotNull(invoices.dueDate),
            lt(invoices.dueDate, today),
          ),
        );

      for (const invoice of overdueInvoices) {
        if (!invoice.dueDate) continue;

        // Fetch client name
        const [clientRow] = await db
          .select({ displayName: clients.displayName })
          .from(clients)
          .where(eq(clients.id, invoice.clientId))
          .limit(1);

        const clientName = clientRow?.displayName ?? "Unknown client";
        const amount = `$${(invoice.totalCents / 100).toFixed(2)}`;
        const dueDate = invoice.dueDate.toISOString().slice(0, 10);
        const dedupKey = `invoice_overdue:${invoice.id}:${dateStr}`;

        // Determine recipients: org admins if orgId, otherwise invoice creator
        let recipientIds: string[] = [];

        if (invoice.orgId) {
          const admins = await db
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                eq(users.orgId, invoice.orgId),
                ne(users.role, "member"),
              ),
            );
          recipientIds = admins.map((a) => a.id);
        }

        // Always include the invoice creator
        if (!recipientIds.includes(invoice.userId)) {
          recipientIds.push(invoice.userId);
        }

        for (const userId of recipientIds) {
          const payload: NotificationSendEvent = {
            userId,
            orgId: invoice.orgId ?? undefined,
            type: "invoice_overdue",
            title: `Invoice Overdue: ${invoice.invoiceNumber}`,
            body: `Invoice ${invoice.invoiceNumber} for ${clientName} (${amount}) was due on ${dueDate}.`,
            actionUrl: "/invoices",
            metadata: {
              invoiceNumber: invoice.invoiceNumber,
              clientName,
              amount,
              dueDate,
            },
            dedupKey: `${dedupKey}:${userId}`,
          };

          await inngest.send({ name: "notification/send", data: payload });
        }
      }
    });

    return { checkedAt: today.toISOString() };
  },
);
