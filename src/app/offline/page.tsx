import type { Metadata } from "next";
import { OfflineRetryButton } from "@/components/pwa/offline-retry-button";

export const metadata: Metadata = {
  title: "Offline — ClearTerms",
  description: "You are currently offline.",
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md space-y-4">
        <h1 className="text-3xl font-semibold">You&apos;re offline</h1>
        <p className="text-muted-foreground">
          ClearTerms can&apos;t reach the network right now. Pages you&apos;ve
          recently visited may still be available from cache.
        </p>
        <p className="text-sm text-muted-foreground">
          Try the dashboard, your cases list, or recent case detail pages —
          they&apos;re cached for read-only access.
        </p>
        <OfflineRetryButton />
      </div>
    </main>
  );
}
