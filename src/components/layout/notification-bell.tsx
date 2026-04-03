"use client";

import { useState, useCallback } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

export interface Notification {
  id: string;
  type: "case_ready" | "document_failed" | "credits_low" | "payment_failed";
  message: string;
  caseId?: string;
  timestamp: Date;
  read: boolean;
}

const TYPE_STYLES: Record<Notification["type"], string> = {
  case_ready: "text-green-600",
  document_failed: "text-red-500",
  credits_low: "text-amber-500",
  payment_failed: "text-red-500",
};

// Session-local notification store (v1 — no persistent DB table)
let globalNotifications: Notification[] = [];
let listeners: Set<() => void> = new Set();

function notify() {
  listeners.forEach((fn) => fn());
}

export function addNotification(
  type: Notification["type"],
  message: string,
  caseId?: string,
) {
  globalNotifications = [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type,
      message,
      caseId,
      timestamp: new Date(),
      read: false,
    },
    ...globalNotifications,
  ].slice(0, 50);
  notify();
}

function useNotifications() {
  const [, setTick] = useState(0);

  useState(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  });

  const markAllRead = useCallback(() => {
    globalNotifications = globalNotifications.map((n) => ({ ...n, read: true }));
    notify();
  }, []);

  return {
    notifications: globalNotifications,
    unreadCount: globalNotifications.filter((n) => !n.read).length,
    markAllRead,
  };
}

export function NotificationBell() {
  const { notifications, unreadCount, markAllRead } = useNotifications();

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) markAllRead(); }}>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="relative" />}>
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <Badge
            variant="destructive"
            className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]"
          >
            {unreadCount}
          </Badge>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        {notifications.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">
            No notifications
          </div>
        ) : (
          notifications.slice(0, 10).map((n) => (
            <DropdownMenuItem key={n.id} className="flex flex-col items-start gap-0.5 py-2">
              <span className={`text-sm font-medium ${TYPE_STYLES[n.type]}`}>
                {n.message}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatRelativeTime(n.timestamp)}
              </span>
            </DropdownMenuItem>
          ))
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
