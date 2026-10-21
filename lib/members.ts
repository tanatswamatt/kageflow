import "server-only";
import { cache } from "react";
import { getContext } from "./context";
import type { Member, Profile } from "./types";

export type MemberWithProfile = Member & { name: string; email: string | null };

/** Members of the active company with display names, for owner pickers and labels */
export const getMembers = cache(async (): Promise<MemberWithProfile[]> => {
  const ctx = await getContext();
  const { data: members } = await ctx.supabase
    .from("company_members")
    .select("user_id, role, created_at")
    .eq("company_id", ctx.companyId)
    .order("created_at");
  const rows = (members ?? []) as Member[];
  const { data: profiles } = await ctx.supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", rows.map((m) => m.user_id));
  const byId = new Map(((profiles ?? []) as Profile[]).map((p) => [p.id, p]));
  return rows.map((m) => {
    const p = byId.get(m.user_id);
    return { ...m, name: p?.full_name || p?.email || "Member", email: p?.email ?? null };
  });
});

export async function memberNames(): Promise<Map<string, string>> {
  return new Map((await getMembers()).map((m) => [m.user_id, m.name]));
}
