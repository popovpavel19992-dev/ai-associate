import { TRPCProvider } from "@/lib/trpc";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <TRPCProvider>{children}</TRPCProvider>;
}
