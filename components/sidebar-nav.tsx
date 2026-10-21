"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavGroup = { title: string; items: { href: string; label: string }[] };

export function SidebarNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-6">
      {groups.map((g) => (
        <div key={g.title}>
          <div className="px-3 pb-1.5 text-xs text-shadow-300">{g.title}</div>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((item) => {
              const active = path === item.href || path.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`relative block rounded-[var(--radius-control)] px-3 py-1.5 text-[14px] transition-colors ${
                      active ? "bg-shadow-700 font-medium text-white" : "text-shadow-100/85 hover:bg-shadow-800 hover:text-white"
                    }`}
                  >
                    {active && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-jade-600" />}
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
