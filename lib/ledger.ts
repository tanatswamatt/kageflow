import type { AccountType } from "./types";

/** Natural sign: assets and expenses carry debit balances, the rest credit balances */
export function naturalBalance(type: AccountType, debitMinusCredit: number): number {
  return type === "asset" || type === "expense" ? debitMinusCredit : -debitMinusCredit;
}

export const TYPE_ORDER: AccountType[] = ["asset", "liability", "equity", "income", "expense"];
export const TYPE_LABEL: Record<AccountType, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  income: "Income",
  expense: "Expenses",
};
