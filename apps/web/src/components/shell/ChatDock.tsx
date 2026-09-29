"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { MessageSquare } from "lucide-react";
import { ChatPanel, type ChatPanelData } from "../ChatPanel";
import { icon, icon20 } from "../icon";

interface DockState {
  repoId: string;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DockContext = createContext<DockState | null>(null);

/**
 * Holds the "Ask birdsI" panel. On wide screens it docks on the right,
 * beside its button, and the page narrows; on phones the button opens the
 * chat page instead.
 */
export function ChatDock({ repoId, topbar, chat, children }: { repoId: string; topbar: ReactNode; chat: ChatPanelData; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const onChatPage = pathname.startsWith(`/app/${repoId}/chat`);
  const showDock = open && !onChatPage;
  return (
    <DockContext.Provider value={{ repoId, open: showDock, setOpen }}>
      {topbar}
      <div className="grid flex-grow" style={{ gridTemplateColumns: showDock ? "minmax(0, 1fr) min(540px, 42vw)" : "minmax(0, 1fr)" }}>
        <div className="min-w-0">{children}</div>
        {showDock && (
          <aside
            aria-label="Ask birdsI"
            className="slide-in-right flex min-h-0 flex-col max-[900px]:fixed! max-[900px]:inset-0! max-[900px]:z-50! max-[900px]:h-auto!"
            style={{ position: "sticky", top: 60, height: "calc(100vh - 60px)", borderLeft: "1px solid var(--line-strong)", background: "var(--surface)" }}
          >
            <ChatPanel data={chat} onClose={() => setOpen(false)} />
          </aside>
        )}
      </div>
    </DockContext.Provider>
  );
}

/** Opens the docked chat on wide screens; a plain link to the chat page everywhere else. */
export function AskButton({ repoId, iconOnly = false }: { repoId: string; iconOnly?: boolean }) {
  const dock = useContext(DockContext);
  const pathname = usePathname();
  const href = `/app/${repoId}/chat`;
  const onChatPage = pathname.startsWith(href);
  const active = dock?.open || onChatPage;
  return (
    <Link
      href={href}
      className={iconOnly ? "btn btn-quiet" : "btn btn-secondary btn-sm"}
      aria-label={iconOnly ? "Ask birdsI" : undefined}
      aria-expanded={dock && !onChatPage ? dock.open : undefined}
      style={iconOnly ? { width: 44, height: 44, padding: 0 } : active ? { background: "var(--raised)", borderColor: "var(--text-2)" } : undefined}
      onClick={(e) => {
        if (!dock || onChatPage || iconOnly) return;
        if (window.matchMedia("(min-width: 901px)").matches) {
          e.preventDefault();
          dock.setOpen(!dock.open);
        }
      }}
    >
      {iconOnly ? <MessageSquare {...icon20} /> : <MessageSquare {...icon} />}
      {!iconOnly && "Ask birdsI"}
    </Link>
  );
}
