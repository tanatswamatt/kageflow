import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge, Button, ButtonLink, Dl, Field, Input, Notice, PageHeader, Panel, Select, Table, Td, Textarea, Th,
} from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ExportDocUploader } from "@/components/exports/doc-uploader";
import { getContext } from "@/lib/context";
import { getMembers } from "@/lib/members";
import { date, dateTime, moneyFor } from "@/lib/format";
import {
  CHECK_RESULT_LABEL, CHECK_RESULT_TONE, EXPORT_DOC_LABEL, EXPORT_DOC_STATUS_LABEL, EXPORT_DOC_STATUS_TONE,
  EXPORT_METHODS, EXPORT_METHOD_LABEL, EXPORT_STATUS_HELP, EXPORT_STATUS_LABEL, EXPORT_STATUS_TONE,
  EXTRACTION_FIELDS, INCOTERMS, shortVIN,
} from "@/lib/exports";
import type {
  ExportAiSuggestion, ExportApproval, ExportCase, ExportCaseCheck, ExportDocument,
  ExportRelease, ExportReviewItem, ExportRuleset, ExportRulesetItem,
} from "@/lib/types";
import {
  approveExportCase, cancelExportCase, confirmExportExtraction, deleteExportDocument, dismissExportSuggestion,
  evaluateExportCase, extractExportDocument, recordExportDocument, rejectExportCase, releaseExportCase,
  resolveExportReviewItem, reviewExportDocument, updateExportCase,
} from "../actions";

export const metadata: Metadata = { title: "Export case" };

type CaseRow = ExportCase & {
  crm_accounts: { id: string; name: string; email: string | null; billing_address: string | null; country: string | null } | null;
  inventory_units: {
    id: string; stock_no: string | null; make: string | null; model: string | null; variant: string | null;
    year: number | null; serial_no: string; status: string; vin_confirmed: boolean; reg_doc_path: string | null;
  } | null;
  sales_docs: {
    id: string; number: string | null; status: string; currency: string; total: number; amount_due: number;
    issue_date: string; tracking_stage: string | null;
  } | null;
  export_rulesets: ExportRuleset;
};

type ProposedField = { value?: unknown; confidence?: unknown; source?: unknown };

function proposedFields(suggestion: ExportAiSuggestion | undefined): Record<string, ProposedField> {
  const fields = suggestion?.output?.fields;
  return fields && typeof fields === "object" && !Array.isArray(fields) ? (fields as Record<string, ProposedField>) : {};
}

function proposedNotes(suggestion: ExportAiSuggestion | undefined): string[] {
  const notes = suggestion?.output?.notes;
  return Array.isArray(notes) ? notes.filter((n): n is string => typeof n === "string") : [];
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function EvidenceValue({ value }: { value: unknown }): React.ReactNode {
  if (value === null || value === undefined || value === "") return <span className="text-ink-faint">—</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "string" || typeof value === "number") return <span>{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-ink-faint">None</span>;
    return <ul className="list-disc pl-4">{value.map((v, i) => <li key={i}><EvidenceValue value={v} /></li>)}</ul>;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined && v !== "");
    if (entries.length === 0) return <span className="text-ink-faint">None</span>;
    return (
      <dl className="grid grid-cols-[minmax(95px,auto)_1fr] gap-x-3 gap-y-1">
        {entries.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-faint">{k.replace(/_/g, " ")}</dt>
            <dd className="min-w-0 break-words"><EvidenceValue value={v} /></dd>
          </div>
        ))}
      </dl>
    );
  }
  return null;
}

