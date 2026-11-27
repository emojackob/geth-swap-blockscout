import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, Field, Modal, Mono, TextInput, pushToast } from "../components/ui";
import { api } from "../lib/api";
import { age, explorer, formatAmount, short } from "../lib/format";

const schema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Enter a 0x address with 40 hex characters."),
  asset: z.enum(["bnb", "lab"]),
  amount: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

export function Faucet() {
  const queryClient = useQueryClient();
  const info = useQuery({ queryKey: ["faucet"], queryFn: api.faucet, refetchInterval: 5000 });
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { address: "", asset: "bnb", amount: "1000" },
  });
  const [confirming, setConfirming] = useState<FormValues | null>(null);
  const send = useMutation({
    mutationFn: (values: FormValues) => api.sendFaucet(values.address, values.asset, values.amount),
    onSuccess: (result) => {
      const symbol = result.asset === "lab" ? "LAB" : "BNB";
      pushToast(`Sent ${formatAmount(result.amount)} ${symbol}`);
      setConfirming(null);
      void queryClient.invalidateQueries({ queryKey: ["faucet"] });
    },
  });

  useEffect(() => {
    const prefill = sessionStorage.getItem("faucet-prefill");
    if (prefill) {
      form.setValue("address", prefill);
      sessionStorage.removeItem("faucet-prefill");
    }
  }, [form]);

  const amount = form.watch("amount");
  const asset = form.watch("asset");
  const symbol = asset === "lab" ? "LAB" : "BNB";
  const large = Number(amount) > 10000;

  function submit(values: FormValues) {
    if (Number(values.amount) > 10000) setConfirming(values);
    else send.mutate(values);
  }

  const nativeLow = info.data?.nativeBalance != null && Number(info.data.nativeBalance) < 10000;
  const labLow = info.data?.labBalance != null && Number(info.data.labBalance) < 100000;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <form className="panel flex flex-col gap-4 p-5" onSubmit={form.handleSubmit(submit)}>
        <Field label="Recipient" hint={form.formState.errors.address?.message}>
          <TextInput className="font-mono" placeholder="0x…" {...form.register("address")} />
        </Field>
        <Field label="Asset">
          <select className="h-9 rounded-[6px] border border-line bg-muted px-3" {...form.register("asset")}>
            <option value="bnb">BNB</option>
            <option value="lab">LAB</option>
          </select>
        </Field>
        <Field label="Amount">
          <TextInput className="font-mono nums" {...form.register("amount")} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {(info.data?.presets ?? ["100", "1000", "10000"]).map((preset) => (
            <button key={preset} type="button" className="h-7 rounded-[6px] border border-line px-2 text-[13px]" onClick={() => form.setValue("amount", preset)}>
              {formatAmount(preset)}
            </button>
          ))}
        </div>
        <Button type="submit" disabled={send.isPending}>
          {send.isPending ? "Sending" : `Send ${formatAmount(amount) || "tokens"} ${symbol}`}
        </Button>
        {send.error ? <p className="text-[13px] text-bad">{send.error.message}</p> : null}
        {send.data ? (
          <p className="text-[13px]">
            Mined.{" "}
            <a className="text-info" href={config.data ? explorer(config.data.blockscoutUrl, "tx", send.data.txHash) : "#"}>
              <Mono>{short(send.data.txHash, 10, 6)}</Mono>
            </a>
          </p>
        ) : null}
      </form>
      <section className="grid gap-3 sm:grid-cols-2">
        <Balance label="Faucet BNB" value={formatAmount(info.data?.nativeBalance)} warn={Boolean(nativeLow)} />
        <Balance label="Faucet LAB" value={formatAmount(info.data?.labBalance)} warn={Boolean(labLow)} />
      </section>
      <section>
        <h2 className="mb-3 text-[16px] leading-6 font-semibold">Recent sends</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-[13px] text-ink-soft">
              <tr className="border-b border-line">
                <th className="py-2 font-normal">Age</th>
                <th className="py-2 font-normal">Detail</th>
                <th className="py-2 font-normal">Hash</th>
              </tr>
            </thead>
            <tbody>
              {(info.data?.recent ?? []).length === 0 ? (
                <tr><td className="py-4 text-ink-faint" colSpan={3}>No sends yet.</td></tr>
              ) : info.data!.recent.map((row) => (
                <tr key={`${row.hash}${row.at}`} className="h-9 border-b border-line hover:bg-muted">
                  <td>{age(row.at)}</td>
                  <td>{row.detail}</td>
                  <td><Mono>{short(row.hash)}</Mono></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Modal open={Boolean(confirming)} onOpenChange={(open) => !open && setConfirming(null)} title="Send a large amount">
        {confirming ? (
          <div className="flex flex-col gap-3 text-[14px]">
            <p>This is still an open lab faucet. Confirm the destination before sending.</p>
            <p><Mono>{formatAmount(confirming.amount)} {confirming.asset === "lab" ? "LAB" : "BNB"}</Mono> to <Mono>{confirming.address}</Mono></p>
            <p className="text-ink-soft">Faucet BNB remaining: {formatAmount(info.data?.nativeBalance)}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setConfirming(null)}>Cancel</Button>
              <Button type="button" disabled={send.isPending} onClick={() => send.mutate(confirming)}>
                Send {formatAmount(confirming.amount)} {confirming.asset === "lab" ? "LAB" : "BNB"}
              </Button>
            </div>
            {large ? null : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Balance({ label, value, warn }: { label: string; value: string; warn: boolean }) {
  return (
    <div className="panel p-4">
      <p className="text-[13px] text-ink-soft">{label}</p>
      <p className="font-mono text-[16px] nums">{value}</p>
      {warn ? <p className="text-[12px] text-warn">This well is getting low.</p> : null}
    </div>
  );
}
