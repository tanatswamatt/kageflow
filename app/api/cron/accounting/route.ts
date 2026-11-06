import { adminClient } from "@/lib/supabase/admin";
import { syncConnection } from "@/lib/accounting-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Scheduled by vercel.json. Vercel sends "Authorization: Bearer <CRON_SECRET>". */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const admin = adminClient();
  if (!admin) return new Response("Service key missing", { status: 503 });
  const { data } = await admin.from("accounting_connections").select("id").eq("provider", "xero").eq("status", "active").not("tenant_id", "is", null);
  const results: { id: string; ok: boolean; message: string }[] = [];
  for (const c of (data ?? []) as { id: string }[]) {
    try {
      results.push({ id: c.id, ...(await syncConnection(admin, c.id)) });
    } catch (e) {
      results.push({ id: c.id, ok: false, message: (e as Error).message });
    }
  }
  return Response.json({ ran: results.length, results });
}
