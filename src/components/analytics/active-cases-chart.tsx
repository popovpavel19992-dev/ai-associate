"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { ChartCard } from "./chart-card";

export interface ActiveCasesDatum {
  stageName: string;
  stageColor: string;
  count: number;
}

export function ActiveCasesChart({
  data,
  loading,
}: {
  data?: ActiveCasesDatum[];
  loading?: boolean;
}) {
  return (
    <ChartCard title="Active cases by stage" loading={loading} empty={!loading && !data?.length}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data ?? []} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 24 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" allowDecimals={false} />
          <YAxis type="category" dataKey="stageName" width={120} />
          <Tooltip />
          <Bar dataKey="count">
            {(data ?? []).map((d, i) => (
              <Cell key={i} fill={d.stageColor} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
