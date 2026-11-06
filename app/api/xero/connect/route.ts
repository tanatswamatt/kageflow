import { cookies } from "next/headers";
import { getContext } from "@/lib/context";
import { authorizeUrl, xeroConfigured } from "@/lib/xero";

const BACK = "/settings/accounting";

/** Start Xero sign-in. The state ties the answer to this user's session and company. */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const ctx = await getContext();
  if (!ctx.can("company.manage")) return Response.redirect(`${origin}${BACK}?error=${encodeURIComponent("Only owners and admins can connect Xero")}`, 303);
  if (!xeroConfigured()) return Response.redirect(`${origin}${BACK}?error=${encodeURIComponent("Xero isn't set up on this Kageflow server yet")}`, 303);
  const state = crypto.randomUUID();
  (await cookies()).set("kf_xero_state", `${state}.${ctx.companyId}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/xero", maxAge: 600 });
  return Response.redirect(authorizeUrl(origin, state), 303);
}
