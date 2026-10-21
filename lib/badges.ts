import type { BadgeTone } from "@/components/ui";
import type { AccountKind, DealStatus, DocStatus, LeadStatus, UnitStatus } from "./types";

export const leadTone: Record<LeadStatus, BadgeTone> = {
  new: "shadow",
  contacted: "amber",
  qualified: "jade",
  disqualified: "neutral",
  converted: "jade",
};

export const dealTone: Record<DealStatus, BadgeTone> = { open: "shadow", won: "jade", lost: "ember" };

export const kindTone: Record<AccountKind, BadgeTone> = {
  prospect: "shadow",
  customer: "jade",
  supplier: "amber",
  partner: "neutral",
};

export const docTone: Record<DocStatus, BadgeTone> = {
  draft: "amber",
  sent: "shadow",
  accepted: "jade",
  declined: "neutral",
  open: "shadow",
  fulfilled: "jade",
  cancelled: "neutral",
  issued: "jade",
};

export const unitTone: Record<UnitStatus, BadgeTone> = {
  on_order: "neutral",
  in_transit: "amber",
  in_stock: "jade",
  reserved: "shadow",
  sold: "neutral",
  written_off: "ember",
};
