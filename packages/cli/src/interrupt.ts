/**
 * Ctrl+C handling. Commands push a handler for the stretch of work where a
 * Ctrl+C needs special care (stopping a scan on the server); otherwise the
 * default applies: end with exit code 3.
 */
type Handler = (count: number) => void;

const handlers: Handler[] = [];
let installed = false;
let count = 0;
let fallback: () => void = () => process.exit(3);

export function installInterruptHandler(onDefault: () => void): void {
  fallback = onDefault;
  if (installed) return;
  installed = true;
  process.on("SIGINT", () => {
    count += 1;
    const top = handlers[handlers.length - 1];
    if (top) top(count);
    else fallback();
  });
}

/** Runs fn with a Ctrl+C handler in place. The count restarts for each handler. */
export async function withInterrupt<T>(handler: Handler, fn: () => Promise<T>): Promise<T> {
  count = 0;
  handlers.push(handler);
  try {
    return await fn();
  } finally {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
    count = 0;
  }
}
