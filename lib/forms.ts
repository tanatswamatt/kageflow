import { redirect } from "next/navigation";

/** Text field: trimmed, empty -> null */
export function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function required(fd: FormData, key: string, labelText: string, back: string): string {
  const v = str(fd, key);
  if (!v) fail(back, `${labelText} is required`);
  return v;
}

export function num(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (v === null) return null;
  const n = Number(v.replace(/[\s,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function bool(fd: FormData, key: string): boolean {
  return fd.get(key) === "on" || fd.get(key) === "true";
}

/** Send the user back with a message shown by <Notice/>. Never call inside try/catch. */
export function fail(path: string, message: string): never {
  redirect(withParam(path, "error", message));
}

export function done(path: string, message: string): never {
  redirect(withParam(path, "ok", message));
}

function withParam(path: string, key: string, message: string): string {
  const [base, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.delete("error");
  params.delete("ok");
  params.set(key, message);
  return `${base}?${params.toString()}`;
}

/** Turn a Postgres / PostgREST error into a sentence a user can act on */
export function cleanError(message: string | undefined): string {
  if (!message) return "Something went wrong";
  if (message.includes("row-level security")) return "Your role doesn't allow this action";
  if (message.includes("duplicate key")) return "That already exists";
  if (message.includes("violates foreign key")) return "This record is still in use";
  return message.replace(/^ERROR:\s*/, "");
}
