import { anonClient } from "@/lib/supabase/anon";
import { readBoundedBody, RequestBodyTooLargeError } from "@/lib/bounded-body";

const MAX_BODY_BYTES = 1024 * 1024;

// Meta calls this once with a challenge when you save the webhook
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const q = new URL(request.url).searchParams;
  if (q.get("hub.mode") !== "subscribe") return new Response("Bad request", { status: 400 });
  const { data } = await anonClient().rpc("whatsapp_verify", { p_token: token, p_verify: q.get("hub.verify_token") ?? "" });
  if (data !== true) return new Response("Forbidden", { status: 403 });
  return new Response(q.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
}

// Incoming messages and delivery receipts. The signature is checked in the database against the app secret.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedBody(request, MAX_BODY_BYTES));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return new Response("Payload too large", { status: 413 });
    return new Response("Invalid request body", { status: 400 });
  }
  const { error } = await anonClient().rpc("whatsapp_inbound", { p_token: token, p_raw: raw, p_signature: request.headers.get("x-hub-signature-256") ?? "" });
  if (error) return new Response(error.code === "28000" ? "Forbidden" : "Error", { status: error.code === "28000" ? 403 : 500 });
  return new Response("OK", { status: 200 });
}
