"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CounterDialog } from "./counter-dialog";

export function CounterRecommenderButton(props: {
  caseId: string;
  offerId: string;
  offerAmountCents: number;
  betaEnabled: boolean;
  onUseVariant?: (counterCents: number) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!props.betaEnabled) return null;
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
      >
        Get AI counter (2cr)
      </Button>
      <CounterDialog
        open={open}
        onOpenChange={setOpen}
        caseId={props.caseId}
        offerId={props.offerId}
        offerAmountCents={props.offerAmountCents}
        onUseVariant={props.onUseVariant}
      />
    </>
  );
}
