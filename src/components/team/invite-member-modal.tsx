"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export function InviteMemberModal({
  currentUserRole,
  seatCount,
  maxSeats,
}: {
  currentUserRole: string;
  seatCount: number;
  maxSeats: number;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [error, setError] = useState("");
  const utils = trpc.useUtils();

  const invite = trpc.team.invite.useMutation({
    onSuccess: () => {
      utils.team.pendingInvites.invalidate();
      utils.team.list.invalidate();
      setOpen(false);
      setEmail("");
      setRole("member");
      setError("");
    },
    onError: (err) => setError(err.message),
  });

  const isFull = seatCount >= maxSeats;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>+ Invite Member</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Email Address</Label>
            <Input
              type="email"
              placeholder="colleague@lawfirm.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError("");
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Role</Label>
            <div className="flex gap-2">
              {currentUserRole === "owner" && (
                <button
                  onClick={() => setRole("admin")}
                  className={cn(
                    "flex-1 rounded-lg border p-3 text-center transition-colors",
                    role === "admin"
                      ? "border-indigo-500 bg-indigo-950/50"
                      : "border-zinc-700 hover:border-zinc-600",
                  )}
                >
                  <div className="text-sm font-medium">Admin</div>
                  <div className="text-xs text-zinc-500 mt-1">Manage team & all cases</div>
                </button>
              )}
              <button
                onClick={() => setRole("member")}
                className={cn(
                  "flex-1 rounded-lg border p-3 text-center transition-colors",
                  role === "member"
                    ? "border-indigo-500 bg-indigo-950/50"
                    : "border-zinc-700 hover:border-zinc-600",
                )}
              >
                <div className="text-sm font-medium">Member</div>
                <div className="text-xs text-zinc-500 mt-1">Work on assigned cases</div>
              </button>
            </div>
          </div>

          <div className="rounded-lg bg-zinc-900 p-3 flex items-center gap-3">
            <span className="text-sm text-zinc-400">
              Seats: <span className="text-zinc-200">{seatCount}</span> / <span className="text-zinc-200">{maxSeats}</span>
            </span>
            <div className="flex-1 h-1 rounded bg-zinc-700 overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded"
                style={{ width: `${Math.min(100, (seatCount / maxSeats) * 100)}%` }}
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          {isFull && (
            <p className="text-sm text-amber-400">
              Seat limit reached. Upgrade your plan for more seats.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => invite.mutate({ email, role })}
              disabled={invite.isPending || !email || isFull}
            >
              {invite.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Send Invite
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
