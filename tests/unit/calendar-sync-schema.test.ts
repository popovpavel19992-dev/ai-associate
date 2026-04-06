import { describe, it, expect } from "vitest";

describe("calendar sync schemas", () => {
  it("imports calendar_connections schema", async () => {
    const mod = await import("@/server/db/schema/calendar-connections");
    expect(mod.calendarConnections).toBeDefined();
    expect(mod.calendarProviderEnum).toBeDefined();
  });
  it("imports ical_feeds schema", async () => {
    const mod = await import("@/server/db/schema/ical-feeds");
    expect(mod.icalFeeds).toBeDefined();
  });
  it("imports calendar_sync_preferences schema", async () => {
    const mod = await import("@/server/db/schema/calendar-sync-preferences");
    expect(mod.calendarSyncPreferences).toBeDefined();
  });
  it("imports ical_feed_preferences schema", async () => {
    const mod = await import("@/server/db/schema/ical-feed-preferences");
    expect(mod.icalFeedPreferences).toBeDefined();
  });
  it("imports calendar_sync_log schema", async () => {
    const mod = await import("@/server/db/schema/calendar-sync-log");
    expect(mod.calendarSyncLog).toBeDefined();
    expect(mod.syncStatusEnum).toBeDefined();
  });
});
