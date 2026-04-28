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

export interface AttorneyDurationDatum {
  userId: string;
  userName: string;
  userEmail: string;
  value: number; // days
}

export function AvgCaseDurationPerAttorneyChart({
  data,
  loading,
}: {
  data?: AttorneyDurationDatum[];
  loading?: boolean;
}) {
  const sorted = (data ?? []).slice().sort((a, b) => b.value - a.value);
  return (
    <ChartCard
      title="Avg active case age per attorney"
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
          <XAxis type="number" allowDecimals={false} tickFormatter={(v) => `${v}d`} />
          <YAxis type="category" dataKey="userName" width={140} />
          <Tooltip formatter={(v) => `${Number(v)} days`} />
          <Bar dataKey="value" name="Days" fill="#8b5cf6" />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
