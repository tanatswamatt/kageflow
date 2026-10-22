import { createBrowserClient } from "@supabase/ssr";

/** Signed-in client for the browser: used for direct photo uploads to storage */
export function browserClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
}
