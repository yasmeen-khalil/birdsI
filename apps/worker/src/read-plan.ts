/**
 * Which key reads what, for one app. Each project tied to a key is read with
 * that key; a vendor with several projects gets each project's facts under
 * its own label. A vendor with no tied key falls back to the owner's untied
 * key from before keys belonged to projects, read the old way.
 */
export interface PlanVendor {
  id: string;
  slug: string;
}

export interface PlanProject {
  id: string;
  vendor: string;
  kind: string;
  ref: string;
  label: string | null;
  settings: Record<string, string>;
}

export interface PlanKey {
  id: string;
  vendor_slug: string;
  app_project_id?: string | null;
  settings?: Record<string, string> | null;
}

export interface ReadTarget {
  vendorId: string;
  vendorSlug: string;
  connectionId: string;
  /** The project read, or null for an untied key read the old way. */
  project: PlanProject | null;
  /** Added to fact metrics and labels when a vendor has several projects. */
  suffix: string | null;
}

export function planReads(vendors: PlanVendor[], projects: PlanProject[], tied: PlanKey[], untied: PlanKey[], readable: (slug: string) => boolean): ReadTarget[] {
  const targets: ReadTarget[] = [];
  for (const vendor of vendors) {
    if (!readable(vendor.slug)) continue;
    const own = projects
      .filter((p) => p.vendor === vendor.slug)
      .map((p) => ({ project: p, key: tied.find((k) => k.app_project_id === p.id) }))
      .filter((x): x is { project: PlanProject; key: PlanKey } => Boolean(x.key));
    if (own.length > 0) {
      for (const { project, key } of own) {
        targets.push({ vendorId: vendor.id, vendorSlug: vendor.slug, connectionId: key.id, project, suffix: own.length > 1 ? project.label?.trim() || project.ref : null });
      }
      continue;
    }
    const legacy = untied.find((k) => k.vendor_slug === vendor.slug);
    if (legacy) targets.push({ vendorId: vendor.id, vendorSlug: vendor.slug, connectionId: legacy.id, project: null, suffix: null });
  }
  return targets;
}
