import { describe, expect, it } from "vitest";
import { scannerNote } from "./presence";

describe("scannerNote", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  it("says nothing while presence is unknown or recent", () => {
    expect(scannerNote(null, now)).toBeNull();
    expect(scannerNote("2026-10-06T11:59:00Z", now)).toBeNull();
  });
  it("states how long no scanner has reported in", () => {
    expect(scannerNote("2026-10-06T11:55:00Z", now)).toBe("No scanner has reported in for 5 minutes. The scan starts when one is back.");
    expect(scannerNote("2026-10-06T09:00:00Z", now)).toBe("No scanner has reported in for 3 hours. The scan starts when one is back.");
    expect(scannerNote("2026-10-03T09:00:00Z", now)).toBe("No scanner has reported in for 3 days. The scan starts when one is back.");
  });
});
