"use client";

import { useState } from "react";
import { Field, Input, Select } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export function StockSourceForm({ action }: { action: (fd: FormData) => Promise<void> }) {
  const [kind, setKind] = useState("supabase_vehicles");
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <Field label="Type of website">
        <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="supabase_vehicles">Supabase site with a vehicles table (like Kalali)</option>
          <option value="json_feed">Any site with a JSON stock feed</option>
        </Select>
      </Field>
      <Field label="Name"><Input name="name" defaultValue="Website" /></Field>
      <Field label={kind === "supabase_vehicles" ? "Site's Supabase URL" : "Feed URL"} hint={kind === "supabase_vehicles" ? "From the site's environment: NEXT_PUBLIC_SUPABASE_URL" : "Returns a JSON list of items"} className="sm:col-span-2">
        <Input name="base_url" type="url" required placeholder={kind === "supabase_vehicles" ? "https://abcd1234.supabase.co" : "https://example.com/stock.json"} />
      </Field>
      <Field label={kind === "supabase_vehicles" ? "Site's public (anon) key" : "Bearer token (optional)"} hint={kind === "supabase_vehicles" ? "NEXT_PUBLIC_SUPABASE_ANON_KEY. It's the key the public website already uses." : undefined} className="sm:col-span-2">
        <Input name="api_key" required={kind === "supabase_vehicles"} autoComplete="off" />
      </Field>
      {kind === "supabase_vehicles" && (
        <>
          <Field label="Table"><Input name="table_name" defaultValue="vehicles" /></Field>
          <Field label="Photo bucket"><Input name="image_bucket" defaultValue="vehicle-images" /></Field>
        </>
      )}
      <div className="sm:col-span-2"><SubmitButton size="sm">Connect website</SubmitButton></div>
    </form>
  );
}
