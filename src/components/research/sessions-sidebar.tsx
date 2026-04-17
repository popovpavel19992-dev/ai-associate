"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SessionItem } from "./session-item";

interface SessionRow {
  id: string;
  title: string;
  caseId: string | null;
  updatedAt: Date | string;
}

function bucketSessions(rows: SessionRow[]) {
  const now = new Date();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const weekAgo = today - 7 * 24 * 60 * 60 * 1000;
  const buckets: Record<"today" | "week" | "earlier", SessionRow[]> = {
    today: [],
    week: [],
    earlier: [],
  };
  for (const s of rows) {
    const t = new Date(s.updatedAt).getTime();
    if (t >= today) buckets.today.push(s);
    else if (t >= weekAgo) buckets.week.push(s);
    else buckets.earlier.push(s);
  }
  return buckets;
}

export function SessionsSidebar() {
  const { data: sessions = [], isLoading } =
    trpc.research.sessions.list.useQuery({});
  const utils = trpc.useUtils();
  const [linkStubOpen, setLinkStubOpen] = useState(false);

  const renameMut = trpc.research.sessions.rename.useMutation({
    onSuccess: () => {
      utils.research.sessions.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = trpc.research.sessions.delete.useMutation({
    onSuccess: () => {
      utils.research.sessions.list.invalidate();
      toast.success("Session deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const buckets = bucketSessions(sessions as SessionRow[]);

  const sectionHeader = (label: string) => (
    <h3 className="px-4 pt-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {label}
    </h3>
  );

  const renderItems = (rows: SessionRow[]) => (
    <div className="space-y-0.5 px-2">
      {rows.map((s) => (
        <SessionItem
          key={s.id}
          session={s}
          onRename={(id, newTitle) =>
            renameMut.mutate({ sessionId: id, title: newTitle })
          }
          onDelete={(id) => deleteMut.mutate({ sessionId: id })}
          onLinkToCase={() => setLinkStubOpen(true)}
        />
      ))}
    </div>
  );

  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto">
      <h2 className="px-4 pt-4 pb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        My Research
      </h2>

      <Button
        size="sm"
        className="mx-4 w-[calc(100%-2rem)]"
        render={<Link href="/research" />}
      >
        <Plus className="h-4 w-4" />
        New research
      </Button>

      <Separator className="mt-4" />

      {isLoading ? (
        <Loader2 className="mx-auto mt-4 size-4 animate-spin text-muted-foreground" />
      ) : sessions.length === 0 ? (
        <p className="px-4 pt-4 text-sm text-muted-foreground">
          No research sessions yet. Start a new search above.
        </p>
      ) : (
        <div className="flex-1">
          {buckets.today.length > 0 && (
            <>
              {sectionHeader("Today")}
              {renderItems(buckets.today)}
            </>
          )}
          {buckets.week.length > 0 && (
            <>
              {sectionHeader("This week")}
              {renderItems(buckets.week)}
            </>
          )}
          {buckets.earlier.length > 0 && (
            <>
              {sectionHeader("Earlier")}
              {renderItems(buckets.earlier)}
            </>
          )}
        </div>
      )}

      <Dialog open={linkStubOpen} onOpenChange={setLinkStubOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link to case</DialogTitle>
            <DialogDescription>
              Case linking coming soon — see /research/bookmarks when it
              ships.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLinkStubOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
