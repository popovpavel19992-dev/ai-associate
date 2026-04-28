"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ChartCard } from "./chart-card";

export interface AttorneyDeadlineDatum {
  userId: string;
  userName: string;
  userEmail: string;
  met: number;
  overdue: number;
  upcoming: number;
}

const COLORS = {
  met: "#10b981",
  overdue: "#ef4444",
  upcoming: "#3b82f6",
};

export function DeadlineCompliancePerAttorneyChart({
  data,
  loading,
}: {
  data?: AttorneyDeadlineDatum[];
  loading?: boolean;
}) {
  const sorted = (data ?? [])
    .slice()
    .sort((a, b) => b.met + b.overdue + b.upcoming - (a.met + a.overdue + a.upcoming));
  return (
    <ChartCard
      title="Deadline compliance per attorney"
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
          <Legend />
          <Bar dataKey="met" stackId="a" name="Met" fill={COLORS.met} />
          <Bar dataKey="overdue" stackId="a" name="Overdue" fill={COLORS.overdue} />
          <Bar dataKey="upcoming" stackId="a" name="Upcoming" fill={COLORS.upcoming} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
