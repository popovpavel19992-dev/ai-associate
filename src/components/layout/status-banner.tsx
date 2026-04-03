"use client";

import { AlertTriangle, XCircle } from "lucide-react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { PLAN_LIMITS } from "@/lib/constants";
import type { Plan } from "@/lib/types";

export function StatusBanner() {
  const { data: usage } = trpc.subscriptions.getUsage.useQuery(undefined, {
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  if (!usage) return null;

  const limit = PLAN_LIMITS[usage.plan as Plan]?.credits ?? 3;
  const isLow = limit !== Infinity && usage.creditsUsed >= limit * 0.8;
  const isExhausted = limit !== Infinity && usage.creditsUsed >= limit;
  const paymentFailed = usage.subscriptionStatus === "past_due";

  if (paymentFailed) {
    return (
      <div className="flex items-center gap-2 bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        <XCircle className="h-4 w-4 shrink-0" />
        <span>
          Payment failed. Please{" "}
          <Link href="/settings/billing" className="font-medium underline">
            update your billing info
          </Link>{" "}
          to avoid service interruption.
        </span>
      </div>
    );
  }

  if (isExhausted) {
    return (
      <div className="flex items-center gap-2 bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        <XCircle className="h-4 w-4 shrink-0" />
        <span>
          Credits exhausted.{" "}
          <Link href="/settings/billing" className="font-medium underline">
            Upgrade your plan
          </Link>{" "}
          to continue analyzing cases.
        </span>
      </div>
    );
  }

  if (isLow) {
    return (
      <div className="flex items-center gap-2 bg-amber-50 px-4 py-2 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          Running low on credits ({usage.creditsUsed}/{limit} used).{" "}
          <Link href="/settings/billing" className="font-medium underline">
            Upgrade
          </Link>
        </span>
      </div>
    );
  }

  return null;
}
