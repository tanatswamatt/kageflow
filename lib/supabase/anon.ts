import { createClient } from "@supabase/supabase-js";

/** Client with no user session, for the public API and shared documents */
export function anonClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function bearer(request: Request): string | null {
  const h = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(kf_live_[0-9a-f]{48})$/.exec(h.trim());
  return m ? m[1]! : null;
}

export function apiError(code: string | undefined, message: string) {
  const status = code === "28000" ? 401 : code === "22023" || code === "22P02" ? 422 : 500;
  return Response.json({ error: status === 500 ? "Something went wrong" : message }, { status });
}
