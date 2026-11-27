import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../lib/api";
import { explorer, formatAmount, short } from "../lib/format";
import { CopyButton, Mono } from "../components/ui";

export function Contracts() {
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  const status = useQuery({ queryKey: ["overview"], queryFn: api.overview, refetchInterval: 4000 });
  const contracts = useQuery({ queryKey: ["contracts"], queryFn: api.contracts });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  const logs = useQuery({ queryKey: ["logs", "geth", ""], queryFn: () => api.logs("geth", "") });
  const deployed = contracts.data?.deployments;
  const rows = deployed
    ? Object.entries(deployed.contracts).map(([name, item]) => ({ name, ...item, kind: name.startsWith("Pancake") ? "PancakeSwap V2" : "Token" }))
    : [];

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-[16px] leading-6 font-semibold">Node</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <Item label="Client" value={status.data?.clientVersion ?? "—"} />
          <Item label="Chain id" value={String(config.data?.chainId ?? "—")} copy={config.data ? String(config.data.chainId) : undefined} />
          <Item label="Network" value={config.data?.chainName ?? "BSC Lab"} />
          <Item label="Block" value={status.data?.blockNumber ?? "—"} />
          <Item label="Sync" value={status.data?.reachable ? (status.data.syncing ? "Syncing" : "Ready") : "Unreachable"} />
          <Item label="HTTP RPC" value={config.data?.rpcUrl ?? "—"} copy={config.data?.rpcUrl} />
          <Item label="WebSocket" value={config.data?.wsUrl ?? "—"} copy={config.data?.wsUrl} />
          <Item label="Mode" value="Single validator, archive, dev key unlocked for sealing" />
        </dl>
      </section>
      <section>
        <h2 className="mb-3 text-[16px] leading-6 font-semibold">Contracts</h2>
        {rows.length === 0 ? (
          <p className="text-ink-soft">Nothing deployed yet. `deploy/deploy.mjs` runs once the node is sealing.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-[13px] text-ink-soft">
                <tr className="border-b border-line">
                  <th className="py-2 font-normal">Name</th>
                  <th className="py-2 font-normal">Address</th>
                  <th className="py-2 font-normal">Kind</th>
                  <th className="py-2 font-normal">Deploy tx</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name} className="h-9 border-b border-line hover:bg-muted">
                    <td>{row.name}</td>
                    <td>
                      <span className="inline-flex items-center gap-1">
                        <Mono>{row.address}</Mono>
                        <CopyButton value={row.address} />
                        {config.data ? <a className="text-info" href={explorer(config.data.blockscoutUrl, "address", row.address)}>Blockscout</a> : null}
                      </span>
                    </td>
                    <td>{row.kind}</td>
                    <td>
                      <span className="inline-flex items-center gap-1">
                        <Mono>{short(row.tx)}</Mono>
                        {config.data ? <a className="text-info" href={explorer(config.data.blockscoutUrl, "tx", row.tx)}>Blockscout</a> : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {deployed ? <p className="mt-2 text-[12px] text-ink-faint">Init code hash <Mono>{deployed.initCodeHash}</Mono></p> : null}
      </section>
      <section>
        <h2 className="mb-3 text-[16px] leading-6 font-semibold">Funded dev accounts</h2>
        <p className="mb-3 text-[13px] text-ink-soft">These keys are public test keys. Do not fund them on any public network.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-[13px] text-ink-soft">
              <tr className="border-b border-line">
                <th className="py-2 font-normal">Name</th>
                <th className="py-2 font-normal">Address</th>
                <th className="py-2 text-right font-normal">BNB</th>
                <th className="py-2 text-right font-normal">LAB</th>
                <th className="py-2 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {(accounts.data ?? []).map((account) => (
                <tr key={account.address} className="h-9 border-b border-line hover:bg-muted">
                  <td>{account.name}</td>
                  <td>
                    <span className="inline-flex items-center gap-1">
                      <Mono>{short(account.address, 8, 6)}</Mono>
                      <CopyButton value={account.address} />
                      <CopyButton value={account.privateKey} />
                    </span>
                  </td>
                  <td className="text-right font-mono nums">{formatAmount(account.nativeBalance)}</td>
                  <td className="text-right font-mono nums">{formatAmount(account.labBalance)}</td>
                  <td>
                    <Link
                      to="/faucet"
                      className="text-info"
                      onClick={() => sessionStorage.setItem("faucet-prefill", account.address)}
                    >
                      Fund from faucet
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[16px] leading-6 font-semibold">Health log</h2>
          <Link to="/logs" className="text-info">Full logs</Link>
        </div>
        <pre className="max-h-48 overflow-auto rounded-[6px] bg-muted p-3 font-mono text-[12.5px] leading-4 text-ink">
          {(logs.data?.lines || "No geth log yet.").split("\n").slice(-12).join("\n")}
        </pre>
      </section>
    </div>
  );
}

function Item({ label, value, copy }: { label: string; value: string; copy?: string }) {
  return (
    <div>
      <dt className="text-[13px] text-ink-soft">{label}</dt>
      <dd className="flex items-center gap-1 break-all font-mono text-[13px] nums">
        {value}
        {copy ? <CopyButton value={copy} /> : null}
      </dd>
    </div>
  );
}
