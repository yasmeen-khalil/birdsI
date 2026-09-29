import { NextResponse } from "next/server";
import { ZodError, type z } from "zod";
import { ForbiddenError, NotFoundError, userIdForToken, type UserRow, userById } from "@birdsi/db";
import { currentUserRow } from "./auth";

/**
 * Helpers for /api/v1. Every handler resolves the caller from a bearer
 * token (CLI, MCP) or the browser session (web app), and every error is
 * a JSON body with a code and a plain message.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function json<T>(body: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, init);
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message } }, { status: error.status });
  if (error instanceof ZodError) return json({ error: { code: "bad_request", message: "The request did not match the expected shape." } }, { status: 400 });
  // Missing and forbidden look identical so nothing about other users' data leaks.
  if (error instanceof NotFoundError || error instanceof ForbiddenError) return json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  console.error(error);
  return json({ error: { code: "server_error", message: "Something went wrong on our side. Try again in a moment." } }, { status: 500 });
}

/** Resolves the caller. Throws 401 when nobody is signed in. */
export async function requireCaller(request: Request): Promise<UserRow> {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const token = header.slice(7).trim();
    const userId = await userIdForToken(token);
    if (!userId) throw new ApiError(401, "unauthorized", "This token is not valid. Run birdsi login to sign in again.");
    const user = await userById(userId);
    if (!user) throw new ApiError(401, "unauthorized", "This token is not valid. Run birdsi login to sign in again.");
    return user;
  }
  const user = await currentUserRow();
  if (!user) throw new ApiError(401, "unauthorized", "Sign in to continue.");
  return user;
}

/** The caller when present; null for anonymous access to public resources like demo scans. */
export async function optionalCaller(request: Request): Promise<UserRow | null> {
  try {
    return await requireCaller(request);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "bad_request", "The request body must be JSON.");
  }
  return schema.parse(raw);
}

export function handler(fn: (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<NextResponse>) {
  return async (request: Request, ctx: { params: Promise<Record<string, string>> }): Promise<NextResponse> => {
    try {
      return await fn(request, ctx);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/** A stable, non-identifying key for anonymous rate limits. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded ?? request.headers.get("x-real-ip") ?? "unknown";
  const agent = request.headers.get("user-agent") ?? "";
  return `${ip}|${agent.slice(0, 80)}`;
}
