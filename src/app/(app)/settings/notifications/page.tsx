"use client";

import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { NotificationPreferencesMatrix } from "@/components/notifications/notification-preferences-matrix";
import { PushPermissionPrompt } from "@/components/notifications/push-permission-prompt";

export default function NotificationSettingsPage() {
  const utils = trpc.useUtils();
  const { data: muted = [], isLoading } = trpc.notificationMutes.list.useQuery();

  const unmute = trpc.notificationMutes.unmute.useMutation({
    onSuccess: () => utils.notificationMutes.list.invalidate(),
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Notification Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Control how and when you receive notifications.
        </p>
      </div>

      <PushPermissionPrompt />

      <Card>
        <CardHeader>
          <CardTitle>Notification Preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <NotificationPreferencesMatrix />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Muted Cases</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : muted.length === 0 ? (
            <p className="text-sm text-muted-foreground">No muted cases.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {muted.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between py-2.5"
                >
                  <span className="text-sm">{item.caseName}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => unmute.mutate({ caseId: item.caseId })}
                    disabled={unmute.isPending}
                  >
                    Unmute
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
