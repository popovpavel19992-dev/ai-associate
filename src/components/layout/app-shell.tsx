import { Sidebar } from "./sidebar";
import { StatusBanner } from "./status-banner";
import { ContentWrapper } from "./content-wrapper";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <StatusBanner />
        <main className="flex-1 overflow-y-auto bg-zinc-50 dark:bg-zinc-950">
          <ContentWrapper>{children}</ContentWrapper>
        </main>
      </div>
    </div>
  );
}
