"use client";

import { Card, CardContent } from "@/components/ui/card";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

interface Kpis {
  activeCases: number;
  totalHours: number;
  totalRevenue: number;
  avgCaseAgeDays: number;
}

export function KpiCards({ data, loading }: { data?: Kpis; loading?: boolean }) {
  const cards = [
    { label: "Active cases", value: loading ? "—" : String(data?.activeCases ?? 0) },
    { label: "Billed hours", value: loading ? "—" : (data?.totalHours ?? 0).toFixed(1) },
    {
      label: "Invoiced revenue",
      value: loading ? "—" : currency.format(data?.totalRevenue ?? 0),
    },
    { label: "Avg case age (days)", value: loading ? "—" : String(data?.avgCaseAgeDays ?? 0) },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="px-5 py-4">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              {c.label}
            </div>
            <div className="mt-1 text-2xl font-bold tracking-tight">{c.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
