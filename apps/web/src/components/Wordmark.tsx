import Link from "next/link";

/** The mark: four rounded bracket corners and a centre dot. */
export function WordmarkMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" className={className}>
      <path d="M1 7V5a4 4 0 0 1 4-4h2" />
      <path d="M13 1h2a4 4 0 0 1 4 4v2" />
      <path d="M19 13v2a4 4 0 0 1-4 4h-2" />
      <path d="M7 19H5a4 4 0 0 1-4-4v-2" />
      <circle cx="10" cy="10" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Wordmark({ href = "/", markOnly = false, size, className }: { href?: string | null; markOnly?: boolean; size?: number; className?: string }) {
  const style = size ? { fontSize: size } : undefined;
  const content = (
    <>
      <WordmarkMark />
      {markOnly ? <span className="sr-only">birdsI</span> : "birdsI"}
    </>
  );
  if (href === null) {
    return (
      <span className={`wm ${className ?? ""}`} style={style}>
        {content}
      </span>
    );
  }
  return (
    <Link className={`wm ${className ?? ""}`} href={href} style={style} aria-label={markOnly ? "birdsI home" : undefined}>
      {content}
    </Link>
  );
}
