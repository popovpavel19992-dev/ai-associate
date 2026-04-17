"use client";

import { usePathname } from "next/navigation";
import { SessionsSidebar } from "@/components/research/sessions-sidebar";

export default function ResearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // On opinion pages the viewer renders its own right-rail chat panel, so
  // suppress the layout-level stub to avoid two competing 384px rails.
  const hideRightRail = pathname?.startsWith("/research/opinions/") ?? false;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Left pane — sessions sidebar */}
      <aside className="hidden w-72 shrink-0 overflow-hidden border-r border-zinc-200 dark:border-zinc-800 md:block">
        <SessionsSidebar />
      </aside>

      {/* Center pane — main content */}
      <div className="flex-1 overflow-y-auto">{children}</div>

      {/* Right pane — AI chat panel (stub). Hidden on opinion routes where
          the viewer renders its own chat rail. */}
      {hideRightRail ? null : (
        <aside className="hidden w-96 shrink-0 overflow-y-auto border-l border-zinc-200 dark:border-zinc-800 lg:block">
          <div className="p-4">
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              AI Assistant
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Select search results or an opinion to begin.
            </p>
          </div>
        </aside>
      )}
    </div>
  );
}
