import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { MAX_FILE_SIZE } from "@/lib/constants";

const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "image/jpeg",
  "image/png",
]);

const PRESIGN_EXPIRY_SECONDS = 300; // 5 minutes

let _client: S3Client | undefined;

function getClient(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: process.env.AWS_REGION ?? "us-east-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }
  return _client;
}

function getBucket(): string {
  return process.env.AWS_S3_BUCKET!;
}

function getKmsKeyId(): string {
  return process.env.AWS_KMS_KEY_ID!;
}

export function validateFileForUpload(contentType: string, fileSize: number) {
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error(
      `Unsupported file type: ${contentType}. Allowed: PDF, DOCX, JPEG, PNG.`,
    );
  }
  if (fileSize > MAX_FILE_SIZE) {
    throw new Error(
      `File too large: ${(fileSize / 1024 / 1024).toFixed(1)}MB. Maximum: 25MB.`,
    );
  }
  if (fileSize <= 0) {
    throw new Error("File size must be greater than 0.");
  }
}

export function contentTypeToFileType(
  contentType: string,
): "pdf" | "docx" | "image" {
  if (contentType === "application/pdf") return "pdf";
  if (
    contentType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    contentType === "application/msword"
  )
    return "docx";
  return "image";
}

export async function generatePresignedUrl(
  userId: string,
  filename: string,
  contentType: string,
  fileSize: number,
): Promise<{ uploadUrl: string; s3Key: string }> {
  validateFileForUpload(contentType, fileSize);

  const fileId = crypto.randomUUID();
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const s3Key = `documents/${userId}/${fileId}/${sanitizedFilename}`;

  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: s3Key,
    ContentType: contentType,
    ContentLength: fileSize,
    ServerSideEncryption: "aws:kms",
    SSEKMSKeyId: getKmsKeyId(),
  });

  const uploadUrl = await getSignedUrl(getClient(), command, {
    expiresIn: PRESIGN_EXPIRY_SECONDS,
  });

  return { uploadUrl, s3Key };
}

export async function deleteObject(s3Key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: s3Key,
    }),
  );
}

const PROFILE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PROFILE_SIZE_LIMITS: Record<string, number> = {
  avatar: 2 * 1024 * 1024,    // 2MB
  signature: 1 * 1024 * 1024, // 1MB
};

export function validateProfileUpload(
  category: "avatar" | "signature",
  contentType: string,
  fileSize: number,
) {
  if (!PROFILE_IMAGE_TYPES.has(contentType)) {
    throw new Error(`Unsupported image type: ${contentType}. Allowed: JPEG, PNG, WebP.`);
  }
  const maxSize = PROFILE_SIZE_LIMITS[category]!;
  if (fileSize > maxSize) {
    throw new Error(`File too large: ${(fileSize / 1024 / 1024).toFixed(1)}MB. Maximum: ${(maxSize / 1024 / 1024).toFixed(0)}MB.`);
  }
  if (fileSize <= 0) {
    throw new Error("File size must be greater than 0.");
  }
}

export async function generateProfilePresignedUrl(
  userId: string,
  category: "avatar" | "signature",
  filename: string,
  contentType: string,
  fileSize: number,
): Promise<{ uploadUrl: string; s3Key: string }> {
  validateProfileUpload(category, contentType, fileSize);

  const fileId = crypto.randomUUID();
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const s3Key = `profiles/${userId}/${category}/${fileId}/${sanitizedFilename}`;

  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: s3Key,
    ContentType: contentType,
    ContentLength: fileSize,
    ServerSideEncryption: "aws:kms",
    SSEKMSKeyId: getKmsKeyId(),
  });

  const uploadUrl = await getSignedUrl(getClient(), command, {
    expiresIn: PRESIGN_EXPIRY_SECONDS,
  });

  return { uploadUrl, s3Key };
}

export async function getObject(
  s3Key: string,
): Promise<{ body: ReadableStream; contentType?: string }> {
  const response = await getClient().send(
    new GetObjectCommand({
      Bucket: getBucket(),
      Key: s3Key,
    }),
  );

  if (!response.Body) {
    throw new Error(`Empty response for S3 key: ${s3Key}`);
  }

  return {
    body: response.Body.transformToWebStream(),
    contentType: response.ContentType,
  };
}

export async function generateDownloadUrl(s3Key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: s3Key,
  });
  return getSignedUrl(getClient(), command, { expiresIn: PRESIGN_EXPIRY_SECONDS });
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET!,
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  await getClient().send(command);
}

export async function copyObject(srcKey: string, dstKey: string, contentType: string): Promise<void> {
  const bucket = process.env.AWS_S3_BUCKET!;
  const command = new CopyObjectCommand({
    Bucket: bucket,
    CopySource: `${bucket}/${encodeURIComponent(srcKey)}`,
    Key: dstKey,
    ContentType: contentType,
    MetadataDirective: "REPLACE",
  });
  await getClient().send(command);
}
