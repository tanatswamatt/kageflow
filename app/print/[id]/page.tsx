import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocumentView } from "@/components/sales/document-view";
import { PrintButton } from "@/components/print-button";
import { getContext } from "@/lib/context";
import { loadDocumentData } from "@/lib/document-data";

export const metadata: Metadata = { title: "Print" };

export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  const data = await loadDocumentData(ctx.supabase, ctx.companyId, id);
  if (!data) notFound();
  return (
    <main className="min-h-dvh bg-paper py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden"><PrintButton /></div>
      <div className="shadow-sm print:shadow-none"><DocumentView data={data} /></div>
    </main>
  );
}
