import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { recordUsage, replaceChunks, scanById, type JobRow } from "@birdsi/db";
import { chunkFile, embedChunks, isCodeLanguage, maskSecrets, prioritise, walkInventory, type EngineConfig, type Snapshot } from "@birdsi/engine";
import { resolveSnapshot } from "./scan-job";
import { spendHook } from "./spend";

const MAX_CHUNK_FILES = 300;

/** Embeds the repository's most relevant files for chat retrieval. Failure here never affects the scan. */
export async function runEmbedJob(config: EngineConfig, job: JobRow, heartbeat: () => Promise<void>): Promise<void> {
  const scanId = String(job.payload["scanId"]);
  const repoId = String(job.payload["repoId"]);
  const scan = await scanById(scanId);
  if (!scan || scan.status !== "done") return;
  const ticker = setInterval(() => void heartbeat().catch(() => {}), 15_000);
  let snapshot: Snapshot | null = null;
  try {
    snapshot = await resolveSnapshot(config, scan.repo_id, scan.snapshot_id, scan.branch, scan.source);
    const inventory = await walkInventory(snapshot.root);
    const files = prioritise(inventory.files).filter((f) => isCodeLanguage(f.language) && f.bytes < 120_000).slice(0, MAX_CHUNK_FILES);
    const chunks = [];
    for (const file of files) {
      const content = await readFile(join(snapshot.root, file.path), "utf8");
      // Stored passages outlive the snapshot, so key shapes are masked before they are embedded or saved.
      chunks.push(...(await chunkFile(file.path, maskSecrets(content))));
    }
    let embedded = chunks;
    try {
      embedded = await embedChunks(config, chunks, (u) => recordUsage({ ownerUserId: scan.owner_user_id, scanId, fixId: null, purpose: u.purpose, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, costMicrodollars: u.costMicrodollars }), spendHook(scan.owner_user_id).beforeCall);
    } catch {
      // Embeddings unavailable: chat falls back to keyword retrieval over the stored text.
    }
    await replaceChunks(repoId, scanId, embedded.map((c) => ({ path: c.path, lineStart: c.lineStart, lineEnd: c.lineEnd, text: c.text, embedding: c.embedding })));
  } finally {
    clearInterval(ticker);
    await snapshot?.cleanup();
  }
}
