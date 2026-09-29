import type { CSSProperties, ElementType, ReactNode } from "react";

/**
 * Rounded corner brackets, the visual motif. Bend is half the arm unless given.
 * accent is reserved for what birdsI is reading right now.
 */
export function Frame({
  as: Tag = "div",
  arm = 22,
  bend,
  accent = false,
  bracket,
  className,
  style,
  children,
  ...rest
}: {
  as?: ElementType;
  arm?: number;
  bend?: number;
  accent?: boolean;
  bracket?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const vars = {
    "--arm": `${arm}px`,
    "--bend": `${bend ?? Math.round(arm / 2)}px`,
    ...(bracket ? { "--bracket": bracket } : {}),
    ...style,
  } as CSSProperties;
  return (
    <Tag className={`frame${accent ? " accent" : ""}${className ? ` ${className}` : ""}`} style={vars} {...rest}>
      <i className="c tl" aria-hidden="true" />
      <i className="c tr" aria-hidden="true" />
      <i className="c bl" aria-hidden="true" />
      <i className="c br" aria-hidden="true" />
      {children}
    </Tag>
  );
}
