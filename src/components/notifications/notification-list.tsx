"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { NotificationItem } from "./notification-item";
import type { NotificationCategory } from "@/lib/notification-types";

type Filter = "all" | "unread";
type CategoryFilter = "all" | NotificationCategory;

const CATEGORY_TABS: { key: CategoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "cases", label: "Cases" },
  { key: "billing", label: "Billing" },
  { key: "team", label: "Team" },
  { key: "calendar", label: "Calendar" },
  { key: "portal", label: "Portal" },
];

const PAGE_SIZE = 20;

export function NotificationList() {
  const [filter, setFilter] = useState<Filter>("all");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [offset, setOffset] = useState(0);

  const utils = trpc.useUtils();

  const { data: items = [], isLoading } = trpc.notifications.list.useQuery({
    filter,
    category: category === "all" ? undefined : category,
    limit: offset + PAGE_SIZE,
    offset: 0,
  });

  const { data: unreadCount = 0 } = trpc.notifications.getUnreadCount.useQuery();

  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.getUnreadCount.invalidate();
    },
  });

  const handleFilterChange = (newFilter: Filter) => {
    setFilter(newFilter);
    setOffset(0);
  };

  const handleCategoryChange = (newCategory: CategoryFilter) => {
    setCategory(newCategory);
    setOffset(0);
  };

  const hasMore = items.length === offset + PAGE_SIZE;

  return (
    <div className="space-y-4">
      {/* Filter row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1">
          {(["all", "unread"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => handleFilterChange(f)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === f
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {f === "all" ? "All" : `Unread${unreadCount > 0 ? ` (${unreadCount})` : ""}`}
            </button>
          ))}
        </div>

        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
          >
            Mark all read
          </Button>
        )}
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleCategoryChange(tab.key)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              category === tab.key
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No notifications
        </div>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {items.map((n) => (
            <NotificationItem
              key={n.id}
              id={n.id}
              title={n.title}
              body={n.body}
              isRead={n.isRead}
              createdAt={new Date(n.createdAt)}
              actionUrl={n.actionUrl ?? null}
            />
          ))}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
