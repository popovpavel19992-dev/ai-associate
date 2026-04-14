"use client";

import { use } from "react";
import { InvoiceDetail } from "@/components/time-billing/invoice-detail";

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <InvoiceDetail invoiceId={id} />;
}
