import { SignJWT, jwtVerify } from "jose";
import { createHash, randomInt } from "crypto";

const getSecret = () => new TextEncoder().encode(process.env.PORTAL_JWT_SECRET!);

export interface PortalJwtPayload {
  sub: string; // portalUserId
  sessionId: string;
  clientId: string;
  orgId: string | null;
}

export async function signPortalJwt(payload: PortalJwtPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .setIssuedAt()
    .sign(getSecret());
}

export async function verifyPortalJwt(token: string): Promise<PortalJwtPayload> {
  const { payload } = await jwtVerify(token, getSecret());
  return payload as unknown as PortalJwtPayload;
}

export function generateMagicCode(): { code: string; hash: string } {
  const code = String(randomInt(100000, 999999));
  const hash = createHash("sha256").update(code).digest("hex");
  return { code, hash };
}

export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}
