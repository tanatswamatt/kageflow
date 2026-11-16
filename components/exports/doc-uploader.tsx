"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass, Select } from "@/components/ui";
import { EXPORT_DOC_KINDS, EXPORT_DOC_LABEL } from "@/lib/exports";
import { browserClient } from "@/lib/supabase/browser";
import type { ExportDocumentKind } from "@/lib/types";

type RecordInput = {
  caseId: string;
  docType: string;
  storagePath: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
};

/** Uploads to the private export bucket, then records the document through a server action. */
export function ExportDocUploader({ companyId, caseId, record }: {
  companyId: string;
  caseId: string;
  record: (input: RecordInput) => Promise<{ error?: string }>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [docType, setDocType] = useState<ExportDocumentKind>("commercial_invoice");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > 25 * 1024 * 1024) return setError("That file is over 25 MB. Take a smaller scan or photo.");
    if (!/^(application\/pdf|image\/)/.test(file.type)) return setError("Upload a PDF or an image of the document.");
    setBusy(true);
    try {
      const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(-80) || "document";
      const path = `${companyId}/${caseId}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await browserClient().storage.from("export-documents").upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;
      const result = await record({
        caseId,
        docType,
        storagePath: path,
        fileName: file.name,
        mimeType: file.type || null,
        sizeBytes: file.size,
      });
      if (result.error) throw new Error(result.error);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={docType} onChange={(e) => setDocType(e.target.value as ExportDocumentKind)} aria-label="Document type" className="h-8 w-auto min-w-[190px] text-[13px]">
          {EXPORT_DOC_KINDS.map((kind) => <option key={kind} value={kind}>{EXPORT_DOC_LABEL[kind]}</option>)}
        </Select>
        <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className={buttonClass("secondary", "sm")}>
          {busy ? "Uploading…" : "Attach a document"}
        </button>
      </div>
      <p className="text-[12px] text-ink-faint">Private bucket. PDF or image, up to 25 MB. The document waits for a reviewer.</p>
      {error && <p className="text-[13px] text-ember-700">{error}</p>}
    </div>
  );
}
