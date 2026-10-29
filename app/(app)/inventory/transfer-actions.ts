"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { bool, cleanError, done, fail, num, str } from "@/lib/forms";

/** Link a customer to their Kageflow dealership by the dealer code they gave you (blank code unlinks) */
export async function linkDealer(fd: FormData) {
  const accountId = str(fd, "account_id")!;
  const back = str(fd, "back") ?? `/crm/accounts/${accountId}`;
  const ctx = await getContext();
  if (!ctx.can("crm.write")) fail(back, "Your role can't change customers");
  const { data, error } = await ctx.supabase.rpc("link_account_dealer", { p_account: accountId, p_code: str(fd, "code") ?? "" });
  if (error) fail(back, cleanError(error.message));
  revalidatePath(back);
  done(back, data ? `Linked to ${data as string} on Kageflow` : "Unlinked from Kageflow");
}

/** Send the cars on an issued invoice to the buyer's Kageflow, linking the buyer first if a code is given */
export async function sendTransfers(fd: FormData) {
  const invoiceId = str(fd, "invoice_id")!;
  const back = `/sales/doc/${invoiceId}`;
  const ctx = await getContext();
  if (!ctx.can("sales.write")) fail(back, "Your role can't send cars");
  const code = str(fd, "code");
  if (code) {
    const { data: doc } = await ctx.supabase.from("sales_docs").select("account_id").eq("id", invoiceId).eq("company_id", ctx.companyId).maybeSingle();
    if (!doc) fail(back, "Invoice not found");
    const { error: le } = await ctx.supabase.rpc("link_account_dealer", { p_account: doc.account_id, p_code: code });
    if (le) fail(back, cleanError(le.message));
  }
  const { data, error } = await ctx.supabase.rpc("send_vehicle_transfers", { p_invoice: invoiceId });
  if (error) fail(back, cleanError(error.message));
  revalidatePath(back);
  const n = Number(data ?? 0);
  done(back, n ? `${n === 1 ? "The car's" : `${n} cars'`} details and photos were sent to the buyer's Kageflow` : "Already sent: nothing new on this invoice");
}

export async function cancelTransfer(fd: FormData) {
  const back = str(fd, "back") ?? "/sales/invoices";
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("cancel_vehicle_transfer", { p_id: str(fd, "id") });
  if (error) fail(back, cleanError(error.message));
  revalidatePath(back);
  done(back, "Withdrawn. The buyer can no longer accept it");
}

export async function declineTransfer(fd: FormData) {
  const back = "/inventory/incoming";
  const ctx = await getContext();
  if (!ctx.can("inventory.write")) fail(back, "Your role can't change stock");
  const { error } = await ctx.supabase.rpc("decline_vehicle_transfer", { p_id: str(fd, "id") });
  if (error) fail(back, cleanError(error.message));
  revalidatePath("/", "layout");
  done(back, "Declined");
}

type Accepted = { unit_id: string; supplier_id: string; photos: string[]; price_net: number | null; price_vat: number | null; currency: string; base_currency: string; invoice_number: string | null };

/** Take an incoming car into stock: copy its photos into our storage and, if asked, post what we paid */
export async function acceptTransfer(fd: FormData) {
  const back = "/inventory/incoming";
  const ctx = await getContext();
  if (!ctx.can("inventory.write")) fail(back, "Your role can't add stock");
  const { data, error } = await ctx.supabase.rpc("accept_vehicle_transfer", { p_id: str(fd, "id"), p_location: str(fd, "location") });
  if (error) fail(back, cleanError(error.message));
  const a = data as Accepted;
  const unitPage = `/inventory/units/${a.unit_id}`;
  const notes: string[] = [];

  // photos: only from our own public bucket, copied so the seller deleting theirs doesn't break ours
  const allowed = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/vehicle-photos/`;
  const rows: { company_id: string; unit_id: string; url: string; storage_path: string; position: number }[] = [];
  for (const [i, url] of (a.photos ?? []).slice(0, 30).entries()) {
    if (typeof url !== "string" || !url.startsWith(allowed)) continue;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const type = res.headers.get("content-type") ?? "image/jpeg";
      if (!type.startsWith("image/")) continue;
      const blob = await res.blob();
      if (blob.size > 10 * 1024 * 1024) continue;
      const path = `${ctx.companyId}/${a.unit_id}/${crypto.randomUUID()}.jpg`;
      const { error: ue } = await ctx.supabase.storage.from("vehicle-photos").upload(path, blob, { contentType: type, cacheControl: "31536000" });
      if (ue) continue;
      rows.push({ company_id: ctx.companyId, unit_id: a.unit_id, url: ctx.supabase.storage.from("vehicle-photos").getPublicUrl(path).data.publicUrl, storage_path: path, position: i });
    } catch {
      /* skip this photo */
    }
  }
  if (rows.length) {
    const { error: pe } = await ctx.supabase.from("vehicle_photos").insert(rows);
    if (pe) notes.push("the photos couldn't be saved");
  }
  if ((a.photos ?? []).length > rows.length) notes.push(`${(a.photos ?? []).length - rows.length} photo(s) couldn't be copied`);

  // what we paid, as a purchase cost (owners, admins and accountants only)
  if (bool(fd, "post_cost") && ctx.can("inventory.costs")) {
    const amount = num(fd, "amount");
    const vat = num(fd, "vat") ?? 0;
    const paidFrom = str(fd, "paid_from");
    if (!amount || amount <= 0 || !paidFrom) notes.push("the cost wasn't posted: enter the amount and where it was paid from on the car's page");
    else {
      const { error: ce } = await ctx.supabase.rpc("add_unit_cost", {
        p_unit: a.unit_id, p_kind: "purchase", p_amount: amount, p_paid_from: paidFrom, p_vat: ctx.company.vat_no?.trim() ? vat : 0,
        p_description: "Bought from another Kageflow dealer", p_supplier: a.supplier_id, p_reference: a.invoice_number,
      });
      if (ce) notes.push(`the cost wasn't posted: ${cleanError(ce.message)}`);
    }
  }

  revalidatePath("/", "layout");
  const msg = notes.length ? `Car added to your stock, but ${notes.join("; ")}.` : "Car added to your stock with its photos. Check the details and set your asking price.";
  redirect(`${unitPage}?${notes.length ? "error" : "ok"}=${encodeURIComponent(msg)}`);
}
