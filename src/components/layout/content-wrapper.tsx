"use client";

import { usePathname } from "next/navigation";

export function ContentWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFullBleed = pathname?.startsWith("/research") ?? false;
  return isFullBleed ? (
    <>{children}</>
  ) : (
    <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
  );
}
