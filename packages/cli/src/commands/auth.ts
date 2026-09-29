import { spawn } from "node:child_process";
import { ApiClient, delay, isTransient, toCliError } from "../api";
import { configPath, DEFAULT_API_URL, readConfig, updateConfig } from "../config";
import { CliError, EXIT } from "../exit";
import { paint, styleFor } from "../format";
import { printJson, println, StatusLine } from "../output";

/** Opens a URL in the default browser without a dependency. Failure is fine: the URL is printed. */
export function openBrowser(url: string): void {
  if (process.env.SSH_CONNECTION || process.env.BROWSER === "none") return;
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command as string, args as string[], { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // The printed URL is enough.
  }
}

export async function loginCommand(options: { browser: boolean }): Promise<number> {
  const style = styleFor(process.stdout);
  const { api } = await ApiClient.fromEnvironment({ ...process.env, BIRDSI_TOKEN: "" });
  let start;
  try {
    start = (await api.deviceStart()).data;
  } catch (error) {
    throw toCliError(error, "the sign-in service");
  }

  println(paint.bold(style, "Sign in to birdsI"));
  println();
  println(`  1. Open ${paint.bold(style, start.verificationUrl)}`);
  println("  2. Check that the page shows this code, then approve:");
  println();
  println(`       ${paint.accent(style, start.userCode.split("").join(" "))}`);
  println();
  if (options.browser && process.stdout.isTTY) openBrowser(start.verificationUrl);

  const status = new StatusLine();
  status.set(paint.dim(style, "  Waiting for you to approve in the browser. Ctrl+C cancels."));
  const expiresAt = Date.now() + start.expiresIn * 1000;
  let interval = start.interval * 1000;
  for (;;) {
    await delay(interval);
    if (Date.now() > expiresAt) {
      status.clear();
      throw new CliError("The sign-in code expired before it was approved.", EXIT.notSignedIn, "Run birdsi login to get a new code.");
    }
    let poll;
    try {
      poll = (await api.devicePoll(start.deviceCode)).data;
    } catch (error) {
      if (isTransient(error)) {
        interval = Math.min(interval + 5000, 30_000);
        continue;
      }
      status.clear();
      throw toCliError(error, "the sign-in service");
    }
    if (poll.status === "pending") continue;
    status.clear();
    if (poll.status === "expired") {
      throw new CliError("The sign-in code expired before it was approved.", EXIT.notSignedIn, "Run birdsi login to get a new code.");
    }
    if (poll.status === "denied") {
      throw new CliError("The sign-in was declined in the browser. Nothing was saved.", EXIT.notSignedIn);
    }
    await updateConfig({ token: poll.token, login: poll.login, apiUrl: api.baseUrl });
    println(`${paint.ok(style, "Signed in")} as ${paint.bold(style, poll.login)}.`);
    println(paint.dim(style, `The token is saved in ${configPath()}, readable only by you.`));
    if (process.env.BIRDSI_TOKEN) {
      println(paint.dim(style, "BIRDSI_TOKEN is set in this shell, and it takes priority over this sign-in."));
    }
    return EXIT.ok;
  }
}

export async function logoutCommand(): Promise<number> {
  const style = styleFor(process.stdout);
  const config = await readConfig();
  if (!config.token) {
    println("You were not signed in on this computer.");
  } else {
    await updateConfig({ token: undefined, login: undefined });
    println(`Signed out${config.login ? ` of ${config.login}` : ""}. The token is removed from this computer.`);
  }
  if (process.env.BIRDSI_TOKEN) println(paint.dim(style, "BIRDSI_TOKEN is still set in this shell. Unset it to sign out fully."));
  return EXIT.ok;
}

export async function whoamiCommand(options: { json?: boolean }): Promise<number> {
  const style = styleFor(process.stdout);
  const { api } = await ApiClient.fromEnvironment();
  const auth = api.requireAuth();
  let me;
  try {
    me = await api.me();
  } catch (error) {
    throw toCliError(error, "your account");
  }
  if (options.json) {
    printJson(me.raw);
    return EXIT.ok;
  }
  println(`Signed in as ${paint.bold(style, me.data.login)}.`);
  println(paint.dim(style, auth.source === "env" ? "Using BIRDSI_TOKEN from the environment." : `Using the token saved in ${configPath()}.`));
  if (api.baseUrl !== DEFAULT_API_URL) println(paint.dim(style, `birdsI address: ${api.baseUrl}`));
  return EXIT.ok;
}
