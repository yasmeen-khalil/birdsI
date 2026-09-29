import { z } from "zod";

/**
 * Converts a zod schema to the JSON schema sent as `response_format`.
 * Zod 4 ships this natively; this wrapper keeps the call site tidy and strips
 * the `$schema` key some providers reject.
 */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  delete json["$schema"];
  return json;
}
