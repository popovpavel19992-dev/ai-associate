"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const DISMISSED_KEY = "clearterms.pwa.install-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS exposes navigator.standalone; everyone else uses display-mode media query.
  const navStandalone = (navigator as unknown as { standalone?: boolean }).standalone;
  if (navStandalone === true) return true;
  return window.matchMedia?.("(display-mode: standalone)").matches ?? false;
}

/**
 * Non-intrusive PWA install banner.
 * - Chrome / Edge / Android: listens for beforeinstallprompt and offers a button
 * - iOS Safari: shows guided "Tap Share → Add to Home Screen" instructions
 * - Hidden when already installed (standalone) or previously dismissed
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandalone()) return;
    try {
      if (localStorage.getItem(DISMISSED_KEY) === "1") {
        setDismissed(true);
        return;
      }
    } catch {
      // ignore — Safari private mode etc.
    }

    const onBefore = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBefore);

    if (isIOS()) {
      setShowIos(true);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBefore);
    };
  }, []);

  if (dismissed) return null;
  if (!deferred && !showIos) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // ignore
    }
  };

  const handleInstall = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") {
      dismiss();
    }
    setDeferred(null);
  };

  return (
    <div className="relative rounded-lg border bg-card p-4 shadow-sm">
      <button
        type="button"
        aria-label="Dismiss install prompt"
        onClick={dismiss}
        className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-accent"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <Download className="mt-1 h-5 w-5 shrink-0 text-primary" />
        <div className="flex-1 space-y-2">
          <div>
            <p className="font-medium">Install ClearTerms</p>
            <p className="text-sm text-muted-foreground">
              {deferred
                ? "Add ClearTerms to your home screen for quick access and push notifications."
                : "Install ClearTerms on your iPhone or iPad for a full-screen app experience."}
            </p>
          </div>
          {deferred ? (
            <Button size="sm" onClick={handleInstall}>
              Install app
            </Button>
          ) : (
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              Tap <Share className="inline h-4 w-4" /> then{" "}
              <span className="font-medium text-foreground">Add to Home Screen</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
