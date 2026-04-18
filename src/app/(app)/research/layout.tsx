"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { SessionsSidebar } from "@/components/research/sessions-sidebar";
import { ChatPanel } from "@/components/research/chat-panel";

export default function ResearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // On opinion + statute detail pages the viewer renders its own right-rail
  // chat panel, so suppress the layout-level stub to avoid two competing rails.
  const hideRightRail =
    pathname?.startsWith("/research/opinions/") === true ||
    pathname?.startsWith("/research/statutes/") === true;

  // Broad-mode chat: mount only on /research root once a session exists in the URL.
  const broadSessionId =
    pathname === "/research" ? (searchParams?.get("session") ?? null) : null;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Left pane — sessions sidebar */}
      <aside className="hidden w-72 shrink-0 overflow-hidden border-r border-zinc-200 dark:border-zinc-800 md:block">
        <SessionsSidebar />
      </aside>

      {/* Center pane — main content */}
      <div className="flex-1 overflow-y-auto">{children}</div>

      {/* Right pane — AI chat panel. Hidden on opinion/statute routes where
          the viewer renders its own chat rail. On /research root we mount
          a broad-mode ChatPanel as soon as a session id appears in the URL. */}
      {hideRightRail ? null : (
        <aside className="hidden w-96 shrink-0 flex-col border-l border-zinc-200 dark:border-zinc-800 lg:flex">
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              AI Assistant
            </h2>
            {broadSessionId ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Ask questions about your search results.
              </p>
            ) : null}
          </div>
          {broadSessionId ? (
            <ChatPanel
              key={broadSessionId}
              sessionId={broadSessionId}
              mode="broad"
              className="min-h-0 flex-1"
            />
          ) : (
            <div className="p-4">
              <p className="text-sm text-muted-foreground">
                Run a search to start asking questions, or open an opinion for
                detail-level analysis.
              </p>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
