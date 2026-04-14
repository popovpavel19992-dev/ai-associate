"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

interface NotificationItemProps {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: Date;
  actionUrl: string | null;
}

export function NotificationItem({
  id,
  title,
  body,
  isRead,
  createdAt,
  actionUrl,
}: NotificationItemProps) {
  const utils = trpc.useUtils();

  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.getUnreadCount.invalidate();
    },
  });

  const deleteNotification = trpc.notifications.delete.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.getUnreadCount.invalidate();
    },
  });

  const handleClick = () => {
    if (!isRead) {
      markRead.mutate({ id });
    }
  };

  const content = (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex items-start gap-2">
        {!isRead && (
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
        )}
        <span className={`text-sm font-medium leading-snug ${isRead ? "text-muted-foreground" : ""}`}>
          {title}
        </span>
      </div>
      <p className="ml-4 text-xs text-muted-foreground line-clamp-2">{body}</p>
      <span className="ml-4 text-xs text-muted-foreground">{formatRelativeTime(createdAt)}</span>
    </div>
  );

  return (
    <div className="group flex items-start gap-2 rounded-lg px-3 py-3 transition-colors hover:bg-muted/50">
      <div className="min-w-0 flex-1">
        {actionUrl ? (
          <Link href={actionUrl} className="block" onClick={handleClick}>
            {content}
          </Link>
        ) : (
          <button
            className="block w-full text-left"
            onClick={handleClick}
            disabled={isRead}
          >
            {content}
          </button>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={() => deleteNotification.mutate({ id })}
        disabled={deleteNotification.isPending}
        aria-label="Delete notification"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
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
