"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { approveDeviceLogin, deleteRepo, deleteUser, denyDeviceLogin, purgeSnapshotsForUser, revokeToken, updateUserPreferences } from "@birdsi/db";
import { AnswerQuestionRequest, RequestActionRequest, SetVisionRequest } from "@birdsi/shared";
import type { z } from "zod";
import { ApiError } from "./api";
import { requireUser } from "./auth";
import { answerQuestion, changePolicy, connectVendor, decideActionRequest, disconnectVendor, dismissQuestion, requestAction, resyncAllRepos, saveVision, startVendorSync } from "./ops";
import { dismissFinding, reopenFinding, startScan, stopScan } from "./scans";
import { addAppProject, connectProjectKey, disconnectProjectKey, editAppProject, removeAppProject, renameApp, reuseKeyForProject, setEnvironments, tieKey, type ProjectInput } from "./apps";

/**
 * Server actions used by the web pages. Each one resolves the signed-in
 * user on the server and returns a plain result the UI can render; nothing
 * here trusts a client-supplied user id.
 */
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; message: string; code?: string };

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: error.message, code: error.code };
    if (error instanceof Error && error.message === "Not signed in") return { ok: false, message: "Sign in to continue.", code: "unauthorized" };
    console.error(error);
    return { ok: false, message: "birdsI hit an error. Try again in a moment." };
  }
}

/** The same limits the API applies, for input that arrives through a server action. */
function checked<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "bad_request", message);
  return parsed.data;
}

export async function startScanAction(input: { repoId: string }): Promise<ActionResult<{ scanId: string }>> {
  return run(async () => {
    const user = await requireUser();
    const scan = await startScan(user, { repoId: input.repoId }, "web");
    revalidatePath(`/app/${input.repoId}`);
    return { scanId: scan.id };
  });
}

export async function syncVendorsAction(repoId: string): Promise<ActionResult<{ queued: boolean; reason?: string }>> {
  return run(async () => {
    const user = await requireUser();
    const result = await startVendorSync(repoId, user);
    revalidatePath(`/app/${repoId}/vendors`);
    return result;
  });
}

export async function answerQuestionAction(questionId: string, repoId: string, answer: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const { answer: checkedAnswer } = checked(AnswerQuestionRequest, { answer }, "Keep the answer between 1 and 2,000 characters.");
    await answerQuestion(questionId, user, checkedAnswer);
    revalidatePath(`/app/${repoId}`);
    revalidatePath(`/app/${repoId}/agent`);
    revalidatePath(`/app/${repoId}/vendors`);
    return undefined;
  });
}

export async function dismissQuestionAction(questionId: string, repoId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    await dismissQuestion(questionId, user);
    revalidatePath(`/app/${repoId}/agent`);
    return undefined;
  });
}

export async function decideActionAction(actionId: string, repoId: string, decision: "approve" | "deny"): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    await decideActionRequest(actionId, user, decision);
    revalidatePath(`/app/${repoId}/agent`);
    return undefined;
  });
}

export async function requestActionAction(repoId: string, input: { title: string; reason: string; command: string; vendorSlug?: string; estimatedMonthlyUsd?: number }): Promise<ActionResult<{ actionId: string }>> {
  return run(async () => {
    const user = await requireUser();
    const body = checked(
      RequestActionRequest,
      { title: input.title, reason: input.reason, command: input.command, ...(input.vendorSlug ? { vendorSlug: input.vendorSlug } : {}), ...(input.estimatedMonthlyUsd !== undefined ? { estimatedMonthlyUsd: input.estimatedMonthlyUsd } : {}) },
      "Keep the title under 200 characters, the reason under 2,000 and the command under 1,000.",
    );
    const action = await requestAction(repoId, user, { title: body.title, reason: body.reason, command: body.command, ...(body.vendorSlug ? { vendorSlug: body.vendorSlug } : {}), ...(body.estimatedMonthlyUsd !== undefined ? { estimatedMonthlyUsd: body.estimatedMonthlyUsd } : {}) }, "owner");
    revalidatePath(`/app/${repoId}/agent`);
    return { actionId: action.id };
  });
}

export async function updatePolicyAction(repoId: string, patch: { allowPropose?: boolean; allowWrite?: boolean; autoApproveUnderUsd?: number | null }): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    await changePolicy(repoId, user, patch);
    revalidatePath(`/app/${repoId}/agent`);
    return undefined;
  });
}

export async function saveVisionAction(repoId: string, text: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    const body = checked(SetVisionRequest, { text }, "Keep the vision under 20,000 characters.");
    await saveVision(repoId, user, body.text);
    revalidatePath(`/app/${repoId}`);
    return undefined;
  });
}

