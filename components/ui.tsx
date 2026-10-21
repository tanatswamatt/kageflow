import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Tone = "primary" | "secondary" | "quiet" | "danger";

const buttonTones: Record<Tone, string> = {
  primary: "bg-jade-700 text-white hover:bg-jade-600 border-transparent",
  secondary: "bg-surface text-ink border-line-strong hover:bg-paper",
  quiet: "bg-transparent text-ink-soft border-transparent hover:bg-shadow-100 hover:text-ink",
  danger: "bg-surface text-ember-700 border-line-strong hover:bg-ember-50",
};

export const buttonClass = (tone: Tone = "secondary", size: "sm" | "md" = "md") =>
  cx(
    "inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] border font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
    size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-4 text-sm",
    buttonTones[tone],
  );

export function Button({ tone = "secondary", size = "md", className, ...props }: ComponentProps<"button"> & { tone?: Tone; size?: "sm" | "md" }) {
  return <button className={cx(buttonClass(tone, size), className)} {...props} />;
}

export function ButtonLink({ tone = "secondary", size = "md", className, ...props }: ComponentProps<typeof Link> & { tone?: Tone; size?: "sm" | "md" }) {
  return <Link className={cx(buttonClass(tone, size), className)} {...props} />;
}

const control =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:border-shadow-700 focus:outline-none focus:ring-2 focus:ring-shadow-100";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(control, "h-9", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(control, "h-9 pr-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(control, "min-h-20 py-2", className)} {...props} />;
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-1.5", className)}>
      <span className="text-[13px] font-medium text-ink-soft">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

export function Panel({ title, action, children, className, flush }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cx("rounded-[var(--radius-panel)] border border-line bg-surface", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          {action}
        </header>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-[13px] text-ink-faint hover:text-ink">
            ‹ {back.label}
          </Link>
        )}
        <h1 className="text-[22px] font-semibold leading-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const badgeTones = {
  neutral: "bg-paper text-ink-soft border-line",
  shadow: "bg-shadow-100 text-shadow-700 border-transparent",
  jade: "bg-jade-50 text-jade-700 border-transparent",
  ember: "bg-ember-50 text-ember-700 border-transparent",
  amber: "bg-amber-50 text-amber-700 border-transparent",
} as const;

export type BadgeTone = keyof typeof badgeTones;

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", badgeTones[tone])}>
      {children}
    </span>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx("border-b border-line px-4 py-2.5 text-left text-xs font-medium text-ink-faint", className)}>{children}</th>;
}

export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cx("border-b border-line px-4 py-2.5 align-top", className)}>
      {children}
    </td>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-ink-soft">{children}</div>}
    </div>
  );
}

export function Notice({ params }: { params: { error?: string; ok?: string } }) {
  if (params.error) {
    return (
      <div role="alert" className="mb-5 rounded-[var(--radius-control)] border border-ember-700/25 bg-ember-50 px-4 py-2.5 text-ember-700">
        {params.error}
      </div>
    );
  }
  if (params.ok) {
    return (
      <div role="status" className="mb-5 rounded-[var(--radius-control)] border border-jade-700/25 bg-jade-50 px-4 py-2.5 text-jade-700">
        {params.ok}
      </div>
    );
  }
  return null;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-surface px-5 py-4">
      <div className="text-[13px] text-ink-faint">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[13px] text-ink-soft">{sub}</div>}
    </div>
  );
}

export function Dl({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-faint">{k}</dt>
          <dd className="min-w-0 break-words">{v || <span className="text-ink-faint">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
