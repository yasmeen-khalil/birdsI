import type { Confidence } from "@birdsi/shared";
import { CONFIDENCE_LABEL } from "./format";

/** Certainty drawn as line: filled, ringed with a source dot, dashed. */
export function ConfidenceGlyph({ confidence, size = 12 }: { confidence: Confidence; size?: number }) {
  return (
    <svg viewBox="0 0 12 12" style={{ width: size, height: size, flex: "none" }} aria-hidden="true" focusable="false">
      {confidence === "proven" && <circle className="g-proven" cx="6" cy="6" r="5" />}
      {confidence === "doc_verified" && (
        <>
          <circle className="g-doc" cx="6" cy="6" r="4.75" />
          <circle className="g-proven" cx="6" cy="6" r="1.75" />
        </>
      )}
      {confidence === "judgment" && <circle className="g-judg" cx="6" cy="6" r="4.75" />}
    </svg>
  );
}

export function ConfidencePill({ confidence, small = false, className }: { confidence: Confidence; small?: boolean; className?: string }) {
  return (
    <span
      className={`conf${confidence === "judgment" ? " judg" : ""}${className ? ` ${className}` : ""}`}
      style={{ justifySelf: "start", ...(small ? { height: 20, fontSize: 11.5 } : {}) }}
    >
      <ConfidenceGlyph confidence={confidence} />
      {CONFIDENCE_LABEL[confidence]}
    </span>
  );
}
