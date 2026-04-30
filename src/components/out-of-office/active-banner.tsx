// src/components/out-of-office/active-banner.tsx
//
// Phase 3.14 — Dashboard banner shown when the current user has an active OOO.
"use client";

import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

export function ActiveOooBanner() {
  const utils = trpc.useUtils();
  const { data } = trpc.outOfOffice.getActive.useQuery();
  const cancelMut = trpc.outOfOffice.cancel.useMutation({
    onSuccess: () => {
      utils.outOfOffice.getActive.invalidate();
      utils.outOfOffice.list.invalidate();
    },
  });

  if (!data) return null;

  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20">
      <AlertCircle className="size-5 mt-0.5 text-amber-700 dark:text-amber-200" />
      <div className="flex-1">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
          You are out of office until {data.endDate}.
        </p>
        <p className="text-xs text-amber-800 dark:text-amber-200">
          Auto-responses are being sent for your incoming messages.
        </p>
      </div>
      <Link
        href="/settings/out-of-office"
        className="text-xs underline text-amber-900 dark:text-amber-100"
      >
        Manage
      </Link>
      <Button
        size="sm"
        variant="outline"
        onClick={() => cancelMut.mutate({ oooId: data.id })}
        disabled={cancelMut.isPending}
      >
        Cancel OOO Now
      </Button>
    </div>
  );
}
