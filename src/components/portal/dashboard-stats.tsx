"use client";

import { Briefcase, Receipt, MessageSquare, Bell } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

export function DashboardStats() {
  const { data: casesData } = trpc.portalCases.list.useQuery();
  const { data: invoicesData } = trpc.portalInvoices.list.useQuery();
  const { data: unreadCount = 0 } = trpc.portalNotifications.getUnreadCount.useQuery();

  const activeCases = casesData?.cases?.filter((c) => c.status === "ready").length ?? 0;
  const unpaidInvoices = invoicesData?.invoices?.filter((i) => i.status !== "paid") ?? [];
  const unpaidTotal = unpaidInvoices.reduce(
    (sum, inv) => sum + inv.totalCents / 100,
    0,
  );

  const stats = [
    {
      label: "Active Cases",
      value: activeCases,
      icon: Briefcase,
    },
    {
      label: "Unpaid Invoices",
      value: unpaidInvoices.length,
      subtitle: unpaidTotal > 0 ? `$${unpaidTotal.toFixed(2)} total` : undefined,
      icon: Receipt,
    },
    {
      label: "Unread Notifications",
      value: unreadCount,
      icon: Bell,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              {stat.subtitle && (
                <p className="text-xs text-muted-foreground">{stat.subtitle}</p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
