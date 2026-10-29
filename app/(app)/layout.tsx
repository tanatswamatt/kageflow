import { Logo } from "@/components/logo";
import { CompanySwitcher } from "@/components/company-switcher";
import { SidebarNav, type NavGroup } from "@/components/sidebar-nav";
import { getContext } from "@/lib/context";
import { label } from "@/lib/format";
import { switchCompany } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  const { data: isAdmin } = await ctx.supabase.rpc("is_platform_admin");

  const groups: NavGroup[] = [
    { title: "Overview", items: [{ href: "/dashboard", label: "Dashboard" }] },
    {
      title: "CRM",
      items: [
        { href: "/crm/leads", label: "Leads" },
        { href: "/crm/deals", label: "Deals" },
        { href: "/crm/accounts", label: "Accounts" },
        { href: "/crm/contacts", label: "Contacts" },
        { href: "/crm/activities", label: "Activities" },
        { href: "/crm/duplicates", label: "Duplicates" },
      ],
    },
    {
      title: "Sales",
      items: [
        { href: "/sales/quotes", label: "Quotes" },
        { href: "/sales/orders", label: "Orders" },
        { href: "/sales/invoices", label: "Invoices" },
        { href: "/sales/credit-notes", label: "Credit notes" },
        ...(ctx.can("sales.write") ? [{ href: "/sales/finance", label: "Finance applications" }] : []),
        { href: "/sales/trade-ins", label: "Trade-ins" },
        { href: "/sales/commissions", label: "Commission" },
        { href: "/sales/payments", label: "Payments" },
        { href: "/sales/receivables", label: "Receivables" },
      ],
    },
    {
      title: "Stock",
      items: [
        { href: "/inventory/units", label: "Vehicles" },
        ...(ctx.can("inventory.write") ? [{ href: "/inventory/quick-add", label: "Add a car" }, { href: "/inventory/stock-check", label: "Stock check" }] : []),
        { href: "/inventory/products", label: "Products" },
      ],
    },
    ...(ctx.can("ledger.write") ? [{
      title: "Purchases",
      items: [
        { href: "/purchases/bills", label: "Bills and expenses" },
        { href: "/purchases/payments", label: "Supplier payments" },
        { href: "/purchases/payables", label: "Payables" },
      ],
    }] : []),
    ...(ctx.can("ledger.write") ? [{
      title: "Reports",
      items: [
        ...(ctx.can("ledger.write") ? [{ href: "/reports/profit-per-car", label: "Profit per car" }] : []),
        { href: "/reports/profit-loss", label: "Profit and loss" },
        { href: "/reports/balance-sheet", label: "Balance sheet" },
        { href: "/reports/vat", label: ctx.rules.vatReturnName },
        { href: "/accounting/trial-balance", label: "Trial balance" },
      ],
    }] : []),
    ...(ctx.can("ledger.write") ? [{
      title: "Accounting",
      items: [
        ...(ctx.can("banking.write") ? [{ href: "/banking", label: "Bank reconciliation" }] : []),
        { href: "/accounting/journals", label: "Journals" },
        { href: "/accounting/accounts", label: "Chart of accounts" },
        { href: "/accounting/periods", label: "Periods" },
      ],
    }] : []),
    {
      title: "Settings",
      items: [
        { href: "/settings/company", label: "Company" },
        { href: "/settings/members", label: "Team" },
        { href: "/settings/pipeline", label: "Pipeline stages" },
        { href: "/settings/import", label: "Import" },
        { href: "/settings/data-model", label: "Data model" },
        ...(ctx.can("company.manage") ? [{ href: "/settings/channels", label: "Listings and leads" }, { href: "/settings/integrations", label: "Integrations" }] : []),
        ...(ctx.can("audit.read") ? [{ href: "/settings/audit", label: "Audit log" }] : []),
      ],
    },
    ...(isAdmin ? [{ title: "Pretan", items: [{ href: "/admin", label: "All dealerships" }] }] : []),
  ];

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="flex flex-col gap-4 bg-shadow-900 px-3 py-4 lg:sticky lg:top-0 lg:h-dvh lg:gap-6 lg:overflow-y-auto lg:py-5">
        <div className="px-3 text-white">
          <Logo inverted />
        </div>
        <div className="flex flex-col gap-1">
          <CompanySwitcher companies={ctx.companies} activeId={ctx.companyId} action={switchCompany} />
          <div className="px-3 text-xs text-shadow-300">{label(ctx.role)}</div>
        </div>
        {ctx.can("sales.write") && (
          <a href="/sales/new?type=invoice" className="mx-1 rounded-[var(--radius-control)] bg-jade-700 px-3 py-2 text-center text-[14px] font-medium text-white hover:bg-jade-600">
            New invoice
          </a>
        )}
        <form action="/search" className="mx-1">
          <input name="q" type="search" placeholder="Search everything" aria-label="Search everything" className="h-9 w-full rounded-[var(--radius-control)] border border-shadow-700 bg-shadow-800 px-3 text-[14px] text-white placeholder:text-shadow-300 focus:border-shadow-300 focus:outline-none" />
        </form>
        <div className="hidden lg:block">
          <SidebarNav groups={groups} />
        </div>
        <details className="group lg:hidden">
          <summary className="cursor-pointer list-none rounded-[var(--radius-control)] border border-shadow-700 px-3 py-2 text-[14px] font-medium text-white">
            Menu
          </summary>
          <div className="pt-4">
            <SidebarNav groups={groups} />
          </div>
        </details>
        <div className="border-t border-shadow-800 px-3 pt-4 lg:mt-auto">
          <div className="truncate text-[13px] text-shadow-100">{ctx.user.email}</div>
          <form action="/auth/signout" method="post">
            <button className="mt-1 text-[13px] text-shadow-300 hover:text-white">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-[1200px]">{children}</div>
      </main>
    </div>
  );
}
