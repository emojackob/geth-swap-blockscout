import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { pushToast } from "../components/ui";

const SERVICES = ["geth", "deploy", "api", "faucet", "blockscout"] as const;

export function Logs() {
  const [service, setService] = useState<(typeof SERVICES)[number]>("geth");
  const [q, setQ] = useState("");
  const [paused, setPaused] = useState(false);
  const logs = useQuery({
    queryKey: ["logs", service, q],
    queryFn: () => api.logs(service, q),
    refetchInterval: paused ? false : 2000,
  });

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {SERVICES.map((name) => (
          <button
            key={name}
            className={`h-7 rounded-[6px] px-2 text-[13px] ${service === name ? "bg-brass-subtle text-ink" : "text-ink-soft"}`}
            onClick={() => setService(name)}
          >
            {name}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search"
          className="h-8 rounded-[6px] border border-line bg-muted px-2 font-mono text-[13px]"
        />
        <button className="h-8 rounded-[6px] border border-line px-2 text-[13px]" onClick={() => setPaused((v) => !v)}>
          {paused ? "Tail" : "Pause"}
        </button>
        <button
          className="h-8 rounded-[6px] border border-line px-2 text-[13px]"
          onClick={() => {
            void navigator.clipboard.writeText(logs.data?.lines ?? "");
            pushToast("Copied log slice");
          }}
        >
          Copy slice
        </button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto rounded-[6px] bg-muted p-3 font-mono text-[12.5px] leading-4 text-ink">
        {logs.data?.present ? logs.data.lines || "Log file is empty." : `No ${service} log file yet. docker compose logs ${service}`}
      </pre>
    </div>
  );
}
