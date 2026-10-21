import type { Role } from "./types";

const RULES = {
  "crm.write": ["owner", "admin", "sales"],
  "crm.delete": ["owner", "admin"],
  "crm.stages": ["owner", "admin"],
  "ledger.write": ["owner", "admin", "accountant"],
  "audit.read": ["owner", "admin", "accountant"],
  "company.manage": ["owner", "admin"],
  "sales.write": ["owner", "admin", "accountant", "sales"],
  "payments.write": ["owner", "admin", "accountant"],
  "inventory.write": ["owner", "admin", "accountant", "sales"],
  "inventory.costs": ["owner", "admin", "accountant"],
  "purchases.write": ["owner", "admin", "accountant"],
  "banking.write": ["owner", "admin", "accountant"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof RULES;

export function can(role: Role, permission: Permission): boolean {
  return (RULES[permission] as readonly Role[]).includes(role);
}