export default async function ExportCasePage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { id } = await params;
  const notice = await searchParams;
  const ctx = await getContext();
  const money = moneyFor(ctx.company.base_currency);

  const { data } = await ctx.supabase
    .from("export_cases")
    .select(`
      *,
      crm_accounts(id, name, email, billing_address, country),
      inventory_units(id, stock_no, make, model, variant, year, serial_no, status, vin_confirmed, reg_doc_path),
      sales_docs(id, number, status, currency, total, amount_due, issue_date, tracking_stage),
      export_rulesets(id, company_id, corridor_code, origin_country, destination_country, version, status, title,
                      source_title, source_url, effective_from, notes, published_by, published_at)
    `)
    .eq("id", id)
    .eq("company_id", ctx.companyId)
    .maybeSingle();
  if (!data) notFound();
  const ec = data as unknown as CaseRow;
  const ruleset = ec.export_rulesets;
  const buyer = ec.crm_accounts;
  const unit = ec.inventory_units;
  const order = ec.sales_docs;

  const [
    { data: checkData }, { data: docData }, { data: reviewData }, { data: approvalData },
    { data: releaseData }, { data: suggestionData }, { data: itemData }, members,
  ] = await Promise.all([
    ctx.supabase.from("export_case_checks").select("*").eq("case_id", id).eq("company_id", ctx.companyId),
    ctx.supabase.from("export_documents").select("*").eq("case_id", id).eq("company_id", ctx.companyId).order("uploaded_at"),
    ctx.supabase.from("export_review_items").select("*").eq("case_id", id).eq("company_id", ctx.companyId).order("created_at"),
    ctx.supabase.from("export_approvals").select("*").eq("case_id", id).eq("company_id", ctx.companyId).order("approved_at", { ascending: false }),
    ctx.supabase.from("export_releases").select("*").eq("case_id", id).eq("company_id", ctx.companyId).maybeSingle(),
    ctx.supabase.from("export_ai_suggestions").select("*").eq("case_id", id).eq("company_id", ctx.companyId).order("created_at", { ascending: false }),
    ctx.supabase.from("export_ruleset_items").select("*").eq("ruleset_id", ec.ruleset_id).eq("company_id", ctx.companyId).order("position"),
    getMembers(),
  ]);

  const names = new Map(members.map((m) => [m.user_id, m.name]));
  const items = (itemData ?? []) as ExportRulesetItem[];
  const itemById = new Map(items.map((i) => [i.id, i]));
  const checks = ((checkData ?? []) as ExportCaseCheck[]).slice().sort(
    (a, b) => (itemById.get(a.ruleset_item_id)?.position ?? 99) - (itemById.get(b.ruleset_item_id)?.position ?? 99),
  );
  const docs = (docData ?? []) as ExportDocument[];
  const reviews = (reviewData ?? []) as ExportReviewItem[];
  const approvals = (approvalData ?? []) as ExportApproval[];
  const release = (releaseData ?? null) as ExportRelease | null;
  const suggestions = (suggestionData ?? []) as ExportAiSuggestion[];
  const latestByDoc = new Map<string, ExportAiSuggestion>();
  for (const suggestion of suggestions) {
    if (suggestion.document_id && !latestByDoc.has(suggestion.document_id)) latestByDoc.set(suggestion.document_id, suggestion);
  }
  const docById = new Map(docs.map((d) => [d.id, d]));

  const signed = new Map<string, string | null>();
  await Promise.all(docs.map(async (doc) => {
    const { data: url } = await ctx.supabase.storage.from("export-documents").createSignedUrl(doc.storage_path, 600);
    signed.set(doc.id, url?.signedUrl ?? null);
  }));

  const canWrite = ctx.can("exports.write");
  const canReview = ctx.can("exports.review");
  const canApprove = ctx.can("exports.approve");
  const canRelease = ctx.can("exports.release");
  const isOpen = !["approved", "released", "cancelled"].includes(ec.status);
  const editable = canWrite && isOpen;
  const blockers = checks.filter((c) => c.result !== "pass");
  const firstBlocker = blockers[0];
  const openReviews = reviews.filter((r) => r.status === "open");
  const blockingReviews = openReviews.filter((r) => r.severity === "blocking");
  const approvedCount = approvals.filter((a) => a.decision === "approved").length;

  const nameOf = (userId: string | null | undefined) => (userId ? names.get(userId) ?? "Former member" : "—");
  const nextOwnerId = firstBlocker?.rule_code === "proof_of_export" ? ec.proof_of_export_owner : ec.owner_id;
  const vehicleLabel = [unit?.year, unit?.make, unit?.model, unit?.variant].filter(Boolean).join(" ") || "Vehicle";
  const lastCheckedBy = nameOf(ec.last_evaluated_by);

  let readiness: string;
  if (ec.status === "released") {
    readiness = `Released ${date(ec.released_at)} by ${nameOf(ec.released_by)}. The approval and this release are in the audit trail.`;
  } else if (ec.status === "approved") {
    readiness = `Approved ${date(ec.approved_at)} by ${nameOf(ec.approved_by)}. Release is still a separate action.`;
  } else if (ec.status === "ready_for_approval") {
    readiness = "Ready for approval. Every blocking check passes; an owner or admin must review the evidence and approve.";
  } else if (ec.status === "cancelled") {
    readiness = "This case is cancelled and no longer blocks the vehicle.";
  } else if (ec.status === "draft") {
    readiness = "Not checked yet. Run the checklist to see what is missing.";
  } else {
    const reason = firstBlocker?.note ?? firstBlocker?.rule_title ?? "a requirement still needs attention";
    readiness = `${ec.status === "blocked" ? "Blocked" : "In review"} because ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;
  }

  const facts: [string, React.ReactNode][] = [
    ["Buyer", buyer ? <Link href={`/crm/accounts/${buyer.id}`} className="text-shadow-700 hover:underline">{buyer.name}</Link> : "Missing"],
    ["Vehicle", unit ? <Link href={`/inventory/units/${unit.id}`} className="text-shadow-700 hover:underline">{vehicleLabel}</Link> : "Missing"],
    ["VIN", unit ? <span className="font-mono text-[13px]">{unit.serial_no}</span> : "—"],
    ["Sales order", order ? <Link href={`/sales/doc/${order.id}`} className="text-shadow-700 hover:underline">{order.number ?? "Draft"}</Link> : "Missing"],
    ["Route", `${ec.origin_country} → ${ec.destination_country}`],
    ["Extra requirements", ec.destination_requirements || "Corridor checklist only"],
    ["Incoterm", `${ec.incoterm}${ec.incoterm_place ? ` · ${ec.incoterm_place}` : ""}`],
    ["Planned", `${date(ec.planned_departure)}${ec.planned_arrival ? ` → ${date(ec.planned_arrival)}` : ""}`],
    ["Proof due", date(ec.proof_of_export_due_date)],
    ["Proof owner", nameOf(ec.proof_of_export_owner)],
    ["Case owner", nameOf(ec.owner_id)],
    ["Opened", `${date(ec.created_at)} by ${nameOf(ec.created_by)}`],
    ["Last checked", ec.last_evaluated_at ? `${dateTime(ec.last_evaluated_at)} by ${lastCheckedBy}` : "Not checked"],
  ];

  const editForm = editable ? (
    <details className="mt-4 border-t border-line pt-4">
      <summary className="cursor-pointer text-[13px] font-medium text-shadow-700">Edit planning and ownership</summary>
      <form action={updateExportCase} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="id" value={ec.id} />
        <Field label="Route"><Input name="route" defaultValue={ec.route} required /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Incoterm">
            <Select name="incoterm" defaultValue={ec.incoterm}>
              {INCOTERMS.map((i) => <option key={i} value={i}>{i}</option>)}
            </Select>
          </Field>
          <Field label="Named place"><Input name="incoterm_place" defaultValue={ec.incoterm_place ?? ""} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Planned departure"><Input name="planned_departure" type="date" defaultValue={ec.planned_departure ?? ""} required /></Field>
          <Field label="Planned arrival"><Input name="planned_arrival" type="date" defaultValue={ec.planned_arrival ?? ""} required /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Proof-of-export due"><Input name="proof_of_export_due_date" type="date" defaultValue={ec.proof_of_export_due_date ?? ""} required /></Field>
          <Field label="Proof owner">
            <Select name="proof_of_export_owner" defaultValue={ec.proof_of_export_owner ?? ""}>
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Case owner">
          <Select name="owner_id" defaultValue={ec.owner_id ?? ""}>
            <option value="">Unassigned</option>
            {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label="Extra destination requirements"><Textarea name="destination_requirements" rows={3} defaultValue={ec.destination_requirements ?? ""} /></Field>
        <Field label="Internal notes"><Textarea name="notes" rows={2} defaultValue={ec.notes ?? ""} /></Field>
        <SubmitButton size="sm" tone="secondary">Save and refresh readiness</SubmitButton>
      </form>
    </details>
  ) : null;

  return (
    <>
      <PageHeader
        title={ec.case_no ?? "Export case"}
        description={
          <>
            {buyer?.name ?? "Buyer missing"} · {vehicleLabel} · {ec.origin_country} → {ec.destination_country}
          </>
        }
        back={{ href: "/exports", label: "Export cases" }}
        actions={
          <>
            <Badge tone={EXPORT_STATUS_TONE[ec.status]}>{EXPORT_STATUS_LABEL[ec.status]}</Badge>
            {isOpen && canWrite && (
              <form action={evaluateExportCase}>
                <input type="hidden" name="id" value={ec.id} />
                <SubmitButton size="sm" tone="primary" pendingText="Checking…">Run checklist</SubmitButton>
              </form>
            )}
          </>
        }
      />
      <Notice params={notice} />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Readiness" action={<Badge tone={EXPORT_STATUS_TONE[ec.status]}>{EXPORT_STATUS_LABEL[ec.status]}</Badge>}>
            <p className="text-[15px] font-medium leading-snug">{readiness}</p>
            <p className="mt-1 text-[13px] text-ink-soft">{EXPORT_STATUS_HELP[ec.status]}</p>
            <div className="mt-4 rounded-[var(--radius-control)] bg-paper px-4 py-3">
              <Dl
                items={[
                  ["Checklist", `Version ${ruleset.version} · ${ruleset.corridor_code}`],
                  ["Rule source", ruleset.source_url
                    ? <a href={ruleset.source_url} target="_blank" rel="noreferrer" className="text-shadow-700 hover:underline">{ruleset.source_title}</a>
                    : ruleset.source_title],
                  ["Effective", date(ruleset.effective_from)],
                  ["Next step owner", nameOf(nextOwnerId)],
                ]}
              />
            </div>
            {blockers.length > 0 && (
              <ul className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
                {blockers.map((check) => (
                  <li key={check.id} className="flex flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={CHECK_RESULT_TONE[check.result]}>{CHECK_RESULT_LABEL[check.result]}</Badge>
                      <span className="text-[13px] font-medium">{check.rule_title}</span>
                    </div>
                    <span className="text-[13px] text-ink-soft">{check.note ?? "No explanation recorded."}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Checklist" action={<span className="text-[12px] text-ink-faint">v{ruleset.version} · {date(ruleset.effective_from)}</span>} flush>
            {!canWrite ? (
              <p className="px-5 py-10 text-center text-[13px] text-ink-soft">Checklist evidence is visible to staff with sales access.</p>
            ) : (
            <Table>
              <thead>
                <tr><Th>Requirement</Th><Th>Result</Th><Th>Evidence and why</Th><Th>Checked</Th></tr>
              </thead>
              <tbody>
                {checks.length === 0 && (
                  <tr><Td colSpan={4}><span className="text-ink-soft">The checklist has not been run yet. Use Run checklist above.</span></Td></tr>
                )}
                {checks.map((check) => {
                  const item = itemById.get(check.ruleset_item_id);
                  return (
                    <tr key={check.id}>
                      <Td className="max-w-[240px]">
                        <div className="font-medium">{check.rule_title}</div>
                        <div className="text-[12px] text-ink-faint">{item?.category ?? "check"} · {check.rule_code}{check.blocking ? " · blocking" : ""}</div>
                      </Td>
                      <Td><Badge tone={CHECK_RESULT_TONE[check.result]}>{CHECK_RESULT_LABEL[check.result]}</Badge></Td>
                      <Td className="max-w-[360px]">
                        {check.note && <p className="mb-2 text-[13px] text-ink-soft">{check.note}</p>}
                        <details>
                          <summary className="cursor-pointer text-[12px] font-medium text-shadow-700">Evidence used</summary>
                          <div className="mt-2 rounded border border-line bg-paper p-3 text-[12px]">
                            <EvidenceValue value={check.evidence} />
                          </div>
                          {item?.evidence_hint && <p className="mt-2 text-[11px] text-ink-faint">Expected evidence: {item.evidence_hint}</p>}
                          {item?.description && <p className="mt-1 text-[11px] text-ink-faint">{item.description}</p>}
                        </details>
                      </Td>
                      <Td className="whitespace-nowrap text-[12px] text-ink-soft">
                        {dateTime(check.checked_at)}
                        <div className="text-ink-faint">{nameOf(check.checked_by)}</div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            )}
            <p className="border-t border-line px-5 py-3 text-[12px] text-ink-faint">
              Rule set v{ruleset.version} · effective {date(ruleset.effective_from)} · {ruleset.source_title}. Results are deterministic; a person only confirms evidence and resolves ambiguity.
            </p>
          </Panel>

          <Panel title="Documents and evidence" action={<Badge>{docs.length} attached</Badge>}>
            {canWrite && isOpen && (
              <div className="mb-4 border-b border-line pb-4">
                <ExportDocUploader companyId={ctx.companyId} caseId={ec.id} record={recordExportDocument} />
              </div>
            )}
            {docs.length === 0 ? (
              <p className="text-[13px] text-ink-soft">
                {canWrite ? "No documents attached yet. The checklist names the required groups." : "Documents are visible to staff with sales access."}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {docs.map((doc) => {
                  const suggestion = latestByDoc.get(doc.id);
                  const fields = proposedFields(suggestion);
                  const notes = proposedNotes(suggestion);
                  const confirmed = doc.confirmed_fields ?? {};
                  const canReviewThis = canReview && !["accepted", "rejected"].includes(doc.review_status) && isOpen;
                  return (
                    <li key={doc.id} className="py-4 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{doc.label || EXPORT_DOC_LABEL[doc.doc_type]}</span>
                            <Badge tone={EXPORT_DOC_STATUS_TONE[doc.review_status]}>{EXPORT_DOC_STATUS_LABEL[doc.review_status]}</Badge>
                          </div>
                          <div className="mt-0.5 break-all text-[13px] text-ink-soft">
                            {signed.get(doc.id)
                              ? <a href={signed.get(doc.id)!} target="_blank" rel="noreferrer" className="text-shadow-700 hover:underline">{doc.file_name}</a>
                              : doc.file_name}
                            {" · "}{nameOf(doc.uploaded_by)} · {dateTime(doc.uploaded_at)}
                          </div>
                          {doc.reviewed_at && (
                            <div className="text-[12px] text-ink-faint">
                              {EXPORT_DOC_STATUS_LABEL[doc.review_status]} by {nameOf(doc.reviewed_by)} on {dateTime(doc.reviewed_at)}
                              {doc.review_note ? ` · ${doc.review_note}` : ""}
                            </div>
                          )}
                        </div>
                        {ctx.can("company.manage") && isOpen && (
                          <form action={deleteExportDocument}>
                            <input type="hidden" name="id" value={doc.id} />
                            <input type="hidden" name="case_id" value={ec.id} />
                            <SubmitButton size="sm" tone="quiet" confirm="Remove this document and its review?" pendingText="…">Remove</SubmitButton>
                          </form>
                        )}
                      </div>

                      {canReviewThis && (
                        <form action={reviewExportDocument} className="mt-3 flex flex-wrap items-center gap-2">
                          <input type="hidden" name="id" value={doc.id} />
                          <input type="hidden" name="case_id" value={ec.id} />
                          <Select name="decision" defaultValue="" required aria-label="Review decision" className="h-8 w-auto text-[13px]">
                            <option value="" disabled>Accept or reject…</option>
                            <option value="accepted">Accept</option>
                            <option value="rejected">Reject</option>
                          </Select>
                          <Input name="review_note" placeholder="What did you check?" className="h-8 max-w-[250px] text-[13px]" />
                          <SubmitButton size="sm" tone="secondary" pendingText="Recording…">Record review</SubmitButton>
                        </form>
                      )}

                      {isOpen && doc.review_status !== "accepted" && (
                      <details className="mt-3 rounded-[var(--radius-control)] border border-line bg-paper px-3 py-2">
                        <summary className="cursor-pointer text-[13px] font-medium text-shadow-700">
                          Assistant check and field confirmation
                          {suggestion ? ` · proposal ${suggestion.status}` : ""}
                        </summary>
                        <div className="mt-3 flex flex-col gap-3">
                          <p className="text-[12px] text-ink-faint">
                            Paste the document text below. The assistant only proposes fields with a source and confidence; it never changes the buyer, vehicle or sale. You confirm or correct every value.
                          </p>
                          <form action={extractExportDocument} className="flex flex-col gap-2">
                            <input type="hidden" name="id" value={doc.id} />
                            <input type="hidden" name="case_id" value={ec.id} />
                            <Textarea name="text" rows={4} placeholder="Paste the invoice, waybill or customs text here…" />
                            <div><SubmitButton size="sm" tone="secondary" pendingText="Reading…">Read with assistant</SubmitButton></div>
                          </form>

                          {suggestion && (
                            <div className="rounded border border-line bg-surface p-3">
                              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[12px] text-ink-faint">
                                  {suggestion.model} · {suggestion.prompt_version ?? "unknown version"} · {dateTime(suggestion.created_at)}
                                </span>
                                <Badge tone={suggestion.status === "accepted" ? "jade" : suggestion.status === "rejected" ? "ember" : "amber"}>{suggestion.status}</Badge>
                              </div>
                              <Table>
                                <thead><tr><Th>Field</Th><Th>Proposed value</Th><Th>Confidence</Th><Th>Source</Th></tr></thead>
                                <tbody>
                                  {EXTRACTION_FIELDS.map((f) => {
                                    const proposed = fields[f.key];
                                    if (!proposed) return null;
                                    const confidence = typeof proposed.confidence === "number" ? Math.round(proposed.confidence * 100) : null;
                                    return (
                                      <tr key={f.key}>
                                        <Td className="whitespace-nowrap text-[13px]">{f.label}</Td>
                                        <Td className="font-medium">{textValue(proposed.value)}</Td>
                                        <Td className="whitespace-nowrap text-[12px]">{confidence === null ? "—" : `${confidence}%`}</Td>
                                        <Td className="max-w-[260px] text-[12px] text-ink-soft">{textValue(proposed.source)}</Td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </Table>
                              {notes.length > 0 && <ul className="mt-2 list-disc pl-4 text-[12px] text-ink-faint">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
                              {suggestion.status === "proposed" && (
                                <form action={dismissExportSuggestion} className="mt-2">
                                  <input type="hidden" name="id" value={suggestion.id} />
                                  <input type="hidden" name="case_id" value={ec.id} />
                                  <SubmitButton size="sm" tone="quiet" pendingText="…">Dismiss suggestion</SubmitButton>
                                </form>
                              )}
                              <form action={confirmExportExtraction} className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
                                <input type="hidden" name="id" value={doc.id} />
                                <input type="hidden" name="case_id" value={ec.id} />
                                <input type="hidden" name="suggestion_id" value={suggestion.id} />
                                <p className="text-[12px] text-ink-soft">Confirm or correct each field. Confirming compares them with Kageflow and creates review items for differences; the records themselves do not change.</p>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  {EXTRACTION_FIELDS.map((f) => {
                                    const proposed = textValue(fields[f.key]?.value);
                                    const already = textValue(confirmed[f.key]);
                                    return (
                                      <Field key={f.key} label={f.label}>
                                        <Input name={`f_${f.key}`} defaultValue={proposed || already} maxLength={300} />
                                      </Field>
                                    );
                                  })}
                                </div>
                                <div><SubmitButton size="sm" tone="secondary">Confirm fields</SubmitButton></div>
                              </form>
                            </div>
                          )}

                          {!suggestion && Object.keys(confirmed).length > 0 && (
                            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                              {EXTRACTION_FIELDS.map((f) => {
                                const value = textValue(confirmed[f.key]);
                                return value ? <div key={f.key} className="contents"><dt className="text-ink-faint">{f.label}</dt><dd>{value}</dd></div> : null;
                              })}
                            </dl>
                          )}
                        </div>
                      </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {reviews.length > 0 && (
            <Panel title="Document conflicts" action={<Badge tone={blockingReviews.length > 0 ? "ember" : "neutral"}>{openReviews.length} open</Badge>}>
              <ul className="flex flex-col divide-y divide-line">
                {reviews.map((review) => (
                  <li key={review.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{review.field}</span>
                      <span className="flex items-center gap-2">
                        <Badge tone={review.severity === "blocking" ? "ember" : "amber"}>{review.severity}</Badge>
                        <Badge>{review.status}</Badge>
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] text-ink-soft">
                      Document says <strong>{review.found || "—"}</strong>; Kageflow has <strong>{review.expected || "—"}</strong>.
                    </p>
                    {review.document_id && <p className="text-[12px] text-ink-faint">On {docById.get(review.document_id)?.file_name ?? "an attached document"}</p>}
                    {review.status === "open" && canReview && (
                      <form action={resolveExportReviewItem} className="mt-2 flex flex-wrap items-center gap-2">
                        <input type="hidden" name="id" value={review.id} />
                        <input type="hidden" name="case_id" value={ec.id} />
                        <Input name="note" placeholder="What did you check?" className="h-8 max-w-[250px] text-[13px]" required />
                        <Button type="submit" name="action" value="resolved" size="sm" tone="secondary">Resolve</Button>
                        <Button type="submit" name="action" value="dismissed" size="sm" tone="quiet">Dismiss</Button>
                      </form>
                    )}
                    {review.status !== "open" && (
                      <p className="text-[12px] text-ink-faint">{review.status} by {nameOf(review.resolved_by)} on {dateTime(review.resolved_at)}{review.resolution_note ? ` · ${review.resolution_note}` : ""}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Approval" action={approvedCount > 0 ? <Badge tone="jade">{approvedCount} approved</Badge> : approvals.length > 0 ? <Badge tone="ember">Rejected</Badge> : <Badge>Not approved</Badge>}>
            {!canWrite ? (
              <p className="text-[13px] text-ink-soft">Approval and release records are visible to staff with sales access.</p>
            ) : (
            <>
            {ec.status === "ready_for_approval" && canApprove && (
              <form action={approveExportCase} className="mb-5 flex flex-col gap-3 border-b border-line pb-5">
                <input type="hidden" name="id" value={ec.id} />
                <p className="text-[13px] text-ink-soft">
                  Approval records your name, the time, checklist version {ruleset.version} and a snapshot of every result and its evidence. It does not release the vehicle.
                </p>
                <Field label="Approval note (optional)"><Textarea name="note" rows={2} placeholder="What did you review?" /></Field>
                <div><SubmitButton tone="primary" pendingText="Approving…">Approve release</SubmitButton></div>
              </form>
            )}
            {ec.status === "ready_for_approval" && canApprove && (
              <details className="mb-5 border-b border-line pb-5">
                <summary className="cursor-pointer text-[13px] font-medium text-shadow-700">Reject this release</summary>
                <form action={rejectExportCase} className="mt-3 flex flex-col gap-2">
                  <input type="hidden" name="id" value={ec.id} />
                  <Field label="Why is it not ready?"><Textarea name="reason" rows={2} required /></Field>
                  <div><SubmitButton size="sm" tone="danger" confirm="Record this rejection?" pendingText="Recording…">Reject release</SubmitButton></div>
                </form>
              </details>
            )}
            {ec.status === "ready_for_approval" && !canApprove && (
              <p className="mb-4 text-[13px] text-ink-soft">Every blocking check passes. Only an owner or admin can approve.</p>
            )}
            {approvals.length === 0 ? (
              <p className="text-[13px] text-ink-soft">No approval has been recorded. Approval becomes available when the case is ready.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {approvals.map((approval) => {
                  const snapshot = approval.checklist_snapshot as {
                    items?: { title?: string; result?: string; note?: string | null; evidence?: unknown; checked_at?: string }[];
                  };
                  const snapshotItems = snapshot.items ?? [];
                  return (
                    <li key={approval.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-[13px] font-medium">
                          <Badge tone={approval.decision === "approved" ? "jade" : "ember"}>{approval.decision}</Badge>
                          {nameOf(approval.approved_by)} · v{approval.checklist_version}
                        </span>
                        <span className="text-[12px] text-ink-faint">{dateTime(approval.approved_at)}</span>
                      </div>
                      {approval.note && <p className="mt-1 text-[13px] text-ink-soft">{approval.note}</p>}
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[12px] font-medium text-shadow-700">Evidence snapshot ({snapshotItems.length} checks)</summary>
                        <ul className="mt-2 flex flex-col gap-1 text-[12px]">
                          {snapshotItems.map((item, index) => (
                            <li key={index} className="border-b border-line pb-1 last:border-0">
                              <Badge tone={item.result === "pass" ? "jade" : "ember"}>{item.result}</Badge>
                              <span className="ml-1">{item.title}</span>
                              {item.note ? <span className="text-ink-faint"> · {item.note}</span> : null}
                              {item.evidence ? (
                                <details className="mt-1">
                                  <summary className="cursor-pointer text-[11px] text-shadow-700">Evidence reviewed</summary>
                                  <div className="mt-1 rounded border border-line bg-paper p-2 text-[11px]"><EvidenceValue value={item.evidence} /></div>
                                </details>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  );
                })}
              </ul>
            )}
            </>
            )}
          </Panel>

          <Panel title="Release" action={release ? <Badge tone="jade">Released</Badge> : <Badge>Not released</Badge>}>
            {!canWrite ? (
              <p className="text-[13px] text-ink-soft">Approval and release records are visible to staff with sales access.</p>
            ) : release ? (
              <div className="text-[13px]">
                <p><strong>{nameOf(release.released_by)}</strong> released this export on {dateTime(release.released_at)}.</p>
                <p className="mt-1 text-ink-soft">Method: {EXPORT_METHOD_LABEL[release.method as keyof typeof EXPORT_METHOD_LABEL] ?? release.method}{release.note ? ` · ${release.note}` : ""}</p>
                <p className="mt-2 text-ink-faint">The order tracker now shows Released for export. Approval and release are separate records.</p>
              </div>
            ) : ec.status === "approved" ? (
              canRelease ? (
                <form action={releaseExportCase} className="flex flex-col gap-3">
                  <input type="hidden" name="id" value={ec.id} />
                  <p className="text-[13px] text-ember-700">This is the controlled step. It records the release and advances the order tracker. Re-checking found no new blockers.</p>
                  <Field label="How is it released?">
                    <Select name="method" defaultValue="vehicle_handover">
                      {EXPORT_METHODS.map((m) => <option key={m} value={m}>{EXPORT_METHOD_LABEL[m]}</option>)}
                    </Select>
                  </Field>
                  <Field label="Release note"><Textarea name="note" rows={2} /></Field>
                  <div><SubmitButton tone="primary" confirm="Release this vehicle for export? This is recorded." pendingText="Releasing…">Release vehicle</SubmitButton></div>
                </form>
              ) : <p className="text-[13px] text-ink-soft">Approved. Only an owner or admin can perform the recorded release.</p>
            ) : (
              <p className="text-[13px] text-ink-soft">Release is locked until an owner or admin approves the case.</p>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Case facts">
            <Dl items={facts} />
            {editForm}
          </Panel>

          <Panel title="Source records">
            <ul className="flex flex-col gap-2 text-[13px]">
              {buyer && <li><Link href={`/crm/accounts/${buyer.id}`} className="text-shadow-700 hover:underline">Buyer: {buyer.name}</Link></li>}
              {unit && <li><Link href={`/inventory/units/${unit.id}`} className="text-shadow-700 hover:underline">Vehicle: {vehicleLabel} ({shortVIN(unit.serial_no)})</Link></li>}
              {order && <li><Link href={`/sales/doc/${order.id}`} className="text-shadow-700 hover:underline">Sales order: {order.number ?? "Draft"}</Link></li>}
            </ul>
            <p className="mt-3 text-[12px] text-ink-faint">Export-specific details live here. The buyer, stock unit and sale stay the source of truth in CRM, Inventory and Sales.</p>
            {order && (
              <p className="mt-2 text-[12px] text-ink-soft">Order total {money(order.total, order.currency)}{Number(order.amount_due) > 0 ? ` · ${money(order.amount_due, order.currency)} due` : " · settled"}</p>
            )}
          </Panel>

          <Panel title="Checklist source">
            <p className="text-[13px] font-medium">Version {ruleset.version} · {ruleset.status}</p>
            <p className="mt-1 text-[13px] text-ink-soft">{ruleset.title}</p>
            <p className="mt-2 text-[12px] text-ink-faint">Effective {date(ruleset.effective_from)} · published by {nameOf(ruleset.published_by)}</p>
            {ruleset.source_url && <a href={ruleset.source_url} target="_blank" rel="noreferrer" className="mt-2 block break-words text-[12px] text-shadow-700 hover:underline">{ruleset.source_title}</a>}
            {!ruleset.source_url && <p className="mt-2 break-words text-[12px] text-ink-faint">{ruleset.source_title}</p>}
            {ruleset.notes && <p className="mt-3 text-[12px] text-ink-faint">{ruleset.notes}</p>}
            <p className="mt-3 text-[12px] text-ink-faint">Changing the rules creates a new version; cases keep the version they were checked against.</p>
          </Panel>

          {isOpen && canApprove && (
            <Panel title="Cancel case">
              <p className="mb-3 text-[13px] text-ink-soft">Cancelling frees the vehicle for another export case. It does not delete the record.</p>
              <form action={cancelExportCase}>
                <input type="hidden" name="id" value={ec.id} />
                <SubmitButton size="sm" tone="danger" confirm="Cancel this export case?" pendingText="…">Cancel case</SubmitButton>
              </form>
            </Panel>
          )}

          {isOpen && !editable && (
            <Panel title="View only">
              <p className="text-[13px] text-ink-soft">Your role can view this case. Ask a sales colleague to update documents or an owner/admin to approve.</p>
            </Panel>
          )}

          <ButtonLink href="/exports" tone="quiet">Back to export cases</ButtonLink>
        </div>
      </div>
    </>
  );
}
