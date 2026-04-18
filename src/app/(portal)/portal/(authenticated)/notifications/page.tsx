"use client";

import { formatDistanceToNow } from "date-fns";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

export default function PortalNotificationsPage() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.portalNotifications.list.useQuery();
  const markAllRead = trpc.portalNotifications.markAllRead.useMutation({
    onSuccess: () => {
      utils.portalNotifications.list.invalidate();
      utils.portalNotifications.getUnreadCount.invalidate();
    },
  });
  const markRead = trpc.portalNotifications.markRead.useMutation({
    onSuccess: () => {
      utils.portalNotifications.list.invalidate();
      utils.portalNotifications.getUnreadCount.invalidate();
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Notifications</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => markAllRead.mutate()}
          disabled={markAllRead.isPending}
        >
          Mark all read
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.notifications?.length ? (
        <p className="text-muted-foreground text-center py-12">No notifications</p>
      ) : (
        <div className="space-y-2">
          {data.notifications.map((n) => (
            <Card
              key={n.id}
              className={n.isRead ? "opacity-60" : ""}
              onClick={() => !n.isRead && markRead.mutate({ notificationId: n.id })}
            >
              <CardContent className="flex items-start gap-3 py-3 cursor-pointer">
                <div
                  className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${
                    n.isRead ? "bg-transparent" : "bg-primary"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="text-sm text-muted-foreground">{n.body}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
