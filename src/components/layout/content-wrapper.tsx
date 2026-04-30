"use client";

import { usePathname } from "next/navigation";

export function ContentWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFullBleed = pathname?.startsWith("/research") ?? false;
  return isFullBleed ? (
    <>{children}</>
  ) : (
    <div className="mx-auto max-w-5xl px-4 py-6 pt-16 sm:px-6 sm:py-8 lg:pt-8">
      {children}
    </div>
  );
}
