import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  // Email confirmation links can land on the site root when the callback URL isn't allow-listed
  if (code) redirect(`/auth/callback?code=${encodeURIComponent(code)}`);

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  redirect(data.user ? "/dashboard" : "/login");
}
