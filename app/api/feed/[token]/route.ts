import { anonClient } from "@/lib/supabase/anon";

type Vehicle = Record<string, unknown> & { photos: string[]; features: string[] };
type Feed = { dealer: Record<string, string | null>; channel: string; generated_at: string; count: number; vehicles: Vehicle[] };

const COLS = ["stock_no", "vin", "make", "model", "variant", "year", "mileage_km", "colour", "transmission", "fuel_type", "body_type", "condition", "price", "currency", "status", "title", "description", "features", "location", "photos"] as const;

const xml = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const csv = (v: unknown) => {
  const s = Array.isArray(v) ? v.join(" | ") : String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const format = new URL(request.url).searchParams.get("format") ?? "json";
  const { data, error } = await anonClient().rpc("stock_feed", { p_token: token });
  if (error) return Response.json({ error: "Something went wrong" }, { status: 500 });
  if (!data) return Response.json({ error: "Feed not found" }, { status: 404 });
  const feed = data as Feed;
  const headers = { "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex" };

  if (format === "csv") {
    const rows = [COLS.join(","), ...feed.vehicles.map((v) => COLS.map((c) => csv(v[c])).join(","))];
    return new Response(rows.join("\n"), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'inline; filename="stock.csv"' } });
  }
  if (format === "xml") {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<stock dealer="${xml(feed.dealer.name)}" generated="${xml(feed.generated_at)}" count="${feed.count}">
${feed.vehicles.map((v) => `  <vehicle>
${COLS.filter((c) => c !== "photos" && c !== "features").map((c) => `    <${c}>${xml(v[c])}</${c}>`).join("\n")}
    <features>${v.features.map((f) => `<feature>${xml(f)}</feature>`).join("")}</features>
    <photos>${v.photos.map((p) => `<photo>${xml(p)}</photo>`).join("")}</photos>
  </vehicle>`).join("\n")}
</stock>`;
    return new Response(body, { headers: { ...headers, "Content-Type": "application/xml; charset=utf-8" } });
  }
  return Response.json(feed, { headers });
}
