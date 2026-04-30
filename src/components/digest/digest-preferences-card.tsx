"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";

export function DigestPreferencesCard() {
  const utils = trpc.useUtils();
  const { data: prefs, isLoading } = trpc.caseDigest.getPreferences.useQuery();
  const [enabled, setEnabled] = useState(true);
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "off">("daily");
  const [time, setTime] = useState("17:00");
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (prefs) {
      setEnabled(prefs.enabled);
      setFrequency(prefs.frequency);
      setTime(prefs.deliveryTimeUtc);
    }
  }, [prefs]);

  const update = trpc.caseDigest.updatePreferences.useMutation({
    onSuccess: () => utils.caseDigest.getPreferences.invalidate(),
  });

  const sendNow = trpc.caseDigest.sendNow.useMutation();

  const preview = trpc.caseDigest.previewToday.useQuery(undefined, {
    enabled: previewOpen,
  });

  function handleSave() {
    update.mutate({ enabled, frequency, deliveryTimeUtc: time });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Daily Digest</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Enabled</label>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <label className="text-sm font-medium">Frequency</label>
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as "daily" | "weekly" | "off")}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="off">Off</option>
                </select>
              </div>
              <div className="flex items-center justify-between gap-4">
                <label className="text-sm font-medium">Delivery time (UTC)</label>
                <Input
                  type="text"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  pattern="^[0-2][0-9]:[0-5][0-9]$"
                  placeholder="HH:MM"
                  className="w-28"
                />
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button onClick={handleSave} disabled={update.isPending}>
                  {update.isPending ? "Saving..." : "Save preferences"}
                </Button>
                <Button variant="outline" onClick={() => setPreviewOpen(true)}>
                  Preview today's digest
                </Button>
                <Button
                  variant="outline"
                  onClick={() => sendNow.mutate()}
                  disabled={sendNow.isPending}
                >
                  {sendNow.isPending ? "Sending..." : "Send now"}
                </Button>
                <Button variant="ghost" asChild>
                  <Link href="/settings/digest-history">View past digests</Link>
                </Button>
              </div>
              {sendNow.data && (
                <p className="text-xs text-muted-foreground">
                  {sendNow.data.sent
                    ? "Sent."
                    : `Skipped: ${sendNow.data.reason ?? "unknown"}`}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Today's digest preview</DialogTitle>
          </DialogHeader>
          {preview.isLoading ? (
            <p className="text-sm text-muted-foreground">Generating preview...</p>
          ) : preview.data ? (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto text-sm">
              <div className="rounded border-l-4 border-zinc-900 bg-zinc-50 p-3 whitespace-pre-wrap">
                {preview.data.commentary}
              </div>
              <div>
                <strong>Total items:</strong> {preview.data.payload.totalActionItems}
              </div>
              <pre className="rounded bg-zinc-100 p-3 text-xs overflow-x-auto">
                {JSON.stringify(preview.data.payload, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No data.</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
