# Export readiness

Kageflow's export readiness feature adds an export case on top of the existing CRM, inventory and
sales records. The buyer, vehicle and sales order stay the source of truth; the case holds only the
export-specific facts and the evidence trail.

## What is in the build

| Layer | What it does |
| --- | --- |
| `export_cases` | One case per exported vehicle, linked to `crm_accounts`, `inventory_units` and a confirmed `sales_docs` order. Holds destination, route, Incoterm, planned dates, proof-of-export owner/due date, status and approval/release timestamps. |
| `export_rulesets` / `export_ruleset_items` | A versioned corridor checklist with a source, effective date, publisher and six deterministic rule handlers. |
| `export_case_checks` | The result of each rule for this case: `pass`, `missing`, `failed` or `needs_review`, plus the evidence, note, who checked it and when. |
| `export_documents` | Private attachments with type, storage path, uploader/time, review status and reviewer/time. |
| `export_review_items` | Deterministic mismatches between a document's confirmed fields and Kageflow's records. Blocking conflicts stop document acceptance and approval. |
| `export_approvals` | The approver, timestamp, checklist version and a full snapshot of the checks and evidence at approval time. |
| `export_releases` | The separate controlled release action, linked to the approval. |
| `export_ai_suggestions` | Every proposal a model (or the local fallback) made, what it read, the model name and the human decision. Model output never writes a business record. |

## One corridor

The seed creates one outbound corridor per company: South Africa → Zimbabwe for a ZA company, or
Zimbabwe → South Africa for a ZW company. Both are road corridors through Beitbridge. The ruleset
starts published, version 1, with an effective date and a source note. The seeded source is a
starting point for a compliance owner to review, not legal advice.

New cases can only use a published, effective ruleset. Publishing a new version retires the previous
one, but cases keep the version they were opened against so their checks and approvals stay
traceable. Owners and admins can manage versions at `/exports/checklist`: create a draft from the
published version, update its source metadata and rule wording, choose whether each check blocks,
configure required document groups, and publish it. Rule calculations remain deterministic and
fixed in code; changing finance, payment, VIN or other rule logic still requires a reviewed code
change.

### The six checks

1. **Buyer and destination details are complete** — buyer name, billing address, country, route,
   Incoterm and both planned dates.
2. **Vehicle identity is confirmed and matches the sale** — the vehicle is on the order line, was
   not sold on another document, has a 17-character VIN and `vin_confirmed` is true.
3. **Finance and title checks are clear** — no submitted/approved/contracted bank finance remains,
   the vehicle is not written off, and an accepted proof of title is on file. A registration
   document already on the vehicle is treated as something to review, not automatic title.
4. **Required permits and customs documents are present** — each corridor group has an accepted
   document: commercial invoice; road waybill or bill of lading; export permit; customs declaration;
   certificate of origin.
5. **Required payment conditions are met** — the order is confirmed and every issued invoice for it
   has no amount due. The first corridor encodes payment in full before release.
6. **Proof-of-export evidence has a due date and owner** — a team member owns it and the due date
   has not passed without accepted evidence.

## Status and enforcement

The checklist computes the case status:

- any blocking `missing` or `failed` → `blocked`
- only blocking `needs_review` → `in_review`
- everything blocking passes → `ready_for_approval`

Approval is a separate RPC restricted to owners/admins. It re-runs the checklist, rejects open
conflicts and outstanding finance/proof-of-title, stores a snapshot, then moves the case to
`approved`. An owner/admin can also record a rejection with a reason; that decision is stored with
the same snapshot and returns the case to `in_review`. Release is a second owner/admin RPC that
re-runs the checklist at release time, requires the recorded approval, re-checks
finance/write-off/title, records the release and advances the order tracker to
`Released for export`.

Database triggers, not only UI checks, enforce that:

- a client cannot set `ready_for_approval`, `approved` or `released` directly;
- approved cases are locked (parties, vehicle, dates, checklist) and can only move to released;
- evidence cannot be added, changed or deleted after approval;
- a review item cannot be rewritten after it records what a document said;
- acceptance and resolution are limited to owner/admin/accountant roles, and approval/release to
  owner/admin.

## AI assistance

`lib/exports-ai.ts` is a server-only service. If `EXPORT_AI_BASE_URL`, `EXPORT_AI_API_KEY` and
`EXPORT_AI_MODEL` are set, it calls an OpenAI-compatible chat completions endpoint with the pasted
document text and asks for labelled fields with a confidence and an exact source snippet. With no
endpoint configured it uses a local labelled-field parser, clearly named
`kageflow-rules-fallback`.

Every proposal is written to `export_ai_suggestions` with the model, prompt version, input summary,
output and later the human decision. A person confirms or corrects the fields through
`confirm_export_extraction`; that function writes `confirmed_fields`, compares them with the buyer,
vehicle, order and invoice, and creates review items. It never updates the underlying records.
Model values are only shown when the value can be found in the pasted text. The source excerpt is
generated locally from that text; the model's claimed quote is not trusted.

Any rejected required document keeps the checklist blocked even if another document in the same
group was accepted. An owner/admin must remove the rejected attachment or upload a corrected
version and remove the rejected copy before approval.

Current limits: extraction reads pasted text, not OCR from an image or PDF. The file itself is stored
and can be reviewed by a person. When a model endpoint is configured, only the pasted document text,
its file name and document type are sent; Kageflow does not send the buyer, vehicle or sales records.
If no endpoint is configured, the text stays in Kageflow and the local parser is used. Message
drafting and shipment-delay prediction are deliberately not in this slice; they need reliable
outcome data and a separate approval path.

## Roles

| Permission | Owner | Admin | Accountant | Sales | Viewer |
| --- | --- | --- | --- | --- | --- |
| See cases and status | yes | yes | yes | yes | yes |
| Create/edit cases, upload documents, run checklist | yes | yes | yes | yes | no |
| Accept/reject documents, resolve conflicts | yes | yes | yes | no | no |
| Approve release, release vehicle | yes | yes | no | no | no |
| See evidence, checks, approvals | yes | yes | yes | yes | no |

## Applying and testing

1. Apply `supabase/migrations/20261116000100_export_readiness.sql` and
   `supabase/migrations/20261116000200_export_readiness_followups.sql` before deploying the routes.
   The first migration seeds a published corridor checklist for existing companies and for every
   company created afterwards. The follow-up adds the checklist editor and rejected-document guard.
2. Run `supabase/tests/export_readiness.sql` in the SQL editor. It rolls back and reports pass/fail
   in the final error, following the existing test scripts. The original migration and test were
   run against an ephemeral PGlite Postgres before the follow-up changes; rerun them after applying
   the follow-up migration.
3. Run `npm run typecheck` and `npm run build`.

The routes are `/exports`, `/exports/new`, `/exports/checklist` and `/exports/[id]`; a confirmed
order also links to `/exports/new?order=<id>` from its sales document page.
