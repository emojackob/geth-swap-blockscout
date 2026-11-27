export type PublicConfig = {
  chainId: number;
  chainName: string;
  nativeSymbol: string;
  rpcUrl: string;
  wsUrl: string;
  blockscoutUrl: string;
  faucetPath: string;
  siweDomain: string;
  siweStatement: string;
};

export type Identity = { address: string; chainId: number; role: "admin" };

export type Status = {
  reachable: boolean;
  chainId?: number;
  blockNumber?: string;
  gasPrice?: string;
  clientVersion?: string;
  peerCount?: number;
  syncing?: boolean;
  faucetNative?: string | null;
  faucetLab?: string | null;
  blockscout?: string;
  poolCount?: number;
  deployed?: boolean;
  error?: string;
};

export type Activity = {
  at: string;
  kind: string;
  hash: string;
  detail: string;
  status: string;
};

export type Pool = {
  address: string;
  token0: string;
  token1: string;
  symbol0: string;
  symbol1: string;
  reserve0: string;
  reserve1: string;
  feeBps: number;
  tx: string;
};

export type PoolsResponse = {
  deployed: boolean;
  feeBps?: number;
  factory?: string;
  router?: string;
  wbnb?: string;
  lab?: string;
  pools: Pool[];
};

export type FaucetInfo = {
  nativeSymbol: string;
  labSymbol: string;
  labAddress: string | null;
  faucetAddress: string;
  nativeBalance: string | null;
  labBalance: string | null;
  presets: string[];
  maxPerRequest: string;
  confirmAbove: string;
  recent: Activity[];
};

export type LabSettings = {
  admins: string[];
  faucetPresets: string[];
  faucetMax: string;
  faucetConfirmAbove: string;
};

export type DevAccount = {
  name: string;
  address: string;
  privateKey: string;
  role: string;
  nativeBalance: string | null;
  labBalance: string | null;
};

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || res.statusText;
  } catch {
    return res.statusText;
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

export async function apiSend<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) throw new Error(await readError(res));
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  config: () => apiGet<PublicConfig>("/api/config"),
  status: () => apiGet<Status>("/api/status"),
  overview: () => apiGet<Status>("/api/admin/overview"),
  me: async (): Promise<Identity | null> => {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(await readError(res));
    return (await res.json()) as Identity;
  },
  siweMessage: (address: string, chainId: number) =>
    apiSend<{ message: string }>("/api/auth/siwe-message", { address, chainId }),
  verify: (message: string, signature: string) =>
    apiSend<Identity>("/api/auth/verify", { message, signature }),
  logout: () => apiSend<void>("/api/auth/logout"),
  faucet: () => apiGet<FaucetInfo>("/api/faucet"),
  sendFaucet: (address: string, asset: string, amount: string) =>
    apiSend<{ txHash: string; asset: string; amount: string; address: string }>("/api/faucet", {
      address,
      asset,
      amount,
    }),
  activity: () => apiGet<Activity[]>("/api/admin/activity"),
  pools: () => apiGet<PoolsResponse>("/api/admin/pools"),
  quote: (amount: string, tokenIn: string, tokenOut: string) =>
    apiGet<{ amountIn: string; amountOut: string; feeBps: number }>(
      `/api/admin/quote?amount=${encodeURIComponent(amount)}&tokenIn=${tokenIn}&tokenOut=${tokenOut}`,
    ),
  contracts: () => apiGet<{ deployments: Deployments | null }>("/api/admin/contracts"),
  accounts: () => apiGet<DevAccount[]>("/api/admin/accounts"),
  settings: () => apiGet<LabSettings>("/api/admin/settings"),
  saveSettings: (body: Pick<LabSettings, "faucetPresets" | "faucetMax" | "faucetConfirmAbove">) =>
    apiSend<LabSettings>("/api/admin/settings", body, "PUT"),
  addAdmin: (address: string) => apiSend<LabSettings>("/api/admin/admins", { address }),
  removeAdmin: (address: string) => apiSend<LabSettings>("/api/admin/admins", { address }, "DELETE"),
  logs: (service: string, q: string) =>
    apiGet<{ service: string; present: boolean; lines: string }>(
      `/api/admin/logs?service=${encodeURIComponent(service)}&q=${encodeURIComponent(q)}&lines=300`,
    ),
};

export type Deployments = {
  chainId: number;
  initCodeHash: string;
  feeBps: number;
  deployer: string;
  contracts: Record<string, { address: string; tx: string }>;
  pools: { address: string; symbol0: string; symbol1: string; tx: string }[];
};
