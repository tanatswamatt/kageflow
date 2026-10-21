import { anonClient, apiError, bearer } from "@/lib/supabase/anon";

export async function GET(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  const key = bearer(request);
  if (!key) return Response.json({ error: "Send Authorization: Bearer kf_live_..." }, { status: 401 });
  const { ref } = await params;
  const { data, error } = await anonClient().rpc("api_order_status", { p_api_key: key, p_ref: decodeURIComponent(ref).slice(0, 100) });
  if (error) return apiError(error.code, error.message);
  const result = data as { found: boolean };
  if (!result.found) return Response.json({ error: "No order with that number or reference" }, { status: 404 });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
