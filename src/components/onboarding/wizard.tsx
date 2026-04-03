"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import type { PRACTICE_AREAS, CASE_TYPES, US_STATES } from "@/lib/constants";
import { StepPracticeAreas } from "./step-practice-areas";
import { StepJurisdiction } from "./step-jurisdiction";
import { StepCaseTypes } from "./step-case-types";

type PracticeArea = (typeof PRACTICE_AREAS)[number];
type CaseType = (typeof CASE_TYPES)[number];
type USState = (typeof US_STATES)[number];

const TOTAL_STEPS = 3;

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);

  const [practiceAreas, setPracticeAreas] = useState<string[]>([]);
  const [state, setState] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [caseTypes, setCaseTypes] = useState<string[]>([]);
  const [tosAccepted, setTosAccepted] = useState(false);

  const completeOnboarding = trpc.users.completeOnboarding.useMutation({
    onSuccess: () => router.push("/dashboard"),
  });

  const canProceed = () => {
    switch (step) {
      case 1:
        return practiceAreas.length > 0;
      case 2:
        return state !== "" && jurisdiction.trim() !== "";
      case 3:
        return caseTypes.length > 0 && tosAccepted;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
    } else {
      completeOnboarding.mutate({
        practiceAreas: practiceAreas as PracticeArea[],
        state: state as USState,
        jurisdiction,
        caseTypes: caseTypes as CaseType[],
      });
    }
  };

  return (
    <Card className="mx-auto w-full max-w-2xl p-8">
      <div className="mb-8 flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          Step {step} of {TOTAL_STEPS}
        </p>
        <div className="flex gap-1.5">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div
              key={i}
              className={`h-2 w-8 rounded-full transition-colors ${
                i + 1 <= step
                  ? "bg-zinc-900 dark:bg-zinc-50"
                  : "bg-zinc-200 dark:bg-zinc-700"
              }`}
            />
          ))}
        </div>
      </div>

      {step === 1 && (
        <StepPracticeAreas selected={practiceAreas} onChange={setPracticeAreas} />
      )}
      {step === 2 && (
        <StepJurisdiction
          state={state}
          jurisdiction={jurisdiction}
          onStateChange={setState}
          onJurisdictionChange={setJurisdiction}
        />
      )}
      {step === 3 && (
        <StepCaseTypes
          selected={caseTypes}
          tosAccepted={tosAccepted}
          onChange={setCaseTypes}
          onTosChange={setTosAccepted}
        />
      )}

      <div className="mt-8 flex justify-between">
        <Button
          variant="outline"
          onClick={() => setStep(step - 1)}
          disabled={step === 1}
        >
          Back
        </Button>
        <Button
          onClick={handleNext}
          disabled={!canProceed() || completeOnboarding.isPending}
        >
          {completeOnboarding.isPending
            ? "Saving..."
            : step === TOTAL_STEPS
              ? "Get Started"
              : "Continue"}
        </Button>
      </div>
    </Card>
  );
}
