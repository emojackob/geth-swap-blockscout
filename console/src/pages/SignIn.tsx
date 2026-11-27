import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useSignMessage, useSwitchChain } from "wagmi";
import { api } from "../lib/api";
import { labChain } from "../lib/wallet";
import { Button, CopyButton, Mono } from "../components/ui";

export function SignIn() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  const status = useQuery({ queryKey: ["status"], queryFn: api.status, refetchInterval: 4000 });
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const account = useAccount();
  const connect = useConnect();
  const switchChain = useSwitchChain();
  const sign = useSignMessage();
  const [phase, setPhase] = useState<"idle" | "preview" | "signing" | "error">("idle");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (me.data) navigate({ to: "/overview" });
  }, [me.data, navigate]);

  const chainReady = Boolean(config.data && account.chainId === config.data.chainId);
  const injected = typeof window !== "undefined" && Boolean((window as Window & { ethereum?: unknown }).ethereum);

  async function onConnect() {
    setError("");
    const connector = connect.connectors[0];
    if (!connector) {
      setError("No injected wallet was found. Install a browser wallet, then reload this page.");
      return;
    }
    await connect.connectAsync({ connector });
  }

  async function onSwitch() {
    if (!config.data) return;
    const chain = labChain(config.data);
    await switchChain.switchChainAsync({ chainId: chain.id }).catch(async (err: { code?: number }) => {
      if (err.code === 4902 || String(err).includes("4902")) {
        const provider = (window as Window & { ethereum?: { request: (args: unknown) => Promise<unknown> } }).ethereum;
        await provider?.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: `0x${chain.id.toString(16)}`,
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: [config.data!.rpcUrl],
            blockExplorerUrls: [config.data!.blockscoutUrl],
          }],
        });
      } else {
        throw err;
      }
    });
  }

  async function prepare() {
    if (!config.data || !account.address) return;
    setError("");
    const { message } = await api.siweMessage(account.address, config.data.chainId);
    setPreview(message);
    setPhase("preview");
  }

  async function confirmSign() {
    if (!preview) return;
    setPhase("signing");
    setError("");
    try {
      const signature = await sign.signMessageAsync({ message: preview });
      await api.verify(preview, signature);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate({ to: "/overview" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign-in failed.";
      setError(message.toLowerCase().includes("reject") || message.toLowerCase().includes("denied")
        ? "Signature declined. You can try again."
        : message);
      setPhase("preview");
    }
  }

  const nodeLine = !status.data
    ? "Checking the node"
    : status.data.reachable
      ? `Node ready · block ${status.data.blockNumber}`
      : `Local chain ${config.data?.chainId ?? ""} · waiting for node`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <section className="enter w-full max-w-[420px] rounded-[8px] border border-line bg-surface p-6">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-brass" />
          <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.02em]">BSC Lab</h1>
        </div>
        <p className="enter enter-late mt-3 font-mono text-[16px] leading-5 font-medium nums text-ink">{nodeLine}</p>
        <p className="mt-4 text-[14px] leading-5 text-ink-soft">
          Sign in with the wallet that holds an allowlisted lab address. The signature is a login, not a transaction, and costs no gas.
        </p>
        {!injected ? (
          <p className="mt-4 text-[13px] leading-[18px] text-ink-soft">
            No injected wallet detected. Install MetaMask or another browser wallet, then reload. The local chain id and RPC are below.
          </p>
        ) : null}
        {config.data ? (
          <dl className="mt-4 grid gap-2 text-[13px] leading-[18px]">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-ink-faint">Chain id</dt>
              <dd className="flex items-center gap-1"><Mono>{config.data.chainId}</Mono><CopyButton value={String(config.data.chainId)} /></dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-ink-faint">RPC</dt>
              <dd className="flex items-center gap-1"><Mono>{config.data.rpcUrl}</Mono><CopyButton value={config.data.rpcUrl} /></dd>
            </div>
          </dl>
        ) : null}
        <div className="mt-6 flex flex-col gap-3">
          {!account.address ? (
            <Button onClick={() => void onConnect()}>Connect wallet</Button>
          ) : !chainReady ? (
            <Button onClick={() => void onSwitch().catch((err: Error) => setError(err.message || "Could not switch network."))}>
              Switch to local chain (id {config.data?.chainId})
            </Button>
          ) : phase === "preview" || phase === "signing" ? (
            <>
              <pre className="max-h-48 overflow-auto rounded-[6px] bg-muted p-3 font-mono text-[12.5px] leading-4 whitespace-pre-wrap text-ink">{preview}</pre>
              <p className="text-[12px] leading-4 text-ink-faint">
                Domain {config.data?.siweDomain}. Chain {config.data?.chainId}. This signs a login message. It does not send a transaction.
              </p>
              <Button disabled={phase === "signing"} onClick={() => void confirmSign()}>
                {phase === "signing" ? "Waiting for wallet" : "Sign in"}
              </Button>
            </>
          ) : (
            <Button onClick={() => void prepare().catch((err: Error) => setError(err.message))}>Sign in</Button>
          )}
          {error ? <p className="text-[13px] leading-[18px] text-bad">{error}</p> : null}
          <a className="text-[13px] text-info" href="/faucet">Need test funds first? Open the faucet (no sign-in).</a>
        </div>
      </section>
    </div>
  );
}
