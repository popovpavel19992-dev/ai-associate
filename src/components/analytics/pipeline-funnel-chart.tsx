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

export interface FunnelDatum {
  stageName: string;
  stageColor: string;
  everEntered: number;
}

export function PipelineFunnelChart({
  data,
  loading,
}: {
  data?: FunnelDatum[];
  loading?: boolean;
}) {
  return (
    <ChartCard title="Pipeline funnel (cases ever in stage)" loading={loading} empty={!loading && !data?.length}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data ?? []} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="stageName" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="everEntered">
            {(data ?? []).map((d, i) => (
              <Cell key={i} fill={d.stageColor} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
