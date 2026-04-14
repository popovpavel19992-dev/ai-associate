"use client";

import { use } from "react";
import { InvoiceCreateWizard } from "@/components/time-billing/invoice-create-wizard";

export default function InvoiceEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <InvoiceCreateWizard invoiceId={id} />;
}
