import { vi } from "vitest";

// Mock environment variables for tests
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://localhost:5432/clearterms_test";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.COURTLISTENER_API_TOKEN = "test-token";
process.env.RESEND_API_KEY = "";
process.env.AWS_S3_BUCKET = "test-bucket";
process.env.AWS_REGION = "us-east-1";
process.env.AWS_ACCESS_KEY_ID = "test";
process.env.AWS_SECRET_ACCESS_KEY = "test";
process.env.AWS_KMS_KEY_ID = "test";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_fake";
process.env.GOOGLE_CLOUD_VISION_KEY = "test";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_fake";
process.env.CLERK_SECRET_KEY = "sk_test_fake";
process.env.CLERK_WEBHOOK_SECRET = "whsec_test";

// Mock external services by default
vi.mock("@/server/services/s3", () => ({
  getPresignedUploadUrl: vi.fn().mockResolvedValue({
    uploadUrl: "https://s3.example.com/upload",
    s3Key: "test/key.pdf",
  }),
  deleteObject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/services/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  sendCaseReadyEmail: vi.fn().mockResolvedValue(undefined),
  sendDocumentFailedEmail: vi.fn().mockResolvedValue(undefined),
  sendCreditsLowEmail: vi.fn().mockResolvedValue(undefined),
  sendCreditsExhaustedEmail: vi.fn().mockResolvedValue(undefined),
  sendPaymentFailedEmail: vi.fn().mockResolvedValue(undefined),
  sendAutoDeleteWarningEmail: vi.fn().mockResolvedValue(undefined),
}));
