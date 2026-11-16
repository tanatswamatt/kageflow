"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { cleanError, done, fail, str } from "@/lib/forms";
import { EXPORT_DOC_KINDS, EXPORT_METHODS, EXTRACTION_FIELDS, INCOTERMS } from "@/lib/exports";
import { extractExportFields } from "@/lib/exports-ai";
import type { ExportDocumentKind, ExportIncoterm } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);

function dateField(fd: FormData, key: string, back: string, label: string, required = false): string | null {
  const value = str(fd, key);
  if (!value) {
    if (required) fail(back, `${label} is required`);
    return null;
  }
  if (!DATE_RE.test(value)) fail(back, `${label} must be a date`);
  return value;
}

async function memberOrFail(companyId: string, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const ctx = await getContext();
  const { data } = await ctx.supabase
    .from("company_members")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

function revalidateCase(id?: string) {
  revalidatePath("/exports");
  if (id) revalidatePath(`/exports/${id}`);
}

export async function createExportCase(fd: FormData) {
  const back = "/exports/new";
  const ctx = await getContext();
  if (!ctx.can("exports.write")) fail(back, "Your role can view export cases but not create them");

  let orderId = str(fd, "order_id");
  let unitId = str(fd, "unit_id");
  const sale = str(fd, "sale");
  if (sale && (!orderId || !unitId)) {
    const [saleOrder, saleUnit] = sale.split("|");
    orderId = orderId ?? saleOrder ?? null;
    unitId = unitId ?? saleUnit ?? null;
  }
  if (!orderId || !unitId) fail(back, "Choose the sale and the vehicle on it");

  const { data: order } = await ctx.supabase
    .from("sales_docs")
    .select("id, doc_type, status, account_id, number, currency, total")
    .eq("id", orderId)
    .eq("company_id", ctx.companyId)
    .maybeSingle();
  if (!order || order.doc_type !== "order") fail(back, "Choose a sales order");
  if (!["open", "fulfilled"].includes(order.status as string)) fail(back, "Confirm the sales order before opening an export case");

  const { data: line } = await ctx.supabase
    .from("sales_doc_lines")
    .select("unit_id")
    .eq("doc_id", orderId)
    .eq("unit_id", unitId)
    .maybeSingle();
  if (!line) fail(back, "That vehicle is not on the selected order");

  const { data: ruleset } = await ctx.supabase
    .from("export_rulesets")
    .select("id, origin_country, destination_country, version, effective_from")
    .eq("company_id", ctx.companyId)
    .eq("status", "published")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!ruleset) fail(back, "No export checklist has been published for this company. Ask an owner to publish one.");
  if ((ruleset.effective_from as string) > today()) fail(back, "The current checklist is not effective yet");

  const route = str(fd, "route") ?? "Beitbridge road corridor";
  const incoterm = (str(fd, "incoterm") ?? "DAP") as ExportIncoterm;
  if (!INCOTERMS.includes(incoterm)) fail(back, "Choose a valid Incoterm");
  const departure = dateField(fd, "planned_departure", back, "Planned departure", true);
  const arrival = dateField(fd, "planned_arrival", back, "Planned arrival", true);
  if (departure && arrival && arrival < departure) fail(back, "Planned arrival cannot be before departure");
  const proofDue = dateField(fd, "proof_of_export_due_date", back, "Proof-of-export due date", true);

  const proofOwner = str(fd, "proof_of_export_owner");
  if (!proofOwner) fail(back, "Choose who owns the proof of export");
  if (!(await memberOrFail(ctx.companyId, proofOwner))) fail(back, "The proof-of-export owner must be a team member");

  const ownerId = str(fd, "owner_id") ?? ctx.user.id;
  if (!(await memberOrFail(ctx.companyId, ownerId))) fail(back, "The case owner must be a team member");

  const { data, error } = await ctx.supabase
    .from("export_cases")
    .insert({
      company_id: ctx.companyId,
      account_id: order.account_id,
      unit_id: unitId,
      order_id: orderId,
      ruleset_id: ruleset.id,
      origin_country: ruleset.origin_country,
      destination_country: ruleset.destination_country,
      route,
      incoterm,
      incoterm_place: str(fd, "incoterm_place"),
      planned_departure: departure,
      planned_arrival: arrival,
      destination_requirements: str(fd, "destination_requirements"),
      notes: str(fd, "notes"),
      owner_id: ownerId,
      proof_of_export_due_date: proofDue,
      proof_of_export_owner: proofOwner,
    })
    .select("id")
    .single();
  if (error) {
    if (error.message.includes("export_cases_active_unit_idx") || error.message.includes("duplicate key")) {
      fail(back, "That vehicle already has an open export case. Open it instead of creating another.");
    }
    fail(back, cleanError(error.message));
  }

  const { error: evalError } = await ctx.supabase.rpc("evaluate_export_case", { p_case: data.id });
  revalidateCase(data.id);
  if (evalError) fail(`/exports/${data.id}`, `Case created, but the checklist could not run: ${cleanError(evalError.message)}`);
  done(`/exports/${data.id}`, "Export case created and the checklist has been run. Review the blockers and evidence below.");
}

