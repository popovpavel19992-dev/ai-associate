import { eq } from "drizzle-orm";
import { jwtVerify } from "jose";
import { db } from "@/server/db";
import { portalNotificationSignals } from "@/server/db/schema/portal-notifications";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const token = cookieHeader
    .split(";")
    .find((c) => c.trim().startsWith("portal_token="))
    ?.split("=")[1]
    ?.trim();

  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  let portalUserId: string;
  try {
    const secret = new TextEncoder().encode(process.env.PORTAL_JWT_SECRET!);
    const { payload } = await jwtVerify(token, secret);
    portalUserId = payload.sub as string;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let lastSignalAt: Date | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode("retry: 3000\n\n"));

      const interval = setInterval(async () => {
        try {
          const [signal] = await db
            .select({ updatedAt: portalNotificationSignals.updatedAt })
            .from(portalNotificationSignals)
            .where(eq(portalNotificationSignals.portalUserId, portalUserId))
            .limit(1);

          if (signal && (!lastSignalAt || signal.updatedAt > lastSignalAt)) {
            lastSignalAt = signal.updatedAt;
            controller.enqueue(encoder.encode("event: notification\ndata: {}\n\n"));
          }
        } catch {
          // Swallow DB errors to keep stream alive
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
