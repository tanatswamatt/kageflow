import { getContext } from "@/lib/context";
import { adminClient } from "@/lib/supabase/admin";
import { channelToken, downloadMedia } from "@/lib/whatsapp";

/** A photo, voice note or document a customer sent on WhatsApp, for signed-in members of the company only */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  const { data } = await ctx.supabase.from("whatsapp_messages").select("media_id, media_mime, media_name, channel_id").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  const m = data as { media_id: string | null; media_mime: string | null; media_name: string | null; channel_id: string | null } | null;
  if (!m?.media_id || !m.channel_id) return new Response("Not found", { status: 404 });
  const admin = adminClient();
  if (!admin) return new Response("Server key missing", { status: 503 });
  try {
    const { token } = await channelToken(admin, m.channel_id);
    const file = await downloadMedia(token, m.media_id);
    const type = m.media_mime ?? file.type;
    const inline = /^(image|audio|video)\//.test(type) || type === "application/pdf";
    const name = (m.media_name ?? `whatsapp-${id.slice(0, 8)}`).replace(/[^\w.\- ]/g, "_");
    return new Response(file.body, {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
      },
    });
  } catch (e) {
    return new Response((e as Error).message, { status: 410 });
  }
}
