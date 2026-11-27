import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button, Field, Mono, TextInput, pushToast } from "../components/ui";

export function Settings() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [presets, setPresets] = useState("");
  const [max, setMax] = useState("");
  const [confirmAbove, setConfirmAbove] = useState("");
  const [ready, setReady] = useState(false);
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (settings.data && !ready) {
      setPresets(settings.data.faucetPresets.join(", "));
      setMax(settings.data.faucetMax);
      setConfirmAbove(settings.data.faucetConfirmAbove);
      setReady(true);
    }
  }, [settings.data, ready]);

  const save = useMutation({
    mutationFn: () =>
      api.saveSettings({
        faucetPresets: presets.split(",").map((item) => item.trim()).filter(Boolean),
        faucetMax: max.trim(),
        faucetConfirmAbove: confirmAbove.trim() || "0",
      }),
    onSuccess: () => {
      setError("");
      pushToast("Saved faucet settings");
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["faucet"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const add = useMutation({
    mutationFn: () => api.addAdmin(address.trim()),
    onSuccess: () => {
      setAddress("");
      setError("");
      pushToast("Added admin");
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: (value: string) => api.removeAdmin(value),
    onSuccess: () => {
      setError("");
      pushToast("Removed admin");
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <section className="panel flex flex-col gap-4 p-5">
        <h2 className="text-[16px] leading-6 font-semibold">Admin allowlist</h2>
        <p className="text-[13px] leading-[18px] text-ink-soft">
          A valid signature from any other address is refused. The first three lab accounts are seeded. This list is stored in the lab data volume, not in an environment file.
        </p>
        <ul className="flex flex-col gap-2">
          {(settings.data?.admins ?? []).map((item) => (
            <li key={item} className="flex items-center justify-between gap-3">
              <Mono>{item}</Mono>
              <Button variant="danger" type="button" onClick={() => remove.mutate(item)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <Field label="Add address" hint="Checksummed or all lowercase.">
          <TextInput className="font-mono" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" />
        </Field>
        <Button type="button" onClick={() => add.mutate()} disabled={add.isPending}>
          Add admin
        </Button>
      </section>
      <section className="panel flex flex-col gap-4 p-5">
        <h2 className="text-[16px] leading-6 font-semibold">Faucet</h2>
        <Field label="Presets" hint="Whole-token amounts, separated by commas.">
          <TextInput className="font-mono nums" value={presets} onChange={(e) => setPresets(e.target.value)} />
        </Field>
        <Field label="Maximum per request">
          <TextInput className="font-mono nums" value={max} onChange={(e) => setMax(e.target.value)} />
        </Field>
        <Field label="Confirm above" hint="The public faucet asks again when the amount is larger than this.">
          <TextInput className="font-mono nums" value={confirmAbove} onChange={(e) => setConfirmAbove(e.target.value)} />
        </Field>
        <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
          Save faucet settings
        </Button>
      </section>
      {error ? <p className="text-[13px] text-bad">{error}</p> : null}
    </div>
  );
}
