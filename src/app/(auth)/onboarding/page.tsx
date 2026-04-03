import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding/wizard";

export default async function OnboardingPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">
            Welcome to ClearTerms
          </h1>
          <p className="mt-2 text-zinc-500">
            Let&apos;s set up your profile to personalize your experience.
          </p>
        </div>
        <OnboardingWizard />
      </div>
    </div>
  );
}
