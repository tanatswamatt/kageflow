import { anonClient, apiError, bearer } from "@/lib/supabase/anon";
import { readBoundedBody, RequestBodyTooLargeError } from "@/lib/bounded-body";

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const key = bearer(request);
  if (!key) return Response.json({ error: "Send Authorization: Bearer kf_live_..." }, { status: 401 });
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  let body: unknown;
  try {
    const bytes = await readBoundedBody(request, MAX_BODY_BYTES);
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "Request body is too large" }, { status: 413 });
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Body must be a JSON object" }, { status: 422 });
  const { data, error } = await anonClient().rpc("api_submit_lead", { p_api_key: key, p_lead: body });
  if (error) return apiError(error.code, error.message);
  const result = data as { id: string; status: "created" | "existing" };
  return Response.json(result, { status: result.status === "created" ? 201 : 200 });
}
