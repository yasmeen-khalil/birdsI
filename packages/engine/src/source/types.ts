/**
 * A snapshot is a directory on local disk holding the code to scan, plus
 * where it came from. Every source adapter (GitHub App, uploaded tarball,
 * local folder) produces one, and the rest of the engine only sees this.
 */
export interface Snapshot {
  /** Absolute path to the extracted tree. */
  root: string;
  /** owner/name when known. */
  fullName: string | null;
  branch: string | null;
  commitSha: string | null;
  /** Called when the scan is over so temporary directories are removed. */
  cleanup: () => Promise<void>;
}
