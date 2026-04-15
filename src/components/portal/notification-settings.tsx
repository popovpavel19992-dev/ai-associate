"use client";

import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

const TYPE_LABELS: Record<string, string> = {
  message_received: "New message from attorney",
  document_uploaded: "New document uploaded",
  invoice_sent: "Invoice sent",
  case_stage_changed: "Case stage changed",
  task_assigned: "Task assigned",
  event_reminder: "Event reminder",
  payment_confirmed: "Payment confirmed",
};

export function NotificationSettings() {
  const utils = trpc.useUtils();
  const { data: prefs, isLoading } = trpc.portalNotificationPreferences.list.useQuery();

  const updateMutation = trpc.portalNotificationPreferences.update.useMutation({
    onSuccess: () => utils.portalNotificationPreferences.list.invalidate(),
  });

  const resetMutation = trpc.portalNotificationPreferences.resetDefaults.useMutation({
    onSuccess: () => utils.portalNotificationPreferences.list.invalidate(),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email Notifications</CardTitle>
        <CardDescription>Choose which notifications you receive by email</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {prefs?.map((pref) => (
          <div key={pref.type} className="flex items-center justify-between">
            <span className="text-sm">{TYPE_LABELS[pref.type] ?? pref.type}</span>
            <Button
              variant={pref.emailEnabled ? "default" : "outline"}
              size="sm"
              onClick={() =>
                updateMutation.mutate({ type: pref.type as any, emailEnabled: !pref.emailEnabled })
              }
            >
              {pref.emailEnabled ? "On" : "Off"}
            </Button>
          </div>
        ))}
        <div className="pt-4 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={() => resetMutation.mutate()}
            disabled={resetMutation.isPending}
          >
            Reset to Defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
