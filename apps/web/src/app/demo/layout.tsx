import type { ReactNode } from "react";

export default function DemoLayout({ children }: { children: ReactNode }) {
  return <div className="night flex min-h-screen flex-col">{children}</div>;
}
