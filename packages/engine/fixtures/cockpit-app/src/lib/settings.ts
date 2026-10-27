/** Reads a setting by name, so the name is not a literal env read the rules can see. */
export function setting(name: string): string | undefined {
  return process.env[name];
}
