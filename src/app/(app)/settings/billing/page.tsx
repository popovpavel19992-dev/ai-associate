"use client";

import { trpc } from "@/lib/trpc";
import { UsageBar } from "@/components/billing/usage-bar";
import { PlanCard } from "@/components/billing/plan-card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

const PLANS = [
  { key: "trial" as const, name: "Trial", price: "Free", features: ["3 credits/month", "3 docs per case", "10 chat messages per case"] },
  { key: "solo" as const, name: "Solo", price: "$49/mo", features: ["50 credits/month", "10 docs per case", "50 chat messages per case"] },
  { key: "small_firm" as const, name: "Small Firm", price: "$199/mo", features: ["200 credits/month", "15 docs per case", "Unlimited chat"] },
  { key: "firm_plus" as const, name: "Firm+", price: "$499/mo", features: ["Unlimited credits", "25 docs per case", "Unlimited chat", "Priority support"] },
];

export default function BillingPage() {
  const { data: usage, isLoading } = trpc.subscriptions.getUsage.useQuery();
  const checkout = trpc.subscriptions.createCheckout.useMutation({
    onSuccess: (data) => { if (data.url) window.location.href = data.url; },
  });
  const portal = trpc.subscriptions.createPortalSession.useMutation({
    onSuccess: (data) => { if (data.url) window.location.href = data.url; },
  });

  if (isLoading || !usage) {
    return <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your subscription and usage.</p>
      </div>

      <UsageBar used={usage.creditsUsed} limit={usage.creditsLimit} />

      {usage.plan !== "trial" && (
        <Button variant="outline" onClick={() => portal.mutate()} disabled={portal.isPending}>
          {portal.isPending ? "Redirecting..." : "Manage Subscription"}
        </Button>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((p) => (
          <PlanCard
            key={p.key}
            name={p.name}
            price={p.price}
            features={p.features}
            isCurrent={usage.plan === p.key}
            onUpgrade={p.key !== "trial" && p.key !== usage.plan ? () => checkout.mutate({ plan: p.key as "solo" | "small_firm" | "firm_plus" }) : undefined}
            isLoading={checkout.isPending}
          />
        ))}
      </div>
    </div>
  );
}
