"use client";

import { useMemo } from "react";
import { Loader2, Smartphone, Trash2, Send } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";

function summarizeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome/.test(ua)) {
    return "Mac (Safari)";
  }
  if (/Macintosh/.test(ua) && /Chrome/.test(ua)) return "Mac (Chrome)";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua) && /Edg\//.test(ua)) return "Windows (Edge)";
  if (/Windows/.test(ua) && /Chrome/.test(ua)) return "Windows (Chrome)";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return ua.slice(0, 64);
}

export default function DevicesSettingsPage() {
  const utils = trpc.useUtils();
  const devicesQuery = trpc.pushSubscriptions.listMine.useQuery();
  const sendTest = trpc.pushSubscriptions.sendTest.useMutation({
    onSuccess: (res) => {
      toast.success(
        `Test sent — ${res.sent} delivered${
          res.deactivated ? `, ${res.deactivated} expired endpoint(s) cleaned up` : ""
        }`,
      );
      utils.pushSubscriptions.listMine.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const unsubscribe = trpc.pushSubscriptions.unsubscribe.useMutation({
    onSuccess: () => {
      toast.success("Device removed");
      utils.pushSubscriptions.listMine.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const devices = useMemo(() => devicesQuery.data ?? [], [devicesQuery.data]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Devices</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browsers and installed apps that receive push notifications for your
          account.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => sendTest.mutate()}
          disabled={sendTest.isPending || devices.filter((d) => d.isActive).length === 0}
        >
          {sendTest.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Send test notification
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Subscribed devices</CardTitle>
        </CardHeader>
        <CardContent>
          {devicesQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : devices.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No devices yet. Enable notifications from the dashboard or
              Settings → Notifications to subscribe this device.
            </p>
          ) : (
            <ul className="divide-y">
              {devices.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center gap-3 py-3"
                >
                  <Smartphone className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {summarizeUserAgent(d.userAgent)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      Added {formatDistanceToNow(new Date(d.createdAt), { addSuffix: true })}
                      {d.lastUsedAt
                        ? ` · last used ${formatDistanceToNow(new Date(d.lastUsedAt), { addSuffix: true })}`
                        : " · never used"}
                    </p>
                  </div>
                  {d.isActive ? (
                    <Badge variant="secondary">Active</Badge>
                  ) : (
                    <Badge variant="outline">Inactive</Badge>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      unsubscribe.mutate({ endpoint: d.endpoint })
                    }
                    disabled={unsubscribe.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Remove device</span>
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
