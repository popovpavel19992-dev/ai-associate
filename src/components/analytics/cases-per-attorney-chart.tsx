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

export interface AttorneyCasesDatum {
  userId: string;
  userName: string;
  userEmail: string;
  value: number;
}

export function CasesPerAttorneyChart({
  data,
  loading,
}: {
  data?: AttorneyCasesDatum[];
  loading?: boolean;
}) {
  const sorted = (data ?? []).slice().sort((a, b) => b.value - a.value);
  return (
    <ChartCard
      title="Active cases per attorney"
      loading={loading}
      empty={!loading && !sorted.length}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={sorted}
          layout="vertical"
          margin={{ top: 8, right: 16, bottom: 8, left: 24 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" allowDecimals={false} />
          <YAxis type="category" dataKey="userName" width={140} />
          <Tooltip />
          <Bar dataKey="value" name="Active cases" fill="#6366f1" />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
