"use client";

import { useState } from "react";
import { Calendar, Copy, RefreshCw, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function CalendarSyncSettingsPage() {
  const utils = trpc.useUtils();
  const { data: status, isLoading } = trpc.calendarExport.getStatus.useQuery();

  const [revealedUrl, setRevealedUrl] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const generate = trpc.calendarExport.generateToken.useMutation({
    onSuccess: (data) => {
      setRevealedUrl(data.subscribeUrl);
      utils.calendarExport.getStatus.invalidate();
      toast.success("Subscription URL generated. Copy it now — it won't be shown again.");
    },
    onError: (e) => toast.error(e.message),
  });

  const revoke = trpc.calendarExport.revokeToken.useMutation({
    onSuccess: () => {
      setRevealedUrl(null);
      setConfirmRevoke(false);
      utils.calendarExport.getStatus.invalidate();
      toast.success("Calendar subscription revoked.");
    },
    onError: (e) => toast.error(e.message),
  });

  const copyUrl = async () => {
    if (!revealedUrl) return;
    try {
      await navigator.clipboard.writeText(revealedUrl);
      toast.success("Copied to clipboard.");
    } catch {
      toast.error("Could not copy — please copy manually.");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Calendar Sync</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Subscribe to a personal iCal feed that pulls deadlines, hearings, depositions,
          mediations, and filings across all your cases into Apple Calendar, Google
          Calendar, or Outlook.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Calendar Subscription
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">Status</span>
                  {status?.hasToken ? (
                    <Badge className="bg-green-500/15 text-green-600 ring-0 dark:text-green-400">
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Not generated
                    </Badge>
                  )}
                </div>
                {status?.createdAt && (
                  <span className="text-xs text-muted-foreground">
                    Created {new Date(status.createdAt).toLocaleDateString()}
                  </span>
                )}
              </div>

              {revealedUrl && (
                <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-700/60 dark:bg-amber-950/40">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <div className="text-sm">
                      <p className="font-semibold">
                        Copy this URL now — it will not be shown again.
                      </p>
                      <p className="text-muted-foreground">
                        Anyone with this link can read your full calendar. Treat it like
                        a password.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-900">
                      {revealedUrl}
                    </code>
                    <Button size="sm" variant="outline" onClick={copyUrl}>
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      Copy
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => generate.mutate()}
                  disabled={generate.isPending}
                >
                  {generate.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  {status?.hasToken ? "Regenerate URL" : "Generate URL"}
                </Button>
                {status?.hasToken && (
                  <Button
                    variant="outline"
                    onClick={() => setConfirmRevoke(true)}
                    disabled={revoke.isPending}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Revoke
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How to subscribe</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 text-sm">
          <section>
            <h3 className="font-semibold">Apple Calendar (macOS)</h3>
            <ol className="mt-1 list-inside list-decimal space-y-1 text-muted-foreground">
              <li>Open Calendar → File → New Calendar Subscription…</li>
              <li>Paste the URL above and click Subscribe.</li>
              <li>Set Auto-refresh to Every 15 minutes (recommended).</li>
            </ol>
          </section>
          <section>
            <h3 className="font-semibold">Google Calendar</h3>
            <ol className="mt-1 list-inside list-decimal space-y-1 text-muted-foreground">
              <li>Open calendar.google.com → Other calendars → + → From URL.</li>
              <li>Paste the URL above and click Add calendar.</li>
              <li>Google polls every few hours; updates may take time to appear.</li>
            </ol>
          </section>
          <section>
            <h3 className="font-semibold">Outlook (Microsoft 365)</h3>
            <ol className="mt-1 list-inside list-decimal space-y-1 text-muted-foreground">
              <li>Outlook on the web → Calendar → Add calendar → Subscribe from web.</li>
              <li>Paste the URL above, name it "ClearTerms", click Import.</li>
            </ol>
          </section>
          <p className="text-xs text-muted-foreground">
            The feed includes upcoming deadlines, mediation sessions, depositions, and
            recent filings across every case you have access to. Past events older than
            30 days are excluded.
          </p>
        </CardContent>
      </Card>

      <Dialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke calendar subscription?</DialogTitle>
            <DialogDescription>
              The current URL will stop working immediately. Any subscribed calendars
              will fail to refresh until you generate a new URL.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevoke(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => revoke.mutate()}
              disabled={revoke.isPending}
            >
              {revoke.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
