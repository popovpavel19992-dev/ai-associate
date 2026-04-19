"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal, Pencil, Trash2, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { AddToCollectionMenu } from "@/components/research/add-to-collection-menu";

interface SessionItemProps {
  session: {
    id: string;
    title: string;
    caseId: string | null;
    updatedAt: Date | string;
  };
  queryCount?: number;
  active?: boolean;
  onRename?: (id: string, newTitle: string) => void;
  onDelete?: (id: string) => void;
  onLinkToCase?: (id: string) => void;
}

const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

export function SessionItem({
  session,
  queryCount,
  active,
  onRename,
  onDelete,
  onLinkToCase,
}: SessionItemProps) {
  const pathname = usePathname();
  const isActive =
    active ?? pathname === `/research/sessions/${session.id}`;

  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(session.title);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function commitRename() {
    const next = draftTitle.trim();
    if (next && next !== session.title) {
      onRename?.(session.id, next);
    }
    setEditing(false);
  }

  function cancelRename() {
    setDraftTitle(session.title);
    setEditing(false);
  }

  return (
    <>
      <div
        className={cn(
          "group relative flex items-start gap-2 rounded-md px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
            : "text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-50",
        )}
      >
        {editing ? (
          <Input
            ref={inputRef}
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelRename();
              }
            }}
            className="h-7 text-sm"
          />
        ) : (
          <Link
            href={`/research/sessions/${session.id}`}
            className="flex min-w-0 flex-1 flex-col gap-1"
          >
            <span className="truncate font-medium">{session.title}</span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {typeof queryCount === "number" && (
                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                  {queryCount} quer{queryCount === 1 ? "y" : "ies"}
                </Badge>
              )}
              {session.caseId && (
                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                  Linked to case
                </Badge>
              )}
              <span className="ml-auto shrink-0">
                {shortDate.format(new Date(session.updatedAt))}
              </span>
            </span>
          </Link>
        )}

        {!editing && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 data-[popup-open]:opacity-100">
            <div onClick={(e) => e.stopPropagation()}>
              <AddToCollectionMenu itemType="session" itemId={session.id} size="sm" />
            </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0"
                  aria-label="Session actions"
                />
              }
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <Pencil className="h-4 w-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => onLinkToCase?.(session.id)}
              >
                <Link2 className="h-4 w-4" />
                Link to case
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirmOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete research session?</DialogTitle>
            <DialogDescription>
              This will soft-delete &ldquo;{session.title}&rdquo;. You can
              restore it from your archive.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onDelete?.(session.id);
                setConfirmOpen(false);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
