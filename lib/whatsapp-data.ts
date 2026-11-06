import "server-only";
import type { AppContext } from "./context";
import type { WhatsAppMessage } from "./types";
import type { TemplateOption } from "@/components/crm/whatsapp-template-form";

/** Everything the WhatsApp panel needs for one lead */
export async function whatsAppPanelData(ctx: AppContext, lead: { id: string; first_name: string | null; unit_id?: string | null; interest: string | null }) {
  const [{ data: msgs }, { data: connected }, { data: tpl }] = await Promise.all([
    ctx.supabase.from("whatsapp_messages").select("id, lead_id, direction, wa_id, body, msg_type, status, created_at, media_id, media_name, media_link, template_name, error")
      .eq("company_id", ctx.companyId).eq("lead_id", lead.id).order("created_at").limit(300),
    ctx.supabase.rpc("whatsapp_connected", { p_company: ctx.companyId }),
    ctx.supabase.from("whatsapp_templates").select("id, name, language, body, params").eq("company_id", ctx.companyId).eq("status", "APPROVED").eq("usable", true).order("name"),
  ]);
  const messages = (msgs ?? []) as WhatsAppMessage[];
  const lastIn = [...messages].reverse().find((m) => m.direction === "in");
  const windowOpen = !!lastIn && Date.now() - new Date(lastIn.created_at).getTime() < 24 * 3600 * 1000;

  let cars: { id: string; label: string }[] = [];
  let carTitle = "";
  if (windowOpen || lead.unit_id) {
    const { data } = await ctx.supabase.from("inventory_units").select("id, stock_no, year, make, model, variant, is_published")
      .eq("company_id", ctx.companyId).in("status", ["in_stock", "listed", "reserved", "in_transit"])
      .order("is_published", { ascending: false }).order("created_at", { ascending: false }).limit(300);
    const rows = (data ?? []) as { id: string; stock_no: string | null; year: number | null; make: string | null; model: string | null; variant: string | null }[];
    cars = rows.map((u) => ({ id: u.id, label: [u.stock_no, [u.year, u.make, u.model, u.variant].filter(Boolean).join(" ")].filter(Boolean).join(" · ") }));
    const mine = rows.find((u) => u.id === (lead.unit_id ?? null));
    if (mine) carTitle = [mine.year, mine.make, mine.model].filter(Boolean).join(" ");
  }
  // first values offered for a template: their name, then the car they asked about
  const suggestions = [lead.first_name ?? "", carTitle || lead.interest || "", ctx.company.name];
  return {
    messages,
    connected: connected === true,
    templates: ((tpl ?? []) as TemplateOption[]),
    cars: windowOpen ? cars : [],
    defaultCar: lead.unit_id ?? null,
    suggestions,
  };
}