export async function connectVendorAction(input: { vendorSlug: string; token: string; settings: Record<string, string> }): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    await connectVendor(user, input);
    await resyncAllRepos(user);
    revalidatePath("/settings");
    return undefined;
  });
}

export async function disconnectVendorAction(connectionId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    await disconnectVendor(user, connectionId);
    await resyncAllRepos(user);
    revalidatePath("/settings");
    return undefined;
  });
}

export async function stopScanAction(scanId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    await stopScan(scanId, user);
    return undefined;
  });
}

export async function dismissFindingAction(findingId: string, repoId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    await dismissFinding(findingId, user);
    revalidatePath(`/app/${repoId}/findings`);
    return undefined;
  });
}

export async function reopenFindingAction(findingId: string, repoId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    await reopenFinding(findingId, user);
    revalidatePath(`/app/${repoId}/findings`);
    return undefined;
  });
}

export async function setEmailUpdatesAction(enabled: boolean): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    await updateUserPreferences(user.id, { emailUpdates: enabled });
    revalidatePath("/settings");
    return undefined;
  });
}

export async function disconnectRepoAction(repoId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    await deleteRepo(repoId, user.id);
    revalidatePath("/settings");
    revalidatePath("/app");
    return undefined;
  });
}

export async function revokeTokenAction(tokenId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    await revokeToken(tokenId, user.id);
    revalidatePath("/settings");
    return undefined;
  });
}

/** Deletes the account. The typed confirmation must match the user's GitHub login (or email when there is none). */
export async function deleteAccountAction(typed: string): Promise<ActionResult> {
  const result = await run(async () => {
    const user = await requireUser();
    const expected = user.github_login ?? user.email ?? "";
    if (!expected || typed.trim() !== expected) throw new ApiError(400, "confirm", "The name you typed does not match.");
    // The uploaded code goes first, so a failure here never leaves files behind an account that is gone.
    await purgeSnapshotsForUser(user.id);
    await deleteUser(user.id);
    return undefined;
  });
  if (result.ok) redirect("/deleted");
  return result;
}

export async function approveDeviceAction(userCode: string): Promise<ActionResult<{ status: "approved" | "expired" | "not_found" | "already_used" }>> {
  return run(async () => {
    const user = await requireUser();
    const status = await approveDeviceLogin(userCode, user.id, "Terminal sign-in");
    return { status };
  });
}

export async function denyDeviceAction(userCode: string): Promise<ActionResult> {
  return run(async () => {
    await requireUser();
    await denyDeviceLogin(userCode);
    return undefined;
  });
}

// Apps, their projects and keys. Keys are pasted here, in the browser, and nowhere else.

export async function renameAppAction(repoId: string, name: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    await renameApp(repoId, user, name);
    revalidatePath(`/app/${repoId}`, "layout");
    return undefined;
  });
}

export async function setEnvironmentsAction(repoId: string, environments: string[]): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    await setEnvironments(repoId, user, environments);
    revalidatePath(`/app/${repoId}/projects`);
    return undefined;
  });
}

export async function addProjectAction(repoId: string, input: ProjectInput): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    await addAppProject(repoId, user, input);
    revalidatePath(`/app/${repoId}/projects`);
    return undefined;
  });
}

export async function editProjectAction(repoId: string, projectId: string, patch: { label?: string; environment?: string; plan?: string }): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    await editAppProject(projectId, user, patch);
    revalidatePath(`/app/${repoId}/projects`);
    return undefined;
  });
}

export async function removeProjectAction(repoId: string, projectId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    await removeAppProject(projectId, user);
    revalidatePath(`/app/${repoId}/projects`);
    return undefined;
  });
}

export async function connectProjectKeyAction(repoId: string, projectId: string, input: { token: string; label?: string }): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    await connectProjectKey(projectId, user, input);
    await startVendorSync(repoId, user).catch(() => undefined);
    revalidatePath(`/app/${repoId}/projects`);
    return undefined;
  });
}

export async function reuseKeyAction(repoId: string, projectId: string, fromConnectionId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    await reuseKeyForProject(projectId, user, fromConnectionId);
    await startVendorSync(repoId, user).catch(() => undefined);
    revalidatePath(`/app/${repoId}/projects`);
    return undefined;
  });
}

export async function removeProjectKeyAction(repoId: string, projectId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    await disconnectProjectKey(projectId, user);
    revalidatePath(`/app/${repoId}/projects`);
    return undefined;
  });
}

export async function tieKeyAction(repoId: string, connectionId: string, projectId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await requireUser();
    await tieKey(connectionId, projectId, user);
    await startVendorSync(repoId, user).catch(() => undefined);
    revalidatePath(`/app/${repoId}/projects`);
    revalidatePath("/settings");
    return undefined;
  });
}
