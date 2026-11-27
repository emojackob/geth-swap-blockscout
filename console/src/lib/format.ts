export function short(value: string, lead = 6, tail = 4): string {
  if (!value) return "";
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

export function age(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatAmount(value: string | null | undefined): string {
  if (!value) return "—";
  const [whole, frac = ""] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac.slice(0, 4)}` : grouped;
}

export function gwei(wei?: string): string {
  if (!wei) return "—";
  const n = Number(wei) / 1e9;
  if (!Number.isFinite(n)) return wei;
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} gwei`;
}

export function explorer(base: string, kind: "tx" | "address", id: string): string {
  return `${base.replace(/\/$/, "")}/${kind}/${id}`;
}
