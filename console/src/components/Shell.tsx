import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Blocks,
  Droplets,
  FileText,
  LayoutDashboard,
  Menu,
  Moon,
  Repeat2,
  Search,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { api } from "../lib/api";
import { formatAmount, gwei, short } from "../lib/format";
import { CopyButton, Mono } from "./ui";

const NAV = [
  { to: "/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/faucet", label: "Faucet", icon: Droplets },
  { to: "/swap", label: "Swap & Pools", icon: Repeat2 },
  { to: "/contracts", label: "Node & Contracts", icon: Blocks },
  { to: "/logs", label: "Logs", icon: FileText },
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const status = useQuery({
    queryKey: ["status", me.data ? "admin" : "public"],
    queryFn: () => (me.data ? api.overview() : api.status()),
    refetchInterval: 4000,
  });
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [palette, setPalette] = useState(false);
  const title = NAV.find((item) => path.startsWith(item.to))?.label ?? "BSC Lab";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const live = status.data?.reachable && !status.data.syncing;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <aside
        className={`fixed inset-y-0 left-0 z-20 hidden border-r border-line bg-surface min-[1024px]:flex min-[1024px]:flex-col ${collapsed ? "w-14" : "w-[232px]"}`}
      >
        <SidebarBody collapsed={collapsed} path={path} signedIn={Boolean(me.data)} address={me.data?.address} />
      </aside>
      {open ? (
        <div className="fixed inset-0 z-30 min-[1024px]:hidden">
          <button className="absolute inset-0 bg-[var(--overlay)]" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[232px] border-r border-line bg-surface">
            <SidebarBody collapsed={false} path={path} signedIn={Boolean(me.data)} address={me.data?.address} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}
      <div className={`${collapsed ? "min-[1024px]:pl-14" : "min-[1024px]:pl-[232px]"}`}>
        <header className="flex h-[52px] items-center gap-3 border-b border-line px-4 min-[1024px]:px-6">
          <button className="min-[1024px]:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
            <Menu size={16} strokeWidth={1.5} />
          </button>
          <button className="hidden text-ink-soft min-[1024px]:inline" aria-label="Collapse sidebar" onClick={() => setCollapsed((v) => !v)}>
            <Menu size={16} strokeWidth={1.5} />
          </button>
          <h1 className="text-[16px] leading-6 font-semibold tracking-[-0.02em]">{title}</h1>
          <div className="ml-auto flex items-center gap-3 text-[12px] leading-4 text-ink-soft">
            <span className="hidden items-center gap-2 sm:flex">
              <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-brass" : "bg-bad"}`} />
              <Mono>{live ? "RPC live" : "RPC down"}</Mono>
              <Mono>block {status.data?.blockNumber ?? "—"}</Mono>
              <Mono>id {status.data?.chainId ?? "—"}</Mono>
              <Mono>{gwei(status.data?.gasPrice)}</Mono>
              <Mono>faucet {formatAmount(status.data?.faucetNative)} BNB</Mono>
            </span>
            <button className="rounded-[6px] border border-line px-2 py-1" onClick={() => setPalette(true)}>
              ⌘K
            </button>
            <ThemeButton />
            <WalletMenu />
          </div>
        </header>
        <main className="px-4 py-6 min-[1024px]:px-6">{children}</main>
      </div>
      {palette ? <CommandPalette onClose={() => setPalette(false)} /> : null}
    </div>
  );
}