export async function updateExportCase(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/exports/${id}`;
  const ctx = await getContext();
  if (!ctx.can("exports.write")) fail(back, "Your role cannot change export cases");

  const { data: current } = await ctx.supabase
    .from("export_cases")
    .select("id, status, order_id")
    .eq("id", id)
    .eq("company_id", ctx.companyId)
    .maybeSingle();
  if (!current) fail(back, "Export case not found");
  if (["approved", "released"].includes(current.status as string)) fail(back, "An approved export case is locked");
  if (current.status === "cancelled") fail(back, "A cancelled export case cannot be edited");

  const incoterm = (str(fd, "incoterm") ?? "DAP") as ExportIncoterm;
  if (!INCOTERMS.includes(incoterm)) fail(back, "Choose a valid Incoterm");
  const departure = dateField(fd, "planned_departure", back, "Planned departure", true);
  const arrival = dateField(fd, "planned_arrival", back, "Planned arrival", true);
  if (departure && arrival && arrival < departure) fail(back, "Planned arrival cannot be before departure");

  const proofOwner = str(fd, "proof_of_export_owner");
  if (proofOwner && !(await memberOrFail(ctx.companyId, proofOwner))) fail(back, "The proof-of-export owner must be a team member");
  const ownerId = str(fd, "owner_id");
  if (ownerId && !(await memberOrFail(ctx.companyId, ownerId))) fail(back, "The case owner must be a team member");

  const { error } = await ctx.supabase
    .from("export_cases")
    .update({
      route: str(fd, "route") ?? "Beitbridge road corridor",
      incoterm,
      incoterm_place: str(fd, "incoterm_place"),
      planned_departure: departure,
      planned_arrival: arrival,
      proof_of_export_due_date: dateField(fd, "proof_of_export_due_date", back, "Proof-of-export due date", true),
      proof_of_export_owner: proofOwner,
      owner_id: ownerId,
      destination_requirements: str(fd, "destination_requirements"),
      notes: str(fd, "notes"),
    })
    .eq("id", id)
    .eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));

  if (current.status !== "draft") {
    await ctx.supabase.rpc("evaluate_export_case", { p_case: id });
  }
  revalidateCase(id);
  done(back, current.status === "draft" ? "Export details saved. Run the checklist when you are ready." : "Export details saved and readiness refreshed.");
}

export async function evaluateExportCase(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/exports/${id}`;
  const ctx = await getContext();
  if (!ctx.can("exports.write")) fail(back, "Your role cannot check export readiness");
  const { data: current } = await ctx.supabase
    .from("export_cases").select("status").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!current) fail(back, "Export case not found");
  if (["approved", "released", "cancelled"].includes(current.status as string)) fail(back, "This case can no longer be checked");

  const { data, error } = await ctx.supabase.rpc("evaluate_export_case", { p_case: id });
  if (error) fail(back, cleanError(error.message));
  revalidateCase(id);

  const summary = data as { status?: string; blockers?: { title: string; note: string | null }[] } | null;
  const first = summary?.blockers?.[0];
  if (summary?.status === "ready_for_approval") {
    done(back, "Ready for approval. Every blocking requirement now has a passing check.");
  }
  if (summary?.status === "in_review") {
    done(back, `In review: ${first?.title ?? "a requirement needs a person"}${first?.note ? ` — ${first.note}` : ""}`);
  }
  done(back, `Blocked: ${first?.title ?? "a requirement is missing"}${first?.note ? ` — ${first.note}` : ""}`);
}

type DocumentInput = {
  caseId: string;
  docType: string;
  label?: string | null;
  storagePath: string;
  fileName: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
};

