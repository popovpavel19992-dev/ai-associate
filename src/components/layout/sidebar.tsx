"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import {
  LayoutDashboard,
  FileText,
  Settings,
  Zap,
  Menu,
  FileCheck,
  PenLine,
  Briefcase,
  Calendar as CalendarIcon,
  Users,
  Receipt,
  Bell,
  ScrollText,
  Library,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { TimerIndicator } from "@/components/time-billing/timer-indicator";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contracts", label: "Contracts", icon: FileCheck },
  { href: "/drafts", label: "Drafts", icon: PenLine },
  { href: "/quick-analysis", label: "Quick Analysis", icon: Zap },
  { href: "/cases", label: "Cases", icon: Briefcase },
  { href: "/research", label: "Research", icon: ScrollText },
  { href: "/research/collections", label: "Collections", icon: Library },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/calendar", label: "Calendar", icon: CalendarIcon },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings/templates", label: "Templates", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavContent() {
  const pathname = usePathname();
  const { data: profile } = trpc.users.getProfile.useQuery();
  const isTeamAdmin = profile?.role === "owner" || profile?.role === "admin";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-6">
        <Link href="/dashboard" className="text-xl font-bold tracking-tight">
          ClearTerms
        </Link>
        <div className="flex items-center gap-2">
          <TimerIndicator />
          <NotificationBell />
        </div>
      </div>

      <Separator />

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive = item.href === "/settings"
            ? pathname === "/settings"
            : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-50",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
        {isTeamAdmin && (
          <Link
            href="/settings/team"
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname === "/settings/team"
                ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-50",
            )}
          >
            <Users className="h-4 w-4" />
            Team
          </Link>
        )}
        {(isTeamAdmin || !profile?.orgId) && (
          <Link
            href="/invoices"
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname === "/invoices" || pathname.startsWith("/invoices/")
                ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-50",
            )}
          >
            <Receipt className="h-4 w-4" />
            Invoices
          </Link>
        )}
      </nav>

      <Separator />

      <div className="px-4 py-4">
        <UserButton />
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 lg:block">
        <NavContent />
      </aside>

      {/* Mobile sidebar */}
      <div className="fixed top-4 left-4 z-40 lg:hidden">
        <Sheet>
          <SheetTrigger render={<Button variant="outline" size="icon" />}>
            <Menu className="h-4 w-4" />
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <NavContent />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
