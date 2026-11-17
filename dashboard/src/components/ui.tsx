import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import type { Theme } from "../lib/theme";

export function Card({ title, right, children, className = "", hud = false }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; hud?: boolean }) {
  return (
    <section className={`glass rise rounded-2xl ${hud ? "hud" : ""} ${className}`}>
      {hud && <span className="hud-corners" aria-hidden />}
      {(title || right) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="flex min-w-0 items-center gap-2 font-display text-[13px] font-semibold tracking-wide text-ink">
            <span className="bg-hot h-3.5 w-1 shrink-0 rounded-full" aria-hidden />
            {title}
          </h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Button({ variant = "default", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost" }) {
  const styles = {
    default: "border border-line-strong bg-panel text-ink hover:border-accent hover:text-accent",
    primary: "bg-hot font-semibold text-[#1a0a02] shadow-[var(--glow)] hover:brightness-110 hover:-translate-y-px",
    ghost: "text-ink-2 hover:bg-surface hover:text-accent",
  }[variant];
  return (
    <button
      type="button"
      className={`inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-all duration-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-full border border-line bg-panel p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-7 whitespace-nowrap rounded-full px-3 text-[13px] font-medium transition-all duration-200 ${
            value === o.value ? "bg-hot text-[#1a0a02] shadow-[0_4px_16px_-4px_rgb(255_90_30/0.6)]" : "text-ink-2 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select({ label, className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className={`relative flex min-w-0 shrink-0 items-center gap-1.5 text-sm text-ink-2 ${className}`}>
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        className="min-h-9 w-full min-w-0 cursor-pointer truncate rounded-full border border-line bg-panel px-3.5 text-[13px] font-medium text-ink transition hover:border-accent focus:border-accent focus:outline-none"
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="inline-flex shrink-0 cursor-pointer select-none items-center gap-2 text-[13px] font-medium text-ink-2 transition hover:text-ink">
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && (
        <div className="hud relative grid size-20 place-items-center rounded-2xl text-3xl">
          <span className="hud-corners" aria-hidden />
          {icon}
        </div>
      )}
      <p className="font-display text-lg font-semibold text-ink">{title}</p>
      <div className="max-w-md text-sm text-ink-2">{children}</div>
    </div>
  );
}

const ICONS: Record<Theme, ReactNode> = {
  light: (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  system: (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  ),
  dark: (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  ),
};

/** Light / system / dark switch with a sliding thermal thumb. */
export function ThemeSwitch({ value, onChange }: { value: Theme; onChange: (t: Theme) => void }) {
  const order: Theme[] = ["light", "system", "dark"];
  const idx = order.indexOf(value);
  return (
    <div role="radiogroup" aria-label="Theme" className="relative inline-flex shrink-0 rounded-full border border-line bg-panel p-1">
      <span
        className="bg-hot absolute top-1 bottom-1 left-1 w-8 rounded-full shadow-[0_0_18px_-2px_rgb(255_90_30/0.7)] transition-transform duration-300 ease-[cubic-bezier(0.5,1.5,0.4,0.9)]"
        style={{ transform: `translateX(${idx * 32}px)` }}
        aria-hidden
      />
      {order.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          aria-label={`${t[0]!.toUpperCase()}${t.slice(1)} theme`}
          title={`${t[0]!.toUpperCase()}${t.slice(1)} theme`}
          onClick={() => onChange(t)}
          className={`relative z-10 grid h-7 w-8 place-items-center rounded-full transition-colors ${value === t ? "text-[#1a0a02]" : "text-ink-3 hover:text-ink"}`}
        >
          {ICONS[t]}
        </button>
      ))}
    </div>
  );
}
