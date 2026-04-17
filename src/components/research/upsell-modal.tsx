"use client";

import * as React from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";

interface UpsellModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  used?: number;
  limit?: number;
}

export function UpsellModal({
  open,
  onOpenChange,
  used,
  limit,
}: UpsellModalProps) {
  const hasUsage = typeof used === "number" && typeof limit === "number";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-yellow-500" aria-hidden />
            You&apos;ve reached your monthly AI Q&amp;A limit
          </DialogTitle>
          <DialogDescription>
            {hasUsage
              ? `You've used ${used}/${limit} research queries this month. Upgrade to keep researching.`
              : "You've reached your research query limit for the month. Upgrade to keep researching."}
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-1.5 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span
              aria-hidden
              className="mt-1 size-1.5 shrink-0 rounded-full bg-primary"
            />
            <span>500 queries / month on Pro.</span>
          </li>
          <li className="flex items-start gap-2">
            <span
              aria-hidden
              className="mt-1 size-1.5 shrink-0 rounded-full bg-primary"
            />
            <span>5,000 queries / month on Business.</span>
          </li>
        </ul>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            Close
          </Button>
          <Link
            href="/settings/billing"
            className={buttonVariants({ variant: "default" })}
          >
            Upgrade plan
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
