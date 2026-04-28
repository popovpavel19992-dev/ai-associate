"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useDateRange } from "@/components/analytics/use-date-range";
import { DateRangePicker } from "@/components/analytics/date-range-picker";
import { KpiCards } from "@/components/analytics/kpi-cards";
import { ActiveCasesChart } from "@/components/analytics/active-cases-chart";
import { CaseVelocityChart } from "@/components/analytics/case-velocity-chart";
import { BillingTrendChart } from "@/components/analytics/billing-trend-chart";
import { DeadlineComplianceChart } from "@/components/analytics/deadline-compliance-chart";
import { PipelineFunnelChart } from "@/components/analytics/pipeline-funnel-chart";
import { CasesPerAttorneyChart } from "@/components/analytics/cases-per-attorney-chart";
import { HoursPerAttorneyChart } from "@/components/analytics/hours-per-attorney-chart";
import { RevenuePerAttorneyChart } from "@/components/analytics/revenue-per-attorney-chart";
import { AvgCaseDurationPerAttorneyChart } from "@/components/analytics/avg-case-duration-per-attorney-chart";
import { DeadlineCompliancePerAttorneyChart } from "@/components/analytics/deadline-compliance-per-attorney-chart";
import {
  AttorneyMultiSelect,
  type AttorneyOption,
} from "@/components/analytics/attorney-multi-select";

export default function AnalyticsPage() {
  const range = useDateRange("90");

  const rangeInput = useMemo(
    () => ({
      startDate: range.startDate.toISOString(),
      endDate: range.endDate.toISOString(),
    }),
    [range.startDate, range.endDate],
  );

  const profile = trpc.users.getProfile.useQuery();
  const isOwnerOrAdmin = Boolean(
    profile.data?.orgId && (profile.data?.role === "owner" || profile.data?.role === "admin"),
  );

  const kpis = trpc.analytics.getKpis.useQuery(rangeInput);
  const activeCases = trpc.analytics.getActiveCasesByStage.useQuery();
  const velocity = trpc.analytics.getCaseVelocity.useQuery(rangeInput);
  const billing = trpc.analytics.getBillingTrend.useQuery(rangeInput);
  const compliance = trpc.analytics.getDeadlineCompliance.useQuery(rangeInput);
  const funnel = trpc.analytics.getPipelineFunnel.useQuery();

  // Per-attorney queries — only fire for owner/admin.
  const casesPerAtt = trpc.analytics.getCasesPerAttorney.useQuery(undefined, {
    enabled: isOwnerOrAdmin,
  });
  const hoursPerAtt = trpc.analytics.getHoursPerAttorney.useQuery(rangeInput, {
    enabled: isOwnerOrAdmin,
  });
  const revPerAtt = trpc.analytics.getRevenuePerAttorney.useQuery(rangeInput, {
    enabled: isOwnerOrAdmin,
  });
  const durPerAtt = trpc.analytics.getAvgCaseDurationPerAttorney.useQuery(undefined, {
    enabled: isOwnerOrAdmin,
  });
  const deadlinePerAtt = trpc.analytics.getDeadlineCompliancePerAttorney.useQuery(rangeInput, {
    enabled: isOwnerOrAdmin,
  });

  // Build the union of attorney options from all five datasets.
  const attorneyOptions: AttorneyOption[] = useMemo(() => {
    if (!isOwnerOrAdmin) return [];
    const map = new Map<string, AttorneyOption>();
    const collect = (
      rows?: { userId: string; userName: string; userEmail: string }[],
    ) => {
      for (const r of rows ?? []) {
        if (!map.has(r.userId)) {
          map.set(r.userId, { userId: r.userId, userName: r.userName, userEmail: r.userEmail });
        }
      }
    };
    collect(casesPerAtt.data);
    collect(hoursPerAtt.data);
    collect(revPerAtt.data);
    collect(durPerAtt.data);
    collect(deadlinePerAtt.data);
    return [...map.values()].sort((a, b) => a.userName.localeCompare(b.userName));
  }, [
    isOwnerOrAdmin,
    casesPerAtt.data,
    hoursPerAtt.data,
    revPerAtt.data,
    durPerAtt.data,
    deadlinePerAtt.data,
  ]);

  // Selected attorneys (default = all). [] is treated as "all" by the filter
  // helper below — it's the natural empty state when options haven't loaded.
  const [selected, setSelected] = useState<string[]>([]);

  const visible = (userId: string) => selected.length === 0 || selected.includes(userId);
  const filterRows = <T extends { userId: string }>(rows?: T[]): T[] | undefined =>
    rows?.filter((r) => visible(r.userId));

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

      {isOwnerOrAdmin && (
        <section className="space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold tracking-tight">By attorney</h2>
              <p className="text-sm text-zinc-500">
                Per-attorney breakdown across cases, hours, revenue, and deadlines. Visible to
                owners and admins only.
              </p>
            </div>
            <AttorneyMultiSelect
              options={attorneyOptions}
              selected={selected}
              onChange={setSelected}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <CasesPerAttorneyChart
              data={filterRows(casesPerAtt.data)}
              loading={casesPerAtt.isLoading}
            />
            <HoursPerAttorneyChart
              data={filterRows(hoursPerAtt.data)}
              loading={hoursPerAtt.isLoading}
            />
            <RevenuePerAttorneyChart
              data={filterRows(revPerAtt.data)}
              loading={revPerAtt.isLoading}
            />
            <AvgCaseDurationPerAttorneyChart
              data={filterRows(durPerAtt.data)}
              loading={durPerAtt.isLoading}
            />
          </div>

          <DeadlineCompliancePerAttorneyChart
            data={filterRows(deadlinePerAtt.data)}
            loading={deadlinePerAtt.isLoading}
          />
        </section>
      )}
    </div>
  );
}