/** The browser uploads the file to the private bucket, then this records it and re-runs readiness. */
export async function recordExportDocument(input: DocumentInput): Promise<{ error?: string }> {
  const ctx = await getContext();
  if (!ctx.can("exports.write")) return { error: "Your role cannot attach export documents" };
  if (!EXPORT_DOC_KINDS.includes(input.docType as ExportDocumentKind)) return { error: "Choose a document type" };
  if (!input.storagePath.startsWith(`${ctx.companyId}/${input.caseId}/`)) return { error: "That file is not in this case's folder" };

  const { data: current } = await ctx.supabase
    .from("export_cases").select("status").eq("id", input.caseId).eq("company_id", ctx.companyId).maybeSingle();
  if (!current) return { error: "Export case not found" };
  if (["approved", "released"].includes(current.status as string)) return { error: "Export evidence is locked after approval" };
  if (current.status === "cancelled") return { error: "This export case is cancelled" };

  const { error } = await ctx.supabase.from("export_documents").insert({
    company_id: ctx.companyId,
    case_id: input.caseId,
    doc_type: input.docType,
    label: input.label || null,
    storage_path: input.storagePath,
    file_name: input.fileName,
    mime_type: input.mimeType || null,
    size_bytes: input.sizeBytes ?? null,
  });
  if (error) {
    await ctx.supabase.storage.from("export-documents").remove([input.storagePath]);
    return { error: cleanError(error.message) };
  }
  await ctx.supabase.rpc("evaluate_export_case", { p_case: input.caseId });
  revalidateCase(input.caseId);
  return {};
}

export async function deleteExportDocument(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/exports/${str(fd, "case_id")}`;
  const ctx = await getContext();
  if (!ctx.can("company.manage")) fail(back, "Only owners and admins can remove a document");
  const { data: doc } = await ctx.supabase
    .from("export_documents").select("id, case_id, storage_path").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!doc) fail(back, "Document not found");
  const { data: current } = await ctx.supabase
    .from("export_cases").select("status").eq("id", doc.case_id).eq("company_id", ctx.companyId).maybeSingle();
  if (current && ["approved", "released", "cancelled"].includes(current.status as string)) fail(back, "Export evidence is locked after approval or cancellation");

  await ctx.supabase.storage.from("export-documents").remove([doc.storage_path as string]);
  const { error } = await ctx.supabase.from("export_documents").delete().eq("id", id).eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  if (current && !["approved", "released", "cancelled"].includes(current.status as string)) {
    await ctx.supabase.rpc("evaluate_export_case", { p_case: doc.case_id });
  }
  revalidateCase(doc.case_id as string);
  done(back, "Document removed. Readiness has been refreshed.");
}

export async function reviewExportDocument(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/exports/${str(fd, "case_id")}`;
  const ctx = await getContext();
  if (!ctx.can("exports.review")) fail(back, "Only owners, admins and accountants can review export documents");
  const decision = str(fd, "decision");
  if (!decision) fail(back, "Choose accept or reject");
  const { error } = await ctx.supabase.rpc("review_export_document", {
    p_document: id,
    p_status: decision,
    p_note: str(fd, "review_note"),
  });
  if (error) fail(back, cleanError(error.message));
  revalidateCase(back.split("/").pop());
  done(back, decision === "accepted" ? "Document accepted. Readiness has been refreshed." : "Document rejected. Readiness has been refreshed.");
}

