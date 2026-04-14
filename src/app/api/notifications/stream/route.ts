import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema/users";
import { notificationSignals } from "@/server/db/schema/notifications";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (!user) {
    return new Response("User not found", { status: 404 });
  }

  const userId = user.id;
  const encoder = new TextEncoder();
  let lastSignalAt: Date | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode("retry: 3000\n\n"));

      const interval = setInterval(async () => {
        try {
          const [signal] = await db
            .select({ lastSignalAt: notificationSignals.lastSignalAt })
            .from(notificationSignals)
            .where(eq(notificationSignals.userId, userId))
            .limit(1);

          if (signal && (!lastSignalAt || signal.lastSignalAt > lastSignalAt)) {
            lastSignalAt = signal.lastSignalAt;
            controller.enqueue(encoder.encode("event: notification\ndata: {}\n\n"));
          }
        } catch {
          // Swallow — connection cleaned up naturally
        }
      }, 2000);

      const cleanup = () => {
        clearInterval(interval);
        try { controller.close(); } catch { /* already closed */ }
      };

      setTimeout(cleanup, (maxDuration - 10) * 1000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
