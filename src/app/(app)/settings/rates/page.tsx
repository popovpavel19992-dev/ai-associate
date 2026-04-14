"use client";

import { BillingRatesTable } from "@/components/time-billing/billing-rates-table";

export default function BillingRatesPage() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Billing Rates</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Set default hourly rates for each team member. Override rates per case from the case time tab.
        </p>
      </div>
      <BillingRatesTable />
    </div>
  );
}
