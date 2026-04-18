"use client";

import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

export function RecentActivity() {
  const { data, isLoading } = trpc.portalNotifications.list.useQuery({ limit: 10 });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : !data?.notifications?.length ? (
          <p className="text-sm text-muted-foreground">No recent activity</p>
        ) : (
          <div className="space-y-4">
            {data.notifications.map((n) => (
              <div key={n.id} className="flex items-start gap-3">
                <div
                  className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
                    n.isRead ? "bg-muted" : "bg-primary"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-none">{n.title}</p>
                  <p className="text-sm text-muted-foreground mt-1">{n.body}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
