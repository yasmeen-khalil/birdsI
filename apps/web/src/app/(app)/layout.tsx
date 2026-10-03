import type { ReactNode } from "react";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <div className="paper flex min-h-screen flex-col">{children}</div>;
}
