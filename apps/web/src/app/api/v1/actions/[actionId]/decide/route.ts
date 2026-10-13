import { DecideActionRequest } from "@birdsi/shared";
import { ApiError, assertSameOrigin, handler, json, parseBody } from "@/lib/api";
import { currentUserRow } from "@/lib/auth";
import { decideActionRequest } from "@/lib/ops";

/**
 * Approving or denying is a person's act. Only a browser session may decide;
 * a bearer token (the terminal tool, an agent through MCP) is refused, so an
 * agent can never approve its own request.
 */
export const POST = handler(async (request, { params }) => {
  if (request.headers.get("authorization")) {
    throw new ApiError(403, "browser_only", "Approvals are decided in the browser, never with a token. Open the Agent page in birdsI.");
  }
  assertSameOrigin(request);
  const user = await currentUserRow();
  if (!user) throw new ApiError(401, "unauthorized", "Sign in to continue.");
  const { actionId } = await params;
  const body = await parseBody(request, DecideActionRequest);
  return json({ action: await decideActionRequest(actionId!, user, body.decision) });
});
