import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { Toaster } from "./components/ui";
import { api } from "./lib/api";
import { wagmiConfig } from "./lib/wallet";
import { queryClient, router } from "./router";
import "./styles.css";

function App() {
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  const wagmi = useMemo(() => (config.data ? wagmiConfig(config.data) : null), [config.data]);
  if (!wagmi) {
    return <div className="p-6 text-ink-soft">Loading lab configuration.</div>;
  }
  return (
    <WagmiProvider config={wagmi}>
      <RouterProvider router={router} />
      <Toaster />
    </WagmiProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
