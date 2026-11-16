import type {
  ExportCaseStatus,
  ExportCheckResult,
  ExportDocumentKind,
  ExportDocumentStatus,
  ExportIncoterm,
} from "./types";

export type ExportBadgeTone = "neutral" | "shadow" | "jade" | "ember" | "amber";

export const EXPORT_STATUSES: ExportCaseStatus[] = [
  "draft", "in_review", "blocked", "ready_for_approval", "approved", "released", "cancelled",
];

export const EXPORT_STATUS_LABEL: Record<ExportCaseStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  blocked: "Blocked",
  ready_for_approval: "Ready for approval",
  approved: "Approved",
  released: "Released",
  cancelled: "Cancelled",
};

export const EXPORT_STATUS_TONE: Record<ExportCaseStatus, ExportBadgeTone> = {
  draft: "neutral",
  in_review: "amber",
  blocked: "ember",
  ready_for_approval: "shadow",
  approved: "jade",
  released: "jade",
  cancelled: "neutral",
};

export const EXPORT_STATUS_HELP: Record<ExportCaseStatus, string> = {
  draft: "Not checked yet. Run the checklist when the case details and documents are in.",
  in_review: "A requirement needs a person to confirm or review it before this can be approved.",
  blocked: "At least one blocking requirement is missing or failed. Fix the item and run the checklist again.",
  ready_for_approval: "Every blocking check passes. An owner or admin can now review the evidence and approve release.",
  approved: "Approval is recorded. A separate, recorded release action is still required.",
  released: "Released. The approval, checklist version and release are in the audit trail.",
  cancelled: "Cancelled. It no longer counts as an open case for the vehicle.",
};

export const CHECK_RESULT_LABEL: Record<ExportCheckResult, string> = {
  pass: "Pass",
  missing: "Missing",
  failed: "Failed",
  needs_review: "Needs review",
};

export const CHECK_RESULT_TONE: Record<ExportCheckResult, ExportBadgeTone> = {
  pass: "jade",
  missing: "ember",
  failed: "ember",
  needs_review: "amber",
};

export const EXPORT_DOC_KINDS: ExportDocumentKind[] = [
  "commercial_invoice", "road_freight_waybill", "bill_of_lading", "export_permit",
  "customs_declaration", "certificate_of_origin", "proof_of_title", "proof_of_export",
  "payment_proof", "other",
];

export const EXPORT_DOC_LABEL: Record<ExportDocumentKind, string> = {
  commercial_invoice: "Commercial invoice",
  bill_of_lading: "Bill of lading",
  road_freight_waybill: "Road freight waybill",
  export_permit: "Export permit",
  customs_declaration: "Customs declaration",
  certificate_of_origin: "Certificate of origin",
  proof_of_title: "Proof of title",
  proof_of_export: "Proof of export",
  payment_proof: "Proof of payment",
  other: "Other document",
};

export const EXPORT_DOC_STATUS_LABEL: Record<ExportDocumentStatus, string> = {
  uploaded: "Uploaded",
  in_review: "In review",
  accepted: "Accepted",
  rejected: "Rejected",
};

export const EXPORT_DOC_STATUS_TONE: Record<ExportDocumentStatus, ExportBadgeTone> = {
  uploaded: "neutral",
  in_review: "amber",
  accepted: "jade",
  rejected: "ember",
};

export const INCOTERMS: ExportIncoterm[] = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];

export const EXPORT_METHODS = ["vehicle_handover", "carrier_collection", "customs_clearance", "other"] as const;
export type ExportMethod = (typeof EXPORT_METHODS)[number];

export const EXPORT_METHOD_LABEL: Record<ExportMethod, string> = {
  vehicle_handover: "Handed to the buyer",
  carrier_collection: "Collected by the carrier",
  customs_clearance: "Cleared at customs",
  other: "Other",
};

/** Fields a person can confirm after extraction. Values are proposals until confirmed. */
export const EXTRACTION_FIELDS = [
  { key: "vin", label: "VIN" },
  { key: "buyer_name", label: "Buyer name" },
  { key: "invoice_number", label: "Invoice number" },
  { key: "currency", label: "Currency" },
  { key: "issue_date", label: "Invoice date" },
  { key: "departure_date", label: "Departure date" },
  { key: "total", label: "Total" },
] as const;

export type ExtractionFieldKey = (typeof EXTRACTION_FIELDS)[number]["key"];

export function exportCorridor(origin: string, destination: string): string {
  return `${origin} → ${destination}`;
}

export function shortVIN(vin: string | null | undefined): string {
  if (!vin) return "No VIN";
  return vin.length > 8 ? `${vin.slice(0, 4)}…${vin.slice(-4)}` : vin;
}

export function isOpenStatus(status: ExportCaseStatus): boolean {
  return !["approved", "released", "cancelled"].includes(status);
}
