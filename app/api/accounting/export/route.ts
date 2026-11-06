import { getContext } from "@/lib/context";
import { journalCsv } from "@/lib/accounting-sync";

/** Posted journals for a date range as a CSV that Sage, Pastel and most packages can import */
export async function GET(request: Request) {
  const ctx = await getContext();
  if (!ctx.can("ledger.write")) return new Response("Only owners, admins and accountants can export the books", { status: 403 });
  const q = new URL(request.url).searchParams;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const from = q.get("from") ?? "";
  const to = q.get("to") ?? "";
  if (!iso.test(from) || !iso.test(to) || from > to) return new Response("Choose a valid date range", { status: 422 });

  const { data: js } = await ctx.supabase.from("journals").select("id, number, journal_date, description")
    .eq("company_id", ctx.companyId).eq("status", "posted").gte("journal_date", from).lte("journal_date", to)
    .order("journal_date").order("number").limit(20000);
  const journals = (js ?? []) as { id: string; number: string | null; journal_date: string; description: string }[];
  const rows: Parameters<typeof journalCsv>[0] = [];
  if (journals.length) {
    const { data: accs } = await ctx.supabase.from("accounts").select("id, code, name").eq("company_id", ctx.companyId);
    const acc = new Map(((accs ?? []) as { id: string; code: string; name: string }[]).map((a) => [a.id, a]));
    const byId = new Map(journals.map((j) => [j.id, j]));
    for (let i = 0; i < journals.length; i += 300) {
      const ids = journals.slice(i, i + 300).map((j) => j.id);
      const { data: ls } = await ctx.supabase.from("journal_lines").select("journal_id, account_id, description, debit, credit, line_no").in("journal_id", ids).order("line_no");
      const lines = (ls ?? []) as { journal_id: string; account_id: string; description: string | null; debit: number; credit: number }[];
      lines.sort((a, b) => ids.indexOf(a.journal_id) - ids.indexOf(b.journal_id));
      for (const l of lines) {
        const j = byId.get(l.journal_id)!;
        const a = acc.get(l.account_id);
        rows.push({ date: j.journal_date, reference: j.number ?? "", code: a?.code ?? "", name: a?.name ?? "", description: l.description ?? j.description, debit: Number(l.debit), credit: Number(l.credit) });
      }
    }
  }
  const name = `kageflow-journals-${from}-to-${to}.csv`;
  return new Response(journalCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
