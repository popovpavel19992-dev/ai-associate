"use client";

import { Button } from "@/components/ui/button";

export function OfflineRetryButton() {
  return (
    <Button
      onClick={() => {
        if (typeof window !== "undefined") window.location.reload();
      }}
    >
      Retry
    </Button>
  );
}
