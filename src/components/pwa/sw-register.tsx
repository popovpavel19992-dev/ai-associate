"use client";

import { useEffect } from "react";

/**
 * Registers the static service worker at /sw.js.
 * No-op on browsers without service worker support, on the server, and on http (non-localhost).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const isLocalhost =
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1");
    if (
      typeof window !== "undefined" &&
      window.location.protocol !== "https:" &&
      !isLocalhost
    ) {
      return;
    }

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => {
        console.warn("[sw] registration failed", err);
      });
  }, []);

  return null;
}
