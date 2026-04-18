import { Suspense } from "react";
import { PortalLoginForm } from "@/components/portal/login-form";

export default function PortalLoginPage() {
  return (
    <Suspense>
      <PortalLoginForm />
    </Suspense>
  );
}
