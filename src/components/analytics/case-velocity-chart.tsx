"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChartCard } from "./chart-card";

export interface CaseVelocityDatum {
  stageName: string;
  avgDays: number;
  sampleSize: number;
}

export function CaseVelocityChart({
  data,
  loading,
}: {
  data?: CaseVelocityDatum[];
  loading?: boolean;
}) {
  return (
    <ChartCard title="Case velocity (avg days per stage)" loading={loading} empty={!loading && !data?.length}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data ?? []} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 24 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" />
          <YAxis type="category" dataKey="stageName" width={120} />
          <Tooltip
            formatter={(value, _name, item) => {
              const n = (item as { payload?: { sampleSize?: number } } | undefined)?.payload
                ?.sampleSize ?? 0;
              return [`${value} days (n=${n})`, "Average"] as [string, string];
            }}
          />
          <Bar dataKey="avgDays" fill="#6366f1" />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
