"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PortalLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [error, setError] = useState("");

  const sendCode = trpc.portalAuth.sendCode.useMutation({
    onSuccess: () => setStep("code"),
    onError: (err) => setError(err.message),
  });

  const verifyCode = trpc.portalAuth.verifyCode.useMutation({
    onSuccess: async (data) => {
      // Set cookie via API route to enable httpOnly
      await fetch("/api/portal/set-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.token }),
      });
      router.push("/portal");
    },
    onError: (err) => setError(err.message),
  });

  return (
    <div className="mx-auto flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-2xl font-bold">ClearTerms</h1>
          <p className="text-sm text-zinc-500">Client Portal</p>
        </div>

        <div className="rounded-lg border bg-zinc-900 p-6">
          {step === "email" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError("");
                sendCode.mutate({ email });
              }}
              className="space-y-4"
            >
              <div className="text-left">
                <label className="text-xs text-zinc-400">Email address</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="john@example.com"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={sendCode.isPending}>
                {sendCode.isPending ? "Sending..." : "Send Code"}
              </Button>
              <p className="text-xs text-zinc-500">We'll send a 6-digit code to your email</p>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError("");
                verifyCode.mutate({ email, code });
              }}
              className="space-y-4"
            >
              <p className="text-sm text-zinc-400">
                Enter the code sent to <span className="text-white">{email}</span>
              </p>
              <Input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="text-center text-2xl tracking-widest"
                required
              />
              <Button type="submit" className="w-full" disabled={verifyCode.isPending}>
                {verifyCode.isPending ? "Verifying..." : "Verify"}
              </Button>
              <button
                type="button"
                onClick={() => { setStep("email"); setCode(""); setError(""); }}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Use a different email
              </button>
            </form>
          )}

          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}
