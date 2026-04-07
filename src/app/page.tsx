import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-4xl font-bold tracking-tight">ClearTerms</h1>
      <p className="max-w-md text-center text-zinc-500">
        AI-powered case summarization for legal professionals.
      </p>
      <div className="flex gap-3">
        <Link
          href="/sign-in"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Sign In
        </Link>
        <Link href="/sign-up" className={cn(buttonVariants())}>
          Get Started
        </Link>
      </div>
    </div>
  );
}
