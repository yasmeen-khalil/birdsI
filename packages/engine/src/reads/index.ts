import { readsInDepth, type ProjectReadData, type ServiceMap } from "@birdsi/shared";
import type { ReadContext } from "./http";
import { readOneSignalApp } from "./onesignal";
import { readSupabaseProject } from "./supabase";
import { readVercelProject } from "./vercel";

export { markerQuery, fileForLabel, owedFromMarkers, owedFromHistory, describeMarker, MARKER_KINDS } from "./migrations";
export { ReadError, reasonForStatus, type ReadContext } from "./http";

/** A vendor project as the readers need it: the vendor's id for it, and non-secret settings such as a Vercel team. */
export interface ProjectToRead {
  vendor: string;
  kind: string;
  ref: string;
  label: string | null;
  settings: Record<string, string>;
}

/**
 * Reads one vendor project in depth with its read key: a Vercel project, a
 * Supabase project or a OneSignal app. The map of the app's code says which
 * migrations the database should have. Null for a project birdsI does not
 * read in depth. Never throws: every part says what it read or why it could not.
 */
export async function readProject(project: ProjectToRead, token: string, map: ServiceMap | null, ctx: ReadContext): Promise<ProjectReadData | null> {
  if (!readsInDepth(project.vendor, project.kind)) return null;
  switch (project.vendor) {
    case "vercel":
      return readVercelProject(token, { project: project.ref, team: project.settings["team"]?.trim() || null }, ctx);
    case "supabase":
      return readSupabaseProject(token, project.ref, map?.migrations ?? null, ctx);
    case "onesignal":
      return readOneSignalApp(token, project.ref, ctx);
    default:
      return null;
  }
}
