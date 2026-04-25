"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useDateRange } from "@/components/analytics/use-date-range";
import { DateRangePicker } from "@/components/analytics/date-range-picker";
import { KpiCards } from "@/components/analytics/kpi-cards";
import { ActiveCasesChart } from "@/components/analytics/active-cases-chart";
import { CaseVelocityChart } from "@/components/analytics/case-velocity-chart";
import { BillingTrendChart } from "@/components/analytics/billing-trend-chart";
import { DeadlineComplianceChart } from "@/components/analytics/deadline-compliance-chart";
import { PipelineFunnelChart } from "@/components/analytics/pipeline-funnel-chart";

export default function AnalyticsPage() {
  const range = useDateRange("90");

  const rangeInput = useMemo(
    () => ({
      startDate: range.startDate.toISOString(),
      endDate: range.endDate.toISOString(),
    }),
    [range.startDate, range.endDate],
  );

  const kpis = trpc.analytics.getKpis.useQuery(rangeInput);
  const activeCases = trpc.analytics.getActiveCasesByStage.useQuery();
  const velocity = trpc.analytics.getCaseVelocity.useQuery(rangeInput);
  const billing = trpc.analytics.getBillingTrend.useQuery(rangeInput);
  const compliance = trpc.analytics.getDeadlineCompliance.useQuery(rangeInput);
  const funnel = trpc.analytics.getPipelineFunnel.useQuery();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <DateRangePicker range={range} />
      </div>

      <KpiCards data={kpis.data} loading={kpis.isLoading} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ActiveCasesChart data={activeCases.data} loading={activeCases.isLoading} />
        <DeadlineComplianceChart data={compliance.data} loading={compliance.isLoading} />
        <CaseVelocityChart data={velocity.data} loading={velocity.isLoading} />
        <PipelineFunnelChart data={funnel.data} loading={funnel.isLoading} />
      </div>

      <BillingTrendChart data={billing.data} loading={billing.isLoading} />
    </div>
  );
}