function SidebarBody({
  collapsed,
  path,
  signedIn,
  address,
  onNavigate,
}: {
  collapsed: boolean;
  path: string;
  signedIn: boolean;
  address?: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[52px] items-center gap-2 px-3">
        <span className="h-2 w-2 rounded-full bg-brass" />
        {collapsed ? null : <span className="text-[16px] leading-6 font-semibold">BSC Lab</span>}
      </div>
      <nav className="flex flex-col gap-1 px-2">
        {NAV.map((item) => {
          const active = path.startsWith(item.to);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={`flex h-8 items-center gap-2 rounded-[6px] px-2 text-[14px] ${active ? "border-l-2 border-brass bg-brass-subtle text-ink" : "text-ink-soft"}`}
            >
              <Icon size={16} strokeWidth={1.5} />
              {collapsed ? null : item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-line px-3 py-3 text-[12px] leading-4 text-ink-faint">
        {signedIn && address ? <Mono>{short(address)}</Mono> : "Not signed in."}
      </div>
    </div>
  );
}

function ThemeButton() {
  const [theme, setTheme] = useState(() => document.documentElement.classList.contains("light") ? "light" : "dark");
  return (
    <button
      aria-label="Toggle theme"
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        document.documentElement.classList.remove("dark", "light");
        document.documentElement.classList.add(next);
        localStorage.setItem("lab-theme", next);
        setTheme(next);
      }}
    >
      {theme === "dark" ? <Sun size={16} strokeWidth={1.5} /> : <Moon size={16} strokeWidth={1.5} />}
    </button>
  );
}

function WalletMenu() {
  const account = useAccount();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  if (!account.address) return <span className="text-ink-faint">No wallet</span>;
  return (
    <div className="relative">
      <button className="flex items-center gap-2" onClick={() => setOpen((v) => !v)}>
        <span className="h-6 w-6 rounded-full border border-line bg-muted" />
        <Mono>{short(account.address)}</Mono>
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-56 rounded-[12px] border border-line bg-elevated p-2 text-[14px]">
          <div className="flex items-center justify-between px-2 py-1">
            <Mono>{short(account.address, 8, 6)}</Mono>
            <CopyButton value={account.address} />
          </div>
          {config.data ? (
            <a className="block rounded-[6px] px-2 py-1 text-info hover:bg-muted" href={`${config.data.blockscoutUrl}/address/${account.address}`} target="_blank" rel="noreferrer">
              Open in Blockscout
            </a>
          ) : null}
          <button
            className="block w-full rounded-[6px] px-2 py-1 text-left hover:bg-muted"
            onClick={async () => {
              await api.logout();
              disconnect();
              window.location.assign("/");
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  const items = useMemo(() => NAV.map((item) => ({ label: item.label, href: item.to })), []);
  const filtered = items.filter((item) => item.label.toLowerCase().includes(q.toLowerCase()));
  const pasted = q.trim();
  const isAddr = /^0x[a-fA-F0-9]{40}$/.test(pasted);
  const isTx = /^0x[a-fA-F0-9]{64}$/.test(pasted);
  const base = config.data?.blockscoutUrl ?? "";
  return (
    <div className="fixed inset-0 z-40 bg-[var(--overlay)]" onClick={onClose}>
      <div className="mx-auto mt-24 w-[min(520px,calc(100%-32px))] rounded-[12px] border border-line bg-elevated p-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <Search size={16} strokeWidth={1.5} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to a page, or paste an address or tx" className="h-8 w-full bg-transparent text-[14px] outline-none" />
          <button aria-label="Close" onClick={onClose}><X size={16} strokeWidth={1.5} /></button>
        </div>
        <div className="mt-2 flex flex-col">
          {filtered.map((item) => (
            <Link key={item.href} to={item.href} onClick={onClose} className="rounded-[6px] px-2 py-2 hover:bg-muted">
              {item.label}
            </Link>
          ))}
          {isAddr || isTx ? (
            <a className="rounded-[6px] px-2 py-2 text-info hover:bg-muted" href={`${base}/${isTx ? "tx" : "address"}/${pasted}`} target="_blank" rel="noreferrer">
              Open in Blockscout
            </a>
          ) : null}
          {isAddr ? (
            <Link
              to="/faucet"
              onClick={() => {
                sessionStorage.setItem("faucet-prefill", pasted);
                onClose();
              }}
              className="rounded-[6px] px-2 py-2 hover:bg-muted"
            >
              Prefill faucet with this address
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