export async function resolveExportReviewItem(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/exports/${str(fd, "case_id")}`;
  const ctx = await getContext();
  if (!ctx.can("exports.review")) fail(back, "Only owners, admins and accountants can resolve a document conflict");
  const action = str(fd, "action");
  if (action !== "resolved" && action !== "dismissed") fail(back, "Choose resolve or dismiss");
  const note = str(fd, "note");
  if (!note) fail(back, "Say what you checked before resolving this conflict");

  const { data: item } = await ctx.supabase
    .from("export_review_items").select("id, case_id").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!item) fail(back, "Review item not found");
  const { error } = await ctx.supabase
    .from("export_review_items")
    .update({ status: action, resolution_note: note })
    .eq("id", id)
    .eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  await ctx.supabase.rpc("evaluate_export_case", { p_case: item.case_id });
  revalidateCase(item.case_id as string);
  done(back, action === "resolved" ? "Conflict resolved and readiness refreshed." : "Conflict dismissed with a note and readiness refreshed.");
}

export async function extractExportDocument(fd: FormData) {
  const documentId = str(fd, "id")!;
  const caseId = str(fd, "case_id")!;
  const back = `/exports/${caseId}`;
  const ctx = await getContext();
  if (!ctx.can("exports.write")) fail(back, "Your role cannot run document extraction");
  const text = str(fd, "text");
  if (!text) fail(back, "Paste some document text for the assistant to read");

  const { data: doc } = await ctx.supabase
    .from("export_documents")
    .select("id, case_id, file_name, doc_type, review_status")
    .eq("id", documentId)
    .eq("case_id", caseId)
    .eq("company_id", ctx.companyId)
    .maybeSingle();
  if (!doc) fail(back, "Document not found");
  if (doc.review_status === "accepted") fail(back, "An accepted document is locked");

  const result = await extractExportFields({ text, fileName: doc.file_name as string, docType: doc.doc_type as string });
  const count = Object.keys(result.fields).length;

  const { error: logError } = await ctx.supabase.from("export_ai_suggestions").insert({
    company_id: ctx.companyId,
    case_id: caseId,
    document_id: documentId,
    kind: "document_extraction",
    model: result.model,
    prompt_version: result.promptVersion,
    input_summary: { character_count: text.length, file_name: doc.file_name },
    output: { fields: result.fields, notes: result.notes },
    status: "proposed",
  });
  if (logError) fail(back, cleanError(logError.message));

  const { error } = await ctx.supabase.from("export_documents").update({
    extracted_fields: result.fields,
    extraction_source: result.source,
    extraction_at: new Date().toISOString(),
  }).eq("id", documentId).eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));

  revalidateCase(caseId);
  done(back, count === 0
    ? "The assistant found no labelled fields. Add them manually below; nothing was changed."
    : `The assistant proposed ${count} field${count === 1 ? "" : "s"}. Check each value and source, then confirm or correct them. Nothing was changed yet.`);
}

export async function dismissExportSuggestion(fd: FormData) {
  const id = str(fd, "id")!;
  const caseId = str(fd, "case_id")!;
  const back = `/exports/${caseId}`;
  const ctx = await getContext();
  if (!ctx.can("exports.write")) fail(back, "Your role cannot change document suggestions");
  const { error } = await ctx.supabase
    .from("export_ai_suggestions")
    .update({ status: "rejected", decision_note: "Not used" })
    .eq("id", id)
    .eq("case_id", caseId)
    .eq("company_id", ctx.companyId)
    .eq("status", "proposed");
  if (error) fail(back, cleanError(error.message));
  revalidateCase(caseId);
  done(back, "Suggestion dismissed and the decision logged. No fields were changed.");
}

export async function confirmExportExtraction(fd: FormData) {
  const documentId = str(fd, "id")!;
  const caseId = str(fd, "case_id")!;
  const back = `/exports/${caseId}`;
  const ctx = await getContext();
  if (!ctx.can("exports.write")) fail(back, "Your role cannot confirm document fields");

  const fields: Record<string, string> = {};
  for (const f of EXTRACTION_FIELDS) {
    const value = str(fd, `f_${f.key}`);
    if (value) fields[f.key] = value;
  }
  if (Object.keys(fields).length === 0) fail(back, "Enter at least one confirmed field");

  const { data, error } = await ctx.supabase.rpc("confirm_export_extraction", {
    p_document: documentId,
    p_fields: fields,
    p_suggestion: str(fd, "suggestion_id"),
  });
  if (error) fail(back, cleanError(error.message));
  revalidateCase(caseId);
  const count = Number((data as { review_items?: number } | null)?.review_items ?? 0);
  done(back, count === 0
    ? "Fields confirmed. They match the buyer, vehicle and sale; no conflicts were found."
    : `Fields confirmed and ${count} conflict${count === 1 ? "" : "s"} added for review. The underlying records were not changed.`);
}

export async function rejectExportCase(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/exports/${id}`;
  const ctx = await getContext();
  if (!ctx.can("exports.approve")) fail(back, "Only owners and admins can reject an export release");
  const reason = str(fd, "reason");
  if (!reason) fail(back, "Say why the release is being rejected");
  const { error } = await ctx.supabase.rpc("reject_export_case", { p_case: id, p_reason: reason });
  if (error) fail(back, cleanError(error.message));
  revalidateCase(id);
  done(back, "Rejection recorded with the checklist snapshot. The case is back in review.");
}

