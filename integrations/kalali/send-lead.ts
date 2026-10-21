// Server-side helper for the Kalali site: send a website enquiry to Kageflow as a lead.
// Call it from a server action or API route, never from browser code (the key is secret).
//
// Env on the Kalali site:
//   KAGEFLOW_URL     = https://<your-kageflow-domain>
//   KAGEFLOW_API_KEY = kf_live_... (Kageflow → Settings → Integrations → Create key)

export type Enquiry = {
  id: string; // your form submission id; resending it never creates a duplicate
  firstName?: string;
  lastName?: string;
  company?: string;
  email?: string;
  phone?: string;
  vehicle?: string; // what they asked about
  estimatedValue?: number;
  message?: string;
  page?: string; // where the form was submitted
  consent: boolean; // they ticked "I agree to be contacted"
};

export async function sendLeadToKageflow(e: Enquiry): Promise<{ id: string; status: "created" | "existing" }> {
  const res = await fetch(`${process.env.KAGEFLOW_URL}/api/v1/leads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.KAGEFLOW_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      external_ref: e.id,
      first_name: e.firstName,
      last_name: e.lastName,
      company_name: e.company,
      email: e.email,
      phone: e.phone,
      interest: e.vehicle,
      estimated_value: e.estimatedValue,
      currency: "ZAR",
      source: "web_form",
      source_detail: e.page ?? "Kalali website",
      message: e.message,
      consent: e.consent,
      consent_text: "Website enquiry form consent checkbox",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Kageflow rejected the lead (${res.status}): ${await res.text()}`);
  return res.json();
}
