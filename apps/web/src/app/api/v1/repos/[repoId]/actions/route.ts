import { ActionStatus, RequestActionRequest, type ActionsResponse } from "@birdsi/shared";
import { handler, json, parseBody, requireCaller } from "@/lib/api";
import { loadActions, requestAction } from "@/lib/ops";

export const GET = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  const raw = new URL(request.url).searchParams.get("status");
  const status = raw ? ActionStatus.parse(raw) : undefined;
  return json((await loadActions(repoId!, user, status)) satisfies ActionsResponse);
});

/** An agent (through MCP) or the owner (through the CLI) requests an action. */
export const POST = handler(async (request, { params }) => {
  const user = await requireCaller(request);
  const { repoId } = await params;
  const body = await parseBody(request, RequestActionRequest);
  const by = request.headers.get("x-birdsi-client") === "mcp" ? "agent" : "owner";
  return json({ action: await requestAction(repoId!, user, body, by) }, { status: 201 });
});
