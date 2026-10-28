"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { invitationEmail, sendEmail } from "@/lib/email";
import { redirect } from "next/navigation";
import { COMPANY_COOKIE, getContext } from "@/lib/context";
import { bool, cleanError, done, fail, num, str } from "@/lib/forms";
import type { Role } from "@/lib/types";

async function manager(back: string) {
  const ctx = await getContext();
  if (!ctx.can("company.manage")) fail(back, "Only owners and admins can change settings");
  return ctx;
}

export async function updateCompany(fd: FormData) {
  const back = "/settings/company";
  const ctx = await manager(back);
  const name = str(fd, "name");
  if (!name) fail(back, "Trading name is required");
  const { error } = await ctx.supabase
    .from("companies")
    .update({
      name,
      legal_name: str(fd, "legal_name"),
      registration_no: str(fd, "registration_no"),
      vat_no: str(fd, "vat_no"),
      address: str(fd, "address"),
      phone: str(fd, "phone"),
      email: str(fd, "email"),
      bank_details: str(fd, "bank_details"),
      invoice_footer: str(fd, "invoice_footer"),
      default_payment_days: Math.min(365, Math.max(0, Math.round(num(fd, "default_payment_days") ?? 30))),
    })
    .eq("id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  done(back, "Company details saved");
}

type Invite = { id: string; token: string; company: string; email: string; role: string; inviter: string | null; inviter_email: string | null };

async function sendInvite(inv: Invite) {
  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.kageflow.co.za";
  const link = `${origin}/join/${inv.token}`;
  const mail = invitationEmail({ company: inv.company, inviter: inv.inviter ?? "Your team", role: inv.role, link });
  const sent = await sendEmail({ to: inv.email, subject: mail.subject, html: mail.html, text: mail.text, replyTo: inv.inviter_email });
  return { sent, link };
}

/** Invites someone by email. They get a link that adds them to this dealership with the chosen role. */
export async function inviteMember(fd: FormData) {
  const back = "/settings/members";
  const ctx = await manager(back);
  const email = str(fd, "email");
  if (!email) fail(back, "Enter their email address");
  const { data, error } = await ctx.supabase.rpc("create_invitation", { p_company: ctx.companyId, p_email: email, p_role: (str(fd, "role") ?? "sales") as Role });
  if (error) fail(back, cleanError(error.message));
  const { sent, link } = await sendInvite(data as Invite);
  revalidatePath(back);
  if (!sent) fail(back, `Invitation created, but the email could not be sent. Send them this link yourself: ${link}`);
  done(back, `Invitation sent to ${(data as Invite).email}`);
}

/** Sends a fresh invitation to the same person (the old link stops working) */
export async function resendInvite(fd: FormData) {
  const back = "/settings/members";
  const ctx = await manager(back);
  const { data: old } = await ctx.supabase.from("company_invitations").select("email, role").eq("id", str(fd, "id")).eq("company_id", ctx.companyId).maybeSingle();
  if (!old) fail(back, "Invitation not found");
  const { data, error } = await ctx.supabase.rpc("create_invitation", { p_company: ctx.companyId, p_email: old.email as string, p_role: old.role as Role });
  if (error) fail(back, cleanError(error.message));
  const { sent, link } = await sendInvite(data as Invite);
  revalidatePath(back);
  if (!sent) fail(back, `New invitation created, but the email could not be sent. Send them this link yourself: ${link}`);
  done(back, `Invitation sent again to ${old.email}`);
}

export async function cancelInvite(fd: FormData) {
  const back = "/settings/members";
  const ctx = await manager(back);
  const { error } = await ctx.supabase.rpc("revoke_invitation", { p_id: str(fd, "id")! });
  if (error) fail(back, cleanError(error.message));
  revalidatePath(back);
  done(back, "Invitation cancelled");
}

export async function changeRole(fd: FormData) {
  const back = "/settings/members";
  const ctx = await manager(back);
  const { error } = await ctx.supabase.rpc("set_member_role", { p_company: ctx.companyId, p_user: str(fd, "user_id")!, p_role: str(fd, "role") as Role });
  if (error) fail(back, cleanError(error.message));
  done(back, "Role updated");
}

export async function removeMember(fd: FormData) {
  const back = "/settings/members";
  const ctx = await getContext();
  const userId = str(fd, "user_id")!;
  const { error } = await ctx.supabase.rpc("remove_member", { p_company: ctx.companyId, p_user: userId });
  if (error) fail(back, cleanError(error.message));
  if (userId === ctx.user.id) {
    (await cookies()).delete(COMPANY_COOKIE);
    redirect("/dashboard");
  }
  done(back, "Member removed");
}

export async function saveStage(fd: FormData) {
  const back = "/settings/pipeline";
  const ctx = await manager(back);
  const id = str(fd, "id");
  const name = str(fd, "name");
  const probability = Math.min(100, Math.max(0, Math.round(num(fd, "probability") ?? 0)));
  if (!name) fail(back, "Stage name is required");
  if (id) {
    const { error } = await ctx.supabase.from("crm_pipeline_stages").update({ name, probability }).eq("id", id).eq("company_id", ctx.companyId);
    if (error) fail(back, cleanError(error.message));
    done(back, `${name} saved`);
  }
  // New open stage goes just before the first won/lost stage
  const { data: stages } = await ctx.supabase.from("crm_pipeline_stages").select("id, position, is_won, is_lost").eq("company_id", ctx.companyId).order("position");
  const list = (stages ?? []) as { id: string; position: number; is_won: boolean; is_lost: boolean }[];
  const closedFrom = list.find((s) => s.is_won || s.is_lost)?.position ?? list.length + 1;
  for (const s of [...list].reverse().filter((s) => s.position >= closedFrom)) {
    const { error } = await ctx.supabase.from("crm_pipeline_stages").update({ position: s.position + 1 }).eq("id", s.id);
    if (error) fail(back, cleanError(error.message));
  }
  const { error } = await ctx.supabase.from("crm_pipeline_stages").insert({ company_id: ctx.companyId, name, probability, position: closedFrom, is_won: bool(fd, "is_won"), is_lost: false });
  if (error) fail(back, cleanError(error.message));
  done(back, `${name} added`);
}

export async function deleteStage(fd: FormData) {
  const back = "/settings/pipeline";
  const ctx = await manager(back);
  const { error } = await ctx.supabase.from("crm_pipeline_stages").delete().eq("id", str(fd, "id")!).eq("company_id", ctx.companyId);
  if (error) fail(back, error.message.includes("foreign key") ? "Move this stage's deals elsewhere before deleting it" : cleanError(error.message));
  done(back, "Stage deleted");
}
