import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../lib/api";
import { age, explorer, formatAmount, gwei, short } from "../lib/format";
import { CopyButton, Mono, StatusPill } from "../components/ui";
import { pushToast } from "../components/ui";

export function Overview() {
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  const overview = useQuery({ queryKey: ["overview"], queryFn: api.overview, refetchInterval: 4000 });
  const activity = useQuery({ queryKey: ["activity"], queryFn: api.activity, refetchInterval: 8000 });
  const data = overview.data;
  const verdict = !data ? "Checking node" : !data.reachable ? "Unreachable" : data.syncing ? "Syncing" : "Geth ready";
  const tone = !data?.reachable ? "bad" : data.syncing ? "warn" : "ok";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <StatusPill tone={tone} label={verdict} />
          <p className="enter mt-3 font-mono text-[40px] leading-none font-medium nums text-ink">
            {data?.blockNumber ?? "—"}
          </p>
          <p className="mt-2 text-[13px] leading-[18px] text-ink-soft">Latest block</p>
        </div>
        {!data?.reachable ? (
          <p className="max-w-md text-[14px] leading-5 text-ink-soft">
            The API cannot reach Geth. Check the `bsc` service with `docker compose logs bsc`, then confirm port 8545 is published.
          </p>
        ) : null}
      </div>
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <Stat label="Peers" value={String(data?.peerCount ?? "—")} note="One peer is not expected on this single node." />
        <Stat label="Gas price" value={gwei(data?.gasPrice)} />
        <Stat label="Faucet balance" value={`${formatAmount(data?.faucetNative)} BNB`} />
        <Stat label="Pools" value={String(data?.poolCount ?? 0)} />
        <Stat label="Blockscout" value={data?.blockscout === "up" ? "Up" : data?.blockscout === "starting" ? "Starting" : "Down"} />
        <Stat label="Client" value={data?.clientVersion ?? "—"} />
      </dl>
      <div className="grid items-start gap-6 min-[1100px]:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
        <section>
          <h2 className="mb-3 text-[16px] leading-6 font-semibold">Recent activity</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="text-[13px] text-ink-soft">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-normal">Age</th>
                  <th className="py-2 pr-3 font-normal">Type</th>
                  <th className="py-2 pr-3 font-normal">Hash</th>
                  <th className="py-2 font-normal">Result</th>
                </tr>
              </thead>
              <tbody>
                {(activity.data ?? []).length === 0 ? (
                  <tr><td className="py-4 text-ink-faint" colSpan={4}>No faucet sends or deploys recorded yet.</td></tr>
                ) : activity.data!.map((row) => (
                  <tr key={`${row.hash}-${row.at}`} className="h-9 border-b border-line hover:bg-muted">
                    <td className="pr-3 text-ink-soft">{age(row.at)}</td>
                    <td className="pr-3">{row.kind}</td>
                    <td className="pr-3">
                      <span className="inline-flex items-center gap-1">
                        <Mono>{short(row.hash, 8, 6)}</Mono>
                        <CopyButton value={row.hash} />
                        {config.data ? <a className="text-info" href={explorer(config.data.blockscoutUrl, "tx", row.hash)}>Blockscout</a> : null}
                      </span>
                    </td>
                    <td>{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel p-4">
          <h2 className="text-[16px] leading-6 font-semibold">Quick actions</h2>
          <div className="mt-3 flex flex-col items-start gap-2">
            <Link to="/faucet" className="text-info">Fund an address</Link>
            {config.data ? <a className="text-info" href={config.data.blockscoutUrl}>Open Blockscout</a> : null}
            <button
              className="text-info"
              onClick={() => {
                if (!config.data) return;
                void navigator.clipboard.writeText(config.data.rpcUrl);
                pushToast("Copied RPC URL");
              }}
            >
              Copy RPC URL
            </button>
            <button className="text-info" onClick={() => document.querySelector<HTMLButtonElement>("[data-add-chain]")?.click()}>
              Add chain to wallet
            </button>
            <AddChainButton />
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="text-[13px] leading-[18px] text-ink-soft">{label}</dt>
      <dd className="font-mono text-[16px] leading-5 nums">{value}</dd>
      {note ? <p className="text-[12px] leading-4 text-ink-faint">{note}</p> : null}
    </div>
  );
}

function AddChainButton() {
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  return (
    <button
      data-add-chain
      className="sr-only"
      onClick={() => {
        if (!config.data) return;
        const ethereum = (window as Window & { ethereum?: { request: (args: unknown) => Promise<unknown> } }).ethereum;
        void ethereum?.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: `0x${config.data.chainId.toString(16)}`,
            chainName: config.data.chainName,
            nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
            rpcUrls: [config.data.rpcUrl],
            blockExplorerUrls: [config.data.blockscoutUrl],
          }],
        });
      }}
    >
      Add chain
    </button>
  );
}
