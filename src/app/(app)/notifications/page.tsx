"use client";

import { NotificationList } from "@/components/notifications/notification-list";

export default function NotificationsPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Notifications</h1>
      <NotificationList />
    </div>
  );
}
