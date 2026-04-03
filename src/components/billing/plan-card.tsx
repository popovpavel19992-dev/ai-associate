"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PlanCardProps {
  name: string;
  price: string;
  features: string[];
  isCurrent: boolean;
  onUpgrade?: () => void;
  isLoading?: boolean;
}

export function PlanCard({
  name,
  price,
  features,
  isCurrent,
  onUpgrade,
  isLoading,
}: PlanCardProps) {
  return (
    <Card className={cn("p-5", isCurrent && "border-primary")}>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">{name}</h3>
        {isCurrent && <Badge>Current</Badge>}
      </div>
      <p className="mt-1 text-2xl font-bold">{price}</p>
      <ul className="mt-4 space-y-2">
        {features.map((f) => (
          <li key={f} className="flex items-center gap-2 text-sm">
            <Check className="size-3.5 text-green-600" />
            {f}
          </li>
        ))}
      </ul>
      {!isCurrent && onUpgrade && (
        <Button className="mt-4 w-full" onClick={onUpgrade} disabled={isLoading}>
          {isLoading ? "Redirecting..." : "Upgrade"}
        </Button>
      )}
    </Card>
  );
}
