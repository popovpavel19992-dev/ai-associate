"use client";

import { NotificationSettings } from "@/components/portal/notification-settings";

export default function PortalSettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <NotificationSettings />
    </div>
  );
}
