import { Dialog } from "@base-ui/react/dialog";
import { Check, Copy } from "lucide-react";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-brass text-on-brass hover:bg-brass-hover active:bg-brass-pressed",
    secondary: "border border-line-strong bg-transparent text-ink hover:bg-muted",
    danger: "border border-bad text-bad bg-transparent hover:bg-muted",
  }[variant];
  return (
    <button
      className={`inline-flex h-8 items-center justify-center rounded-[6px] px-3 text-[14px] leading-5 font-medium disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px] leading-[18px] text-ink-soft">
      {label}
      {children}
      {hint ? <span className="text-[12px] leading-4 text-ink-faint">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-9 rounded-[6px] border border-line bg-muted px-3 text-[14px] text-ink placeholder:text-ink-faint ${props.className ?? ""}`}
    />
  );
}

export function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={done ? "Copied" : "Copy"}
      className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-soft hover:bg-muted hover:text-ink"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        window.setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <Check size={16} strokeWidth={1.5} /> : <Copy size={16} strokeWidth={1.5} />}
    </button>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[13px] leading-4 nums ${className}`}>{children}</span>;
}

export function StatusPill({ tone, label }: { tone: "ok" | "warn" | "bad" | "info"; label: string }) {
  const color = { ok: "text-ok", warn: "text-warn", bad: "text-bad", info: "text-info" }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] leading-4 ${color}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-[var(--overlay)]" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 w-[min(440px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[12px] border border-line bg-elevated p-5 text-ink">
          <Dialog.Title className="text-[16px] leading-6 font-semibold">{title}</Dialog.Title>
          <div className="mt-4">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

let toastListener: ((text: string) => void) | null = null;
export function pushToast(text: string) {
  toastListener?.(text);
}

export function Toaster() {
  const [text, setText] = useState<string | null>(null);
  toastListener = (next) => {
    setText(next);
    window.setTimeout(() => setText((current) => (current === next ? null : current)), 2800);
  };
  if (!text) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-[8px] border border-line bg-elevated px-3 py-2 text-[14px] text-ink">
      {text}
    </div>
  );
}
