import { ForbiddenError, NotFoundError } from "@birdsi/db";
import { notFound } from "next/navigation";

/** Missing and not-yours look the same to the viewer: a 404. Other errors reach the error boundary. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) notFound();
    throw error;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids in URLs are UUIDs; anything else is a 404 before it reaches the database. */
export function requireId(id: string | undefined): string {
  if (!id || !UUID.test(id)) notFound();
  return id;
}
