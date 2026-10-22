export type VehicleProfit = {
  unit_id: string; company_id: string; stock_no: string | null; serial_no: string; make: string | null; model: string | null; variant: string | null; year: number | null;
  status: string; list_price: number | null; advert_price: number | null; list_currency: string; image_url: string | null;
  acquired_on: string; sold_at: string | null; days_in_stock: number;
  landed_cost: number; purchase_cost: number; recon_cost: number; other_costs: number;
  invoice_id: string | null; invoice_number: string | null; sold_on: string | null; salesperson_id: string | null; account_id: string | null;
  sale_net: number | null; cogs: number | null; gross_profit: number | null; addon_profit: number | null; commission: number | null; finance_income: number;
};

export const netProfit = (v: VehicleProfit) => Number(v.gross_profit ?? 0) + Number(v.addon_profit ?? 0) + Number(v.finance_income ?? 0) - Number(v.commission ?? 0);

/** Asking price excluding VAT, in rand, when it can be worked out */
export function askingNet(v: VehicleProfit, vatVendor: boolean): number | null {
  const price = v.advert_price ?? v.list_price;
  if (price === null || price === undefined || v.list_currency !== "ZAR") return null;
  return vatVendor ? Math.round((Number(price) / 1.15) * 100) / 100 : Number(price);
}

export const ageTone = (days: number) => (days > 120 ? "ember" : days > 90 ? "amber" : days > 60 ? "shadow" : "neutral") as "ember" | "amber" | "shadow" | "neutral";
