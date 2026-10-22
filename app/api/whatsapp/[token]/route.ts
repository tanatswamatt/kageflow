import { anonClient } from "@/lib/supabase/anon";

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
  const raw = await request.text();
  const { error } = await anonClient().rpc("whatsapp_inbound", { p_token: token, p_raw: raw, p_signature: request.headers.get("x-hub-signature-256") ?? "" });
  if (error) return new Response(error.code === "28000" ? "Forbidden" : "Error", { status: error.code === "28000" ? 403 : 500 });
  return new Response("OK", { status: 200 });
}
