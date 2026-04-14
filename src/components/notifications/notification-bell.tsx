"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useNotificationStream } from "@/hooks/use-notification-stream";

export function NotificationBell() {
  useNotificationStream();

  const { data: unreadCount = 0 } = trpc.notifications.getUnreadCount.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const { data: recent = [] } = trpc.notifications.list.useQuery(
    { limit: 5, filter: "all" },
    { refetchInterval: 30_000 },
  );
  const utils = trpc.useUtils();

  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      utils.notifications.getUnreadCount.invalidate();
      utils.notifications.list.invalidate();
    },
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="relative" />}>
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <Badge
            variant="destructive"
            className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </Badge>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        {recent.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">
            No notifications
          </div>
        ) : (
          <>
            {recent.map((n) => (
              <DropdownMenuItem key={n.id} className="p-0">
                <Link
                  href={n.actionUrl ?? "/notifications"}
                  className="flex w-full flex-col items-start gap-0.5 px-2 py-2"
                >
                  <span className={`text-sm font-medium ${n.isRead ? "text-muted-foreground" : ""}`}>
                    {n.title}
                  </span>
                  <span className="text-xs text-muted-foreground line-clamp-1">
                    {n.body}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(new Date(n.createdAt))}
                  </span>
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {unreadCount > 0 && (
              <DropdownMenuItem onSelect={() => markAllRead.mutate()}>
                <span className="w-full text-center text-sm">Mark all read</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="p-0">
              <Link href="/notifications" className="flex w-full justify-center px-2 py-1.5 text-sm font-medium">
                View all notifications
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
