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

export interface AttorneyHoursDatum {
  userId: string;
  userName: string;
  userEmail: string;
  value: number; // hours
}

export function HoursPerAttorneyChart({
  data,
  loading,
}: {
  data?: AttorneyHoursDatum[];
  loading?: boolean;
}) {
  const sorted = (data ?? []).slice().sort((a, b) => b.value - a.value);
  return (
    <ChartCard
      title="Hours logged per attorney"
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
          <XAxis type="number" tickFormatter={(v) => `${v}h`} />
          <YAxis type="category" dataKey="userName" width={140} />
          <Tooltip formatter={(v) => `${Number(v).toFixed(1)}h`} />
          <Bar dataKey="value" name="Hours" fill="#10b981" />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
