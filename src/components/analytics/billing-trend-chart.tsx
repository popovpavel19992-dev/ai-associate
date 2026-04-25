"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ChartCard } from "./chart-card";

export interface BillingTrendDatum {
  month: string;
  hours: number;
  revenue: number;
}

export function BillingTrendChart({
  data,
  loading,
}: {
  data?: BillingTrendDatum[];
  loading?: boolean;
}) {
  const empty = !loading && (data?.every((d) => d.hours === 0 && d.revenue === 0) ?? true);
  return (
    <ChartCard title="Billing trend (12 months)" loading={loading} empty={empty}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data ?? []} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" />
          <YAxis yAxisId="hours" orientation="left" stroke="#6366f1" />
          <YAxis yAxisId="revenue" orientation="right" stroke="#10b981" />
          <Tooltip />
          <Legend />
          <Line
            yAxisId="hours"
            type="monotone"
            dataKey="hours"
            stroke="#6366f1"
            name="Hours"
            dot={false}
          />
          <Line
            yAxisId="revenue"
            type="monotone"
            dataKey="revenue"
            stroke="#10b981"
            name="Revenue ($)"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
