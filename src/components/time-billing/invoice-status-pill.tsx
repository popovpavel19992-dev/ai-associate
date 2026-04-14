"use client";

import { cn } from "@/lib/utils";
import type { InvoiceStatus } from "@/lib/billing";

interface InvoiceStatusPillProps {
  status: InvoiceStatus;
  dueDate?: Date | string | null;
}

export function InvoiceStatusPill({ status, dueDate }: InvoiceStatusPillProps) {
  const isOverdue =
    status === "sent" &&
    dueDate != null &&
    new Date(dueDate) < new Date();

  if (status === "draft") {
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-600">
        Draft
      </span>
    );
  }

  if (status === "sent") {
    if (isOverdue) {
      return (
        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-100 text-red-800">
          Overdue
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800">
        Sent
      </span>
    );
  }

  if (status === "paid") {
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-800">
        Paid
      </span>
    );
  }

  // void
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-400 line-through">
      Void
    </span>
  );
}
