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

export interface AttorneyRevenueDatum {
  userId: string;
  userName: string;
  userEmail: string;
  value: number; // dollars
}

const usd = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function RevenuePerAttorneyChart({
  data,
  loading,
}: {
  data?: AttorneyRevenueDatum[];
  loading?: boolean;
}) {
  const sorted = (data ?? []).slice().sort((a, b) => b.value - a.value);
  return (
    <ChartCard
      title="Revenue per attorney"
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
          <XAxis type="number" tickFormatter={usd} />
          <YAxis type="category" dataKey="userName" width={140} />
          <Tooltip formatter={(v) => usd(Number(v))} />
          <Bar dataKey="value" name="Revenue" fill="#f59e0b" />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
