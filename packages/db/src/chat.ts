import type { ChatMessage } from "@birdsi/shared";
import { getDb, unwrap } from "./client";

interface ChatRow {
  id: string;
  repo_id: string;
  owner_user_id: string;
  role: "user" | "assistant";
  content: string;
  citations: ChatMessage["citations"];
  judgment: boolean;
  created_at: string;
}

function toMessage(row: ChatRow): ChatMessage {
  return { id: row.id, role: row.role, content: row.content, citations: row.citations ?? [], judgment: row.judgment, createdAt: row.created_at };
}

export async function chatHistory(repoId: string, userId: string, limit = 40): Promise<ChatMessage[]> {
  const db = getDb();
  const { data, error } = await db.from("chat_messages").select().eq("repo_id", repoId).eq("owner_user_id", userId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`chatHistory: ${error.message}`);
  return ((data ?? []) as ChatRow[]).reverse().map(toMessage);
}

export async function appendChat(repoId: string, userId: string, message: Omit<ChatMessage, "id" | "createdAt">): Promise<ChatMessage> {
  const db = getDb();
  const result = await db.from("chat_messages").insert({ repo_id: repoId, owner_user_id: userId, role: message.role, content: message.content, citations: message.citations, judgment: message.judgment }).select().single();
  return toMessage(unwrap(result, "appendChat") as ChatRow);
}

export async function clearChat(repoId: string, userId: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from("chat_messages").delete().eq("repo_id", repoId).eq("owner_user_id", userId);
  if (error) throw new Error(`clearChat: ${error.message}`);
}

export interface ChunkRow {
  path: string;
  line_start: number;
  line_end: number;
  text: string;
  similarity?: number;
}

/** Replaces the repo's chunks with those from the newest scan. */
export async function replaceChunks(repoId: string, scanId: string, chunks: Array<{ path: string; lineStart: number; lineEnd: number; text: string; embedding: number[] | undefined }>): Promise<void> {
  const db = getDb();
  const del = await db.from("repo_chunks").delete().eq("repo_id", repoId);
  if (del.error) throw new Error(`replaceChunks delete: ${del.error.message}`);
  const rows = chunks.map((c) => ({ repo_id: repoId, scan_id: scanId, path: c.path, line_start: c.lineStart, line_end: c.lineEnd, text: c.text, embedding: c.embedding ?? null }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("repo_chunks").insert(rows.slice(i, i + 200));
    if (error) throw new Error(`replaceChunks insert: ${error.message}`);
  }
}

export async function matchChunks(repoId: string, embedding: number[], limit: number): Promise<ChunkRow[]> {
  const db = getDb();
  const { data, error } = await db.rpc("match_chunks", { p_repo_id: repoId, p_query: embedding, p_limit: limit });
  if (error) throw new Error(`matchChunks: ${error.message}`);
  return (data ?? []) as ChunkRow[];
}

export async function chunksForRepo(repoId: string, limit = 2000): Promise<ChunkRow[]> {
  const db = getDb();
  const { data, error } = await db.from("repo_chunks").select("path, line_start, line_end, text").eq("repo_id", repoId).limit(limit);
  if (error) throw new Error(`chunksForRepo: ${error.message}`);
  return (data ?? []) as ChunkRow[];
}
