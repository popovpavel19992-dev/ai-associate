import React, { useState } from 'react';
import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import superjson from 'superjson';
import { useAuth } from '@clerk/clerk-expo';

/**
 * AppRouter type bridge.
 *
 * Importing the server's `AppRouter` from `../../src/server/trpc/root` pulls
 * every server router source file into mobile's TypeScript program, which
 * then fails on Drizzle and `@/server/*` path aliases that only resolve in
 * the Next.js context. End-to-end inference will be wired up later by either
 * emitting `.d.ts` artifacts from the server or moving the API into a shared
 * workspace package.
 *
 * For the skeleton we cast to `any` here. Runtime behavior is unaffected —
 * superjson + httpBatchLink work regardless of compile-time inference.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const trpc: any = createTRPCReact<any>();

function getApiUrl(): string {
  const url = process.env.EXPO_PUBLIC_API_URL;
  if (url && url.length > 0) return url;
  // Sensible default for iOS simulator / web dev.
  return 'http://localhost:3000';
}

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getApiUrl()}/api/trpc`,
          transformer: superjson,
          async headers() {
            try {
              const token = await getToken();
              return token ? { Authorization: `Bearer ${token}` } : {};
            } catch {
              return {};
            }
          },
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
