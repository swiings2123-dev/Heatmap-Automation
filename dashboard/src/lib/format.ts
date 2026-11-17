export const fmtInt = (n: number) => new Intl.NumberFormat().format(Math.round(n));
export const fmtPct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;
export const fmtDec = (n: number, digits = 2) => n.toFixed(digits);
export const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
