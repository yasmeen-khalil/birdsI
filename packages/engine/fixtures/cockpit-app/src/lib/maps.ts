import { setting } from "./settings";

export function mapboxToken(): string {
  return setting("MAPBOX_TOKEN") ?? "";
}
