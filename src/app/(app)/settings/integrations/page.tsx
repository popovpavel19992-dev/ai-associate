"use client";

import { useState } from "react";
import { Calendar, Copy, RefreshCw, Unplug, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// ── Provider Cards ──────────────────────────────────────────────────────────

function ProviderIcon({ provider }: { provider: "google" | "outlook" }) {
  if (provider === "google") {
    return (
      <span className="flex size-8 items-center justify-center rounded-full bg-white text-sm font-bold text-zinc-900 ring-1 ring-zinc-700">
        G
      </span>
    );
  }
  return (
    <span className="flex size-8 items-center justify-center rounded-full bg-[#0078d4] ring-1 ring-zinc-700">
      <Calendar className="size-4 text-white" />
    </span>
  );
}

interface ProviderCardProps {
  provider: "google" | "outlook";
  label: string;
  connectHref: string;
  connection?: {
    id: string;
    providerEmail: string | null;
    eventCount: number;
    lastSyncAt: Date | null;
  };
  onDisconnect: (connectionId: string) => void;
  isDisconnecting: boolean;
}

function ProviderCard({
  provider,
  label,
  connectHref,
  connection,
  onDisconnect,
  isDisconnecting,
}: ProviderCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <Card className="border-zinc-800 bg-zinc-900">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ProviderIcon provider={provider} />
            <CardTitle className="text-base text-zinc-100">{label}</CardTitle>
          </div>
          {connection ? (
            <Badge className="bg-green-500/15 text-green-400 ring-0">
              Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="border-zinc-700 text-zinc-400">
              Not Connected
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {connection ? (
          <>
            <div className="space-y-1 text-sm">
              {connection.providerEmail && (
                <p className="text-zinc-300">{connection.providerEmail}</p>
              )}
              <p className="text-zinc-500">
                {connection.eventCount} event
                {connection.eventCount !== 1 ? "s" : ""} synced
                {connection.lastSyncAt && (
                  <>
                    {" · last synced "}
                    {new Date(connection.lastSyncAt).toLocaleDateString(
                      undefined,
                      { month: "short", day: "numeric", year: "numeric" }
                    )}
                  </>
                )}
              </p>
            </div>

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <DialogTrigger
                render={
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5"
                    disabled={isDisconnecting}
                  />
                }
              >
                {isDisconnecting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Unplug className="size-3.5" />
                )}
                Disconnect
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Disconnect {label}?</DialogTitle>
                  <DialogDescription>
                    Calendar sync will stop immediately. Any existing synced
                    events will remain on your calendar but will no longer be
                    updated.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      onDisconnect(connection.id);
                      setConfirmOpen(false);
                    }}
                    disabled={isDisconnecting}
                  >
                    {isDisconnecting ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : null}
                    Disconnect
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        ) : (
          <a
            href={connectHref}
            className={buttonVariants({ size: "sm" })}
          >
            Connect {label}
          </a>
        )}
      </CardContent>
    </Card>
  );
}

// ── iCal Feed Section ────────────────────────────────────────────────────────

function IcalFeedSection() {
  const { data: feed, isLoading } = trpc.calendarConnections.getIcalFeed.useQuery();
  const utils = trpc.useUtils();
  const [regenOpen, setRegenOpen] = useState(false);

  const regenerate = trpc.calendarConnections.regenerateIcalToken.useMutation({
    onSuccess: () => {
      utils.calendarConnections.getIcalFeed.invalidate();
      toast.success("iCal token regenerated. Update your calendar app with the new URL.");
      setRegenOpen(false);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  if (isLoading) {
    return (
      <Card className="border-zinc-800 bg-zinc-900">
        <CardContent className="flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-zinc-500" />
        </CardContent>
      </Card>
    );
  }

  if (!feed) {
    return (
      <Card className="border-zinc-800 bg-zinc-900">
        <CardContent className="py-6">
          <p className="text-sm text-zinc-500">iCal feed not available.</p>
        </CardContent>
      </Card>
    );
  }

  const feedUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/ical/${feed.token}`
      : `/api/ical/${feed.token}`;

  const handleCopy = () => {
    navigator.clipboard
      .writeText(feedUrl)
      .then(() => toast.success("Feed URL copied to clipboard."))
      .catch(() => toast.error("Failed to copy URL."));
  };

  return (
    <Card className="border-zinc-800 bg-zinc-900">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-zinc-100">iCal Feed</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-zinc-400">
          Subscribe to your ClearTerms calendar events in any app that supports
          iCal / ICS feeds (Apple Calendar, Google Calendar, Outlook, etc.).
        </p>

        <div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2">
          <code className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-zinc-300">
            {feedUrl}
          </code>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleCopy}
            className="shrink-0 text-zinc-400 hover:text-zinc-100"
          >
            <Copy className="size-4" />
            <span className="sr-only">Copy URL</span>
          </Button>
        </div>

        <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
          <DialogTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
              />
            }
          >
            <RefreshCw className="size-3.5" />
            Regenerate Token
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Regenerate iCal Token?</DialogTitle>
              <DialogDescription>
                Your current feed URL will stop working immediately. You will
                need to re-subscribe using the new URL in all calendar apps.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="destructive"
                onClick={() => regenerate.mutate()}
                disabled={regenerate.isPending}
              >
                {regenerate.isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                Regenerate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const { data: connections, isLoading } =
    trpc.calendarConnections.list.useQuery();
  const utils = trpc.useUtils();

  const disconnect = trpc.calendarConnections.disconnect.useMutation({
    onSuccess: () => {
      utils.calendarConnections.list.invalidate();
      toast.success("Calendar disconnected.");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const getConnection = (provider: "google" | "outlook") => {
    const item = connections?.find((c) => c.connection.provider === provider);
    if (!item) return undefined;
    return {
      id: item.connection.id,
      providerEmail: item.connection.providerEmail,
      eventCount: item.eventCount,
      lastSyncAt: item.lastSyncAt,
    };
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
          Integrations
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Connect your calendar to automatically sync case deadlines and events.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Calendar Providers
        </h2>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-6 animate-spin text-zinc-500" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <ProviderCard
              provider="google"
              label="Google Calendar"
              connectHref="/api/auth/google/connect"
              connection={getConnection("google")}
              onDisconnect={(id) => disconnect.mutate({ connectionId: id })}
              isDisconnecting={disconnect.isPending}
            />
            <ProviderCard
              provider="outlook"
              label="Outlook Calendar"
              connectHref="/api/auth/outlook/connect"
              connection={getConnection("outlook")}
              onDisconnect={(id) => disconnect.mutate({ connectionId: id })}
              isDisconnecting={disconnect.isPending}
            />
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          iCal / ICS Feed
        </h2>
        <IcalFeedSection />
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          E-Signature
        </h2>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">DS</span>
              Dropbox Sign
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Send documents for e-signature with your own Dropbox Sign account.
            </p>
            <a className={buttonVariants({ variant: "outline" })} href="/settings/integrations/dropbox-sign">
              Configure
            </a>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
