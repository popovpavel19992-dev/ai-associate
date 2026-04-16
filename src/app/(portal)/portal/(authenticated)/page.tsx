"use client";

import { DashboardStats } from "@/components/portal/dashboard-stats";
import { RecentActivity } from "@/components/portal/recent-activity";
import { LawyerProfileCard } from "@/components/portal/lawyer-profile-card";

export default function PortalDashboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <LawyerProfileCard />
      <DashboardStats />
      <RecentActivity />
    </div>
  );
}
