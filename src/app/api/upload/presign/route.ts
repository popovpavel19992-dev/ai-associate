import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { db } from "@/server/db";
import { users } from "@/server/db/schema/users";
import { eq } from "drizzle-orm";
import {
  generatePresignedUrl,
  validateFileForUpload,
  contentTypeToFileType,
} from "@/server/services/s3";

const presignRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
  fileSize: z.number().int().positive(),
  caseId: z.string().uuid(),
});

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = presignRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { filename, contentType, fileSize } = parsed.data;

  try {
    validateFileForUpload(contentType, fileSize);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid file" },
      { status: 400 },
    );
  }

  const { uploadUrl, s3Key } = await generatePresignedUrl(
    user.id,
    filename,
    contentType,
    fileSize,
  );

  return Response.json({
    uploadUrl,
    s3Key,
    fileType: contentTypeToFileType(contentType),
  });
}
