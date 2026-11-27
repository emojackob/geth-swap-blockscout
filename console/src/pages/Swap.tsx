import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { formatUnits, parseEther } from "viem";
import { api, type Pool } from "../lib/api";
import { explorer, formatAmount, short } from "../lib/format";
import { erc20Abi, routerAbi } from "../lib/wallet";
import { Button, CopyButton, Field, Mono, TextInput, pushToast } from "../components/ui";

export function Swap() {
  const pools = useQuery({ queryKey: ["pools"], queryFn: api.pools });
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  const [open, setOpen] = useState<Pool | null>(null);
  const data = pools.data;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap gap-3">
        <Chip label="Factory" value={data?.factory} href={config.data && data?.factory ? explorer(config.data.blockscoutUrl, "address", data.factory) : undefined} />
        <Chip label="Router" value={data?.router} href={config.data && data?.router ? explorer(config.data.blockscoutUrl, "address", data.router) : undefined} />
        <Chip label="WBNB" value={data?.wbnb} href={config.data && data?.wbnb ? explorer(config.data.blockscoutUrl, "address", data.wbnb) : undefined} />
      </section>
      {!data?.deployed ? (
        <p className="text-[14px] text-ink-soft">No pools yet. The deploy service runs `deploy/deploy.mjs` on first boot and seeds LAB/WBNB. Check `docker compose logs deploy` if this stays empty.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-canvas text-[13px] text-ink-soft">
              <tr className="border-b border-line">
                <th className="py-2 font-normal">Pair</th>
                <th className="py-2 text-right font-normal">Reserve 0</th>
                <th className="py-2 text-right font-normal">Reserve 1</th>
                <th className="py-2 text-right font-normal">Spot</th>
                <th className="py-2 font-normal">Fee</th>
                <th className="py-2 font-normal">Contract</th>
              </tr>
            </thead>
            <tbody>
              {data.pools.map((pool) => {
                const r0 = Number(formatUnits(BigInt(pool.reserve0), 18));
                const r1 = Number(formatUnits(BigInt(pool.reserve1), 18));
                const spot = r0 > 0 ? (r1 / r0).toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—";
                return (
                  <tr key={pool.address} className="h-9 cursor-pointer border-b border-line hover:bg-muted" onClick={() => setOpen(pool)}>
                    <td>{pool.symbol0}/{pool.symbol1}</td>
                    <td className="text-right font-mono nums">{formatAmount(String(r0))}</td>
                    <td className="text-right font-mono nums">{formatAmount(String(r1))}</td>
                    <td className="text-right font-mono nums">{spot}</td>
                    <td>{(pool.feeBps / 100).toFixed(2)}%</td>
                    <td><Mono>{short(pool.address)}</Mono></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {open && data?.router && data.wbnb && data.lab ? (
        <TestSwap pool={open} router={data.router} wbnb={data.wbnb} lab={data.lab} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}

function Chip({ label, value, href }: { label: string; value?: string; href?: string }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-2 rounded-[6px] border border-line bg-surface px-2 py-1">
      <span className="text-[13px] text-ink-soft">{label}</span>
      <Mono>{short(value, 8, 4)}</Mono>
      <CopyButton value={value} />
      {href ? <a className="text-[13px] text-info" href={href}>Blockscout</a> : null}
    </span>
  );
}

function TestSwap({
  pool,
  router,
  wbnb,
  lab,
  onClose,
}: {
  pool: Pool;
  router: string;
  wbnb: string;
  lab: string;
  onClose: () => void;
}) {
  const account = useAccount();
  const client = usePublicClient();
  const write = useWriteContract();
  const [from, setFrom] = useState<"BNB" | "LAB">("BNB");
  const [amount, setAmount] = useState("1");
  const [slippage, setSlippage] = useState("50");
  const [expected, setExpected] = useState("");
  const [hash, setHash] = useState("");
  const [error, setError] = useState("");
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });

  async function quote() {
    setError("");
    const tokenIn = from === "BNB" ? wbnb : lab;
    const tokenOut = from === "BNB" ? lab : wbnb;
    const result = await api.quote(amount, tokenIn, tokenOut);
    setExpected(formatUnits(BigInt(result.amountOut), 18));
  }

  async function send() {
    if (!account.address || !client) {
      setError("Connect the wallet on the local chain before sending a test swap.");
      return;
    }
    setError("");
    const tokenOut = from === "BNB" ? lab : wbnb;
    const quoted = await api.quote(amount, from === "BNB" ? wbnb : lab, tokenOut);
    const out = BigInt(quoted.amountOut);
    const bps = BigInt(slippage || "0");
    const minOut = out - (out * bps) / 10000n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const value = parseEther(amount);
    try {
      let tx: `0x${string}`;
      if (from === "BNB") {
        tx = await write.writeContractAsync({
          address: router as `0x${string}`,
          abi: routerAbi,
          functionName: "swapExactETHForTokens",
          args: [minOut, [wbnb as `0x${string}`, lab as `0x${string}`], account.address, deadline],
          value,
        });
      } else {
        const allowance = await client.readContract({
          address: lab as `0x${string}`,
          abi: erc20Abi,
          functionName: "allowance",
          args: [account.address, router as `0x${string}`],
        });
        if (allowance < value) {
          const approveHash = await write.writeContractAsync({
            address: lab as `0x${string}`,
            abi: erc20Abi,
            functionName: "approve",
            args: [router as `0x${string}`, value],
          });
          await client.waitForTransactionReceipt({ hash: approveHash });
        }
        tx = await write.writeContractAsync({
          address: router as `0x${string}`,
          abi: routerAbi,
          functionName: "swapExactTokensForETH",
          args: [value, minOut, [lab as `0x${string}`, wbnb as `0x${string}`], account.address, deadline],
        });
      }
      setHash(tx);
      pushToast("Sent test swap");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The swap was not sent.");
    }
  }

  return (
    <section className="panel p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] leading-6 font-semibold">Test swap {pool.symbol0}/{pool.symbol1}</h2>
        <button className="text-[13px] text-ink-soft" onClick={onClose}>Close</button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="From">
          <select className="h-9 rounded-[6px] border border-line bg-muted px-3" value={from} onChange={(e) => setFrom(e.target.value as "BNB" | "LAB")}>
            <option value="BNB">BNB</option>
            <option value="LAB">LAB</option>
          </select>
        </Field>
        <Field label="Amount">
          <TextInput className="font-mono nums" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Slippage, basis points" hint="50 is 0.50%">
          <TextInput className="font-mono nums" value={slippage} onChange={(e) => setSlippage(e.target.value)} />
        </Field>
        <Field label="Expected out">
          <TextInput className="font-mono nums" readOnly value={expected} />
        </Field>
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" type="button" onClick={() => void quote().catch((err: Error) => setError(err.message))}>Quote</Button>
        <Button type="button" onClick={() => void send()}>Send test swap</Button>
      </div>
      {error ? <p className="mt-3 text-[13px] text-bad">{error}</p> : null}
      {hash && config.data ? (
        <p className="mt-3 text-[13px]">
          <a className="text-info" href={explorer(config.data.blockscoutUrl, "tx", hash)}><Mono>{hash}</Mono></a>
        </p>
      ) : null}
    </section>
  );
}
