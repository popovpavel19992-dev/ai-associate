"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Briefcase,
  MessageSquare,
  Receipt,
  Settings,
  Bell,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

const navItems = [
  { href: "/portal", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/portal/cases", label: "Cases", icon: Briefcase },
  { href: "/portal/messages", label: "Messages", icon: MessageSquare },
  { href: "/portal/invoices", label: "Invoices", icon: Receipt },
  { href: "/portal/notifications", label: "Notifications", icon: Bell },
  { href: "/portal/settings", label: "Settings", icon: Settings },
];

export function PortalSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: unreadCount = 0 } = trpc.portalNotifications.getUnreadCount.useQuery();

  const handleLogout = async () => {
    await fetch("/api/portal/set-token", { method: "DELETE" });
    router.push("/portal/login");
  };

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-background">
      <div className="px-4 py-6">
        <Link href="/portal" className="text-xl font-bold tracking-tight">
          ClearTerms
        </Link>
        <p className="text-xs text-muted-foreground mt-1">Client Portal</p>
      </div>

      <Separator />

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
              {item.href === "/portal/notifications" && unreadCount > 0 && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <Separator />

      <div className="p-3">
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-muted-foreground"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </aside>
  );
}
