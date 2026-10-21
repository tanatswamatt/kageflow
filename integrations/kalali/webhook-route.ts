// Drop into the Kalali site as app/api/kageflow/route.ts
// Receives Kageflow webhooks and updates the customer-facing order tracker.
//
// Env on the Kalali site (Vercel → Settings → Environment Variables):
//   KAGEFLOW_WEBHOOK_SECRET = the signing secret shown in Kageflow → Settings → Integrations
//
// In Kageflow, add the webhook URL https://<kalali-domain>/api/kageflow
// and put Kalali's own order number in each sales order's "Customer reference".
// Tick "unit.updated" on the webhook so vehicles sold or reserved in Kageflow
// update on the website automatically. Needs SUPABASE_SERVICE_ROLE_KEY on the site.

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type KageflowEvent = {
  event: "order.updated" | "invoice.issued" | "credit_note.issued" | "payment.received" | "unit.updated" | "ping";
  company_id: string;
  sent_at: string;
  data: Record<string, unknown> & {
    number?: string;
    reference?: string | null; // Kalali's own order number
    status?: string;
    tracking_stage?: string | null;
    external_id?: string | null; // the website's vehicles.id for synced vehicles
  };
};

// Kageflow vehicle status → Kalali vehicles.status
const SITE_STATUS: Record<string, string> = {
  in_stock: "in_stock",
  in_transit: "in_stock",
  reserved: "reserved",
  sold: "sold",
  written_off: "archived",
};

function validSignature(raw: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const given = header.slice(7);
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export async function POST(request: Request) {
  const secret = process.env.KAGEFLOW_WEBHOOK_SECRET;
  if (!secret) return new Response("Not configured", { status: 500 });

  const raw = await request.text(); // verify the exact bytes received
  if (!validSignature(raw, request.headers.get("x-kageflow-signature"), secret)) {
    return new Response("Bad signature", { status: 401 });
  }
  const evt = JSON.parse(raw) as KageflowEvent;

  if (evt.event === "order.updated" && evt.data.reference) {
    // TODO (Kalali): map to your orders table, e.g. with the Supabase service-role client:
    // await supabaseAdmin
    //   .from("orders")
    //   .update({ status: evt.data.tracking_stage ?? evt.data.status, updated_at: new Date().toISOString() })
    //   .eq("order_number", evt.data.reference);
  }

  if (evt.event === "unit.updated" && evt.data.external_id) {
    const next = SITE_STATUS[String(evt.data.status)];
    if (next) {
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
      const { error } = await admin.from("vehicles").update({ status: next }).eq("id", evt.data.external_id);
      if (error) return new Response(error.message, { status: 500 }); // Kageflow will show the failure
    }
  }

  // Reply 2xx quickly; Kageflow logs the status code under Recent deliveries.
  return Response.json({ received: true });
}
