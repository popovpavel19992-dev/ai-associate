import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/api/inngest(.*)",
  "/api/ical(.*)",
  "/api/auth/google/callback",
  "/api/auth/outlook/callback",
  "/api/portal(.*)",
  "/intake(.*)",
  "/api/public-intake(.*)",
]);

async function portalMiddleware(req: NextRequest) {
  const token = req.cookies.get("portal_token")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/portal/login", req.url));
  }
  try {
    const secret = new TextEncoder().encode(process.env.PORTAL_JWT_SECRET!);
    await jwtVerify(token, secret);
    return NextResponse.next();
  } catch {
    const response = NextResponse.redirect(new URL("/portal/login", req.url));
    response.cookies.delete("portal_token");
    return response;
  }
}
// Note (H6): This middleware only checks JWT validity for performance — it does NOT verify
// the session exists in the DB. The real authorization check happens in portalProcedure (Task 5),
// which verifies the session is active and the portal user is enabled.

export default async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/portal")) {
    if (req.nextUrl.pathname.startsWith("/portal/login")) {
      return NextResponse.next();
    }
    return portalMiddleware(req);
  }

  // Existing clerk middleware
  return clerkMiddleware(async (auth, req) => {
    if (!isPublicRoute(req)) {
      await auth.protect();
    }
  })(req as any, {} as any);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
