import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentData } from "@/components/sales/document-view";

/** Same shape as the public shared_sales_doc RPC, built from tables the signed-in user can read (drafts included) */
export async function loadDocumentData(supabase: SupabaseClient, companyId: string, id: string): Promise<DocumentData | null> {
  const { data: doc } = await supabase.from("sales_docs").select("*").eq("id", id).eq("company_id", companyId).maybeSingle();
  if (!doc) return null;
  const [{ data: lines }, { data: company }, { data: customer }, { data: source }] = await Promise.all([
    supabase.from("sales_doc_lines").select("*, inventory_units(serial_no, is_second_hand)").eq("doc_id", id).order("line_no"),
    supabase.from("companies").select("name, legal_name, registration_no, vat_no, address, phone, email, bank_details, invoice_footer, base_currency").eq("id", companyId).single(),
    supabase.from("crm_accounts").select("name, billing_address, vat_no, email").eq("id", doc.account_id).single(),
    doc.source_doc_id ? supabase.from("sales_docs").select("number").eq("id", doc.source_doc_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  type L = { line_no: number; description: string; quantity: number; unit_price: number; discount_pct: number; tax_rate: number; line_subtotal: number; line_tax: number; inventory_units: { serial_no: string; is_second_hand: boolean } | null };
  return {
    doc,
    lines: ((lines ?? []) as L[]).map((l) => ({ ...l, serial_no: l.inventory_units?.serial_no ?? null, is_second_hand: l.inventory_units?.is_second_hand ?? null })),
    company,
    customer,
    source_number: (source as { number: string | null } | null)?.number ?? null,
  } as DocumentData;
}
