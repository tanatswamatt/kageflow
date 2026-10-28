/**
 * Where to send someone after signing in. Only paths on this site are allowed:
 * "/sales/invoices" is fine; "//evil.com", "/\evil.com", "https://evil.com" and anything with
 * control characters fall back to the dashboard (browsers treat a backslash like a slash).
 */
export function safeNext(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const url = new URL(value, "https://kageflow.invalid");
    if (url.origin !== "https://kageflow.invalid") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
