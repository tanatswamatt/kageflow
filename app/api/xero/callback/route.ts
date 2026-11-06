import { cookies } from "next/headers";
import { getContext } from "@/lib/context";
import { adminClient } from "@/lib/supabase/admin";
import { exchangeCode, listTenants, saveTokens } from "@/lib/xero";
import { refreshExternalAccounts, type Connection } from "@/lib/accounting-sync";

const BACK = "/settings/accounting";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const go = (key: "ok" | "error", msg: string) => Response.redirect(`${origin}${BACK}?${key}=${encodeURIComponent(msg)}`, 303);

  const jar = await cookies();
  const saved = jar.get("kf_xero_state")?.value ?? "";
  jar.delete({ name: "kf_xero_state", path: "/api/xero" });
  const [state, companyId] = saved.split(".");
  if (url.searchParams.get("error")) return go("error", "Xero sign-in was cancelled");
  const code = url.searchParams.get("code");
  if (!code || !state || url.searchParams.get("state") !== state) return go("error", "The Xero sign-in expired. Try connecting again.");

  const ctx = await getContext();
  if (ctx.companyId !== companyId || !ctx.can("company.manage")) return go("error", "Switch back to the company you were connecting, then try again");
  const admin = adminClient();
  if (!admin) return go("error", "Kageflow's server is missing its service key, so it can't store the Xero connection");

  let message: string;
  try {
    const tokens = await exchangeCode(code, origin);
    const tenants = await listTenants(tokens.access_token);
    if (tenants.length === 0) return go("error", "That Xero login has no organisations");
    const single = tenants.length === 1 ? tenants[0]! : null;

    // the user's own client: row-level security checks they're an owner or admin of this company
    const { data, error } = await ctx.supabase.from("accounting_connections").upsert({
      company_id: ctx.companyId, provider: "xero",
      tenants: tenants.map((t) => ({ tenantId: t.tenantId, tenantName: t.tenantName })),
      tenant_id: single?.tenantId ?? null, tenant_name: single?.tenantName ?? null,
      status: "active", last_status: null, updated_at: new Date().toISOString(),
    }, { onConflict: "company_id,provider" }).select("*").single();
    if (error) throw new Error(error.message);
    const c = data as Connection;
    await saveTokens(admin, c.id, tokens);
    if (single) await refreshExternalAccounts(admin, c);
    message = single ? `Connected to ${single.tenantName}. Now match your accounts below.` : "Connected. Choose which Xero organisation is this company's.";
  } catch (e) {
    return go("error", (e as Error).message);
  }
  return go("ok", message);
}
