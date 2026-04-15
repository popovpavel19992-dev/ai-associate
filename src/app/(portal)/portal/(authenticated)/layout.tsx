import { PortalShell } from "@/components/portal/portal-shell";

export default function PortalAuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}
