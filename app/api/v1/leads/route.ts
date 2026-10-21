import { anonClient, apiError, bearer } from "@/lib/supabase/anon";

export async function POST(request: Request) {
  const key = bearer(request);
  if (!key) return Response.json({ error: "Send Authorization: Bearer kf_live_..." }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Body must be a JSON object" }, { status: 422 });
  const { data, error } = await anonClient().rpc("api_submit_lead", { p_api_key: key, p_lead: body });
  if (error) return apiError(error.code, error.message);
  const result = data as { id: string; status: "created" | "existing" };
  return Response.json(result, { status: result.status === "created" ? 201 : 200 });
}
