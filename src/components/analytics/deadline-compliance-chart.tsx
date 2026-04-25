"use client";

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { ChartCard } from "./chart-card";

export interface DeadlineComplianceData {
  met: number;
  overdue: number;
  upcoming: number;
}

const COLORS = {
  met: "#10b981",
  overdue: "#ef4444",
  upcoming: "#3b82f6",
};

export function DeadlineComplianceChart({
  data,
  loading,
}: {
  data?: DeadlineComplianceData;
  loading?: boolean;
}) {
  const slices = data
    ? [
        { name: "Met", value: data.met, color: COLORS.met },
        { name: "Overdue", value: data.overdue, color: COLORS.overdue },
        { name: "Upcoming", value: data.upcoming, color: COLORS.upcoming },
      ].filter((s) => s.value > 0)
    : [];
  const empty = !loading && slices.length === 0;

  return (
    <ChartCard title="Deadline compliance" loading={loading} empty={empty}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={slices} dataKey="value" nameKey="name" outerRadius="75%" label>
            {slices.map((s, i) => (
              <Cell key={i} fill={s.color} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