export async function approveExportCase(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/exports/${id}`;
  const ctx = await getContext();
  if (!ctx.can("exports.approve")) fail(back, "Only owners and admins can approve an export release");
  const { error } = await ctx.supabase.rpc("approve_export_case", { p_case: id, p_note: str(fd, "note") });
  if (error) fail(back, cleanError(error.message));
  revalidateCase(id);
  done(back, "Approved. Your decision and the checklist evidence snapshot are recorded. Release is a separate action.");
}

export async function releaseExportCase(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/exports/${id}`;
  const ctx = await getContext();
  if (!ctx.can("exports.release")) fail(back, "Only owners and admins can release an export");
  const method = str(fd, "method") ?? "vehicle_handover";
  if (!EXPORT_METHODS.includes(method as (typeof EXPORT_METHODS)[number])) fail(back, "Choose how the vehicle is released");
  const { error } = await ctx.supabase.rpc("release_export_case", { p_case: id, p_method: method, p_note: str(fd, "note") });
  if (error) fail(back, cleanError(error.message));
  revalidateCase(id);
  done(back, "Released and recorded. The order tracker now shows Released for export.");
}

export async function cancelExportCase(fd: FormData) {
  const id = str(fd, "id")!;
  const back = `/exports/${id}`;
  const ctx = await getContext();
  if (!ctx.can("exports.approve")) fail(back, "Only owners and admins can cancel an export case");
  const { data: current } = await ctx.supabase
    .from("export_cases").select("status").eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  if (!current) fail(back, "Export case not found");
  if (["approved", "released"].includes(current.status as string)) fail(back, "An approved or released case cannot be cancelled");
  const { error } = await ctx.supabase.from("export_cases").update({ status: "cancelled" }).eq("id", id).eq("company_id", ctx.companyId);
  if (error) fail(back, cleanError(error.message));
  revalidateCase(id);
  done("/exports", "Export case cancelled.");
}

export async function createExportRulesetVersion() {
  const back = "/exports/checklist";
  const ctx = await getContext();
  if (!ctx.can("company.manage")) fail(back, "Only owners and admins can version the export checklist");
  const { error } = await ctx.supabase.rpc("create_export_ruleset_version", { p_company: ctx.companyId });
  if (error) fail(back, cleanError(error.message));
  revalidatePath(back);
  done(back, "Draft checklist version created. Edit it and publish it when it has been reviewed.");
}

export async function updateExportRulesetMetadata(fd: FormData) {
  const back = "/exports/checklist";
  const ctx = await getContext();
  if (!ctx.can("company.manage")) fail(back, "Only owners and admins can edit the export checklist");
  const rulesetId = str(fd, "ruleset_id");
  if (!rulesetId) fail(back, "Checklist version not found");
  const { error } = await ctx.supabase.rpc("update_export_ruleset_metadata", {
    p_ruleset: rulesetId,
    p_title: str(fd, "title"),
    p_source_title: str(fd, "source_title"),
    p_source_url: str(fd, "source_url"),
    p_notes: str(fd, "notes"),
  });
  if (error) fail(back, cleanError(error.message));
  revalidatePath(back);
  done(back, "Draft checklist details saved.");
}

export async function updateExportRulesetItem(fd: FormData) {
  const back = "/exports/checklist";
  const ctx = await getContext();
  if (!ctx.can("company.manage")) fail(back, "Only owners and admins can edit the export checklist");
  const itemId = str(fd, "item_id");
  if (!itemId) fail(back, "Checklist item not found");
  const blocking = str(fd, "blocking");
  if (blocking !== "true" && blocking !== "false") fail(back, "Choose whether this item blocks readiness");
  let params: Record<string, unknown> | null = null;
  const documentGroups = str(fd, "document_groups");
  if (documentGroups) {
    try {
      params = { document_groups: JSON.parse(documentGroups) as unknown };
    } catch {
      fail(back, "Required document groups must be valid JSON");
    }
  }
  const { error } = await ctx.supabase.rpc("update_export_ruleset_item", {
    p_item: itemId,
    p_title: str(fd, "title"),
    p_description: str(fd, "description"),
    p_blocking: blocking === "true",
    p_evidence_hint: str(fd, "evidence_hint"),
    p_params: params,
  });
  if (error) fail(back, cleanError(error.message));
  revalidatePath(back);
  revalidatePath("/exports");
  done(back, "Draft checklist item saved.");
}

export async function publishExportRuleset(fd: FormData) {
  const back = "/exports/checklist";
  const ctx = await getContext();
  if (!ctx.can("company.manage")) fail(back, "Only owners and admins can publish the export checklist");
  const rulesetId = str(fd, "ruleset_id");
  if (!rulesetId) fail(back, "Checklist version not found");
  const { error } = await ctx.supabase.rpc("publish_export_ruleset", { p_ruleset: rulesetId });
  if (error) fail(back, cleanError(error.message));
  revalidatePath(back);
  revalidatePath("/exports");
  done(back, "Checklist version published. New export cases will use it; existing cases keep their version.");
}
