"use client";

import { DashboardStats } from "@/components/portal/dashboard-stats";
import { RecentActivity } from "@/components/portal/recent-activity";

export default function PortalDashboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <DashboardStats />
      <RecentActivity />
    </div>
  );
}
