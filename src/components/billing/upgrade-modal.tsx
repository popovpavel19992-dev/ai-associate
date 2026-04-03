"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { PlanCard } from "./plan-card";
import type { Plan } from "@/lib/types";

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlan: Plan;
}

const PLANS = [
  {
    key: "solo" as const,
    name: "Solo Practitioner",
    price: "$49/mo",
    features: [
      "50 credits/month",
      "Up to 10 docs per case",
      "50 chat messages per case",
      "60-day retention",
    ],
  },
  {
    key: "small_firm" as const,
    name: "Small Firm",
    price: "$149/mo",
    features: [
      "200 credits/month",
      "Up to 15 docs per case",
      "Unlimited chat",
      "90-day retention",
    ],
  },
  {
    key: "firm_plus" as const,
    name: "Firm Plus",
    price: "$349/mo",
    features: [
      "Unlimited credits",
      "Up to 25 docs per case",
      "Unlimited chat",
      "90-day retention",
      "Priority support",
    ],
  },
];

export function UpgradeModal({ open, onOpenChange, currentPlan }: UpgradeModalProps) {
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const createCheckout = trpc.subscriptions.createCheckout.useMutation();

  async function handleUpgrade(plan: "solo" | "small_firm" | "firm_plus") {
    setLoadingPlan(plan);
    try {
      const { url } = await createCheckout.mutateAsync({ plan });
      if (url) {
        window.location.href = url;
      }
    } finally {
      setLoadingPlan(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upgrade Your Plan</DialogTitle>
          <DialogDescription>
            Choose a plan that fits your practice. All plans include AI-powered case analysis.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-3">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.key}
              name={plan.name}
              price={plan.price}
              features={plan.features}
              isCurrent={currentPlan === plan.key}
              onUpgrade={() => handleUpgrade(plan.key)}
              isLoading={loadingPlan === plan.key}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
