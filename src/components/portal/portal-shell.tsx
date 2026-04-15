"use client";

import { PortalSidebar } from "./portal-sidebar";
import { usePortalNotificationStream } from "@/hooks/use-portal-notification-stream";

export function PortalShell({ children }: { children: React.ReactNode }) {
  usePortalNotificationStream();

  return (
    <div className="flex h-screen">
      <PortalSidebar />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
