import { createClient } from "@supabase/supabase-js";

let _client: ReturnType<typeof createClient> | undefined;

/**
 * Returns a Supabase browser client for Realtime subscriptions.
 * Lazily instantiated and cached.
 */
export function getSupabaseBrowserClient() {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }

    _client = createClient(url, key, {
      realtime: { params: { eventsPerSecond: 2 } },
    });
  }

  return _client;
}
