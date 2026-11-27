import { createPublicClient, createWalletClient, http, parseEther, parseGwei } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

const chainId = 56056;
// Anvil/Hardhat account 0. Test only. Same key the faucet uses.
const pk = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const dataRoot = existsSync("/data") ? "/data" : "data";
const outPath = `${dataRoot}/deployments.json`;
const activityPath = `${dataRoot}/activity.jsonl`;
const artifactPath = new URL("./artifacts/pancake-v2.json", import.meta.url);

async function pickRpc() {
  for (const url of ["http://127.0.0.1:8545", "http://host.docker.internal:8545"]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
      });
      if (res.ok) return url;
    } catch {
      // try the next candidate
    }
  }
  return "http://127.0.0.1:8545";
}

const rpcUrl = await pickRpc();

const artifacts = JSON.parse(readFileSync(artifactPath, "utf8"));
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
const chain = defineChain({
  id: chainId,
  name: "BSC Lab",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });

function abiOf(name) {
  return artifacts.contracts[name].abi;
}
function bytecodeOf(name) {
  return artifacts.contracts[name].bytecode;
}

async function waitForChain() {
  for (let i = 0; i < 120; i++) {
    try {
      const id = await publicClient.getChainId();
      const block = await publicClient.getBlockNumber();
      if (id === chainId && block >= 12n) {
        console.log(`chain ${id} at block ${block}`);
        return;
      }
      console.log(`waiting for chain ${chainId} and block >= 12 (have ${id} / ${block})`);
    } catch (err) {
      console.log(`rpc not ready: ${err.shortMessage ?? err.message ?? err}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("timed out waiting for the local chain");
}

async function feeFields() {
  const block = await publicClient.getBlock();
  if (block.baseFeePerGas != null) {
    return {
      maxFeePerGas: parseGwei("5"),
      maxPriorityFeePerGas: parseGwei("1"),
    };
  }
  return { gasPrice: parseGwei("1") };
}

async function deploy(name, args = []) {
  const hash = await wallet.deployContract({
    abi: abiOf(name),
    bytecode: bytecodeOf(name),
    args,
    ...(await feeFields()),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`${name} deployment failed: ${hash}`);
  }
  console.log(`${name} ${receipt.contractAddress} ${hash}`);
  return { address: receipt.contractAddress, tx: hash };
}

async function write(address, abi, functionName, args, value) {
  const hash = await wallet.writeContract({
    address,
    abi,
    functionName,
    args,
    value,
    ...(await feeFields()),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`${functionName} failed: ${hash}`);
  }
  return hash;
}

function record(kind, hash, detail) {
  try {
    mkdirSync(dirname(activityPath), { recursive: true });
    appendFileSync(
      activityPath,
      JSON.stringify({
        at: new Date().toISOString(),
        kind,
        hash,
        detail,
        status: "success",
      }) + "\n",
    );
  } catch (err) {
    console.warn("activity log skipped", err.message);
  }
}

async function alreadyDeployed() {
  if (!existsSync(outPath)) return null;
  try {
    const prev = JSON.parse(readFileSync(outPath, "utf8"));
    if (prev.chainId !== chainId || !prev.contracts?.PancakeRouter?.address) return null;
    const code = await publicClient.getBytecode({ address: prev.contracts.PancakeRouter.address });
    if (code && code !== "0x") {
      console.log("router already deployed, leaving", outPath);
      return prev;
    }
  } catch (err) {
    console.warn("existing deployment file ignored", err.message);
  }
  return null;
}

await waitForChain();
const existing = await alreadyDeployed();
if (existing) process.exit(0);

const wbnb = await deploy("WBNB");
const lab = await deploy("LabToken");
const factory = await deploy("PancakeFactory", [account.address]);
const router = await deploy("PancakeRouter", [factory.address, wbnb.address]);

const labAmount = parseEther("1000000");
const wbnbAmount = parseEther("1000");
const mintTx = await write(lab.address, abiOf("LabToken"), "mint", [account.address, labAmount]);
const depositTx = await write(wbnb.address, abiOf("WBNB"), "deposit", [], wbnbAmount);
const max = (1n << 256n) - 1n;
await write(lab.address, abiOf("LabToken"), "approve", [router.address, max]);
await write(wbnb.address, abiOf("WBNB"), "approve", [router.address, max]);
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const liquidityTx = await write(router.address, abiOf("PancakeRouter"), "addLiquidity", [
  lab.address,
  wbnb.address,
  labAmount,
  wbnbAmount,
  0n,
  0n,
  account.address,
  deadline,
]);

const pair = await publicClient.readContract({
  address: factory.address,
  abi: abiOf("PancakeFactory"),
  functionName: "getPair",
  args: [lab.address, wbnb.address],
});
const token0 = await publicClient.readContract({
  address: pair,
  abi: artifacts.contracts.PancakePair.abi,
  functionName: "token0",
});
const token1 = await publicClient.readContract({
  address: pair,
  abi: artifacts.contracts.PancakePair.abi,
  functionName: "token1",
});

const doc = {
  chainId,
  deployedAt: new Date().toISOString(),
  deployer: account.address,
  initCodeHash: artifacts.initCodeHash,
  feeBps: artifacts.feeBps,
  contracts: {
    WBNB: wbnb,
    LabToken: lab,
    PancakeFactory: factory,
    PancakeRouter: router,
  },
  pools: [
    {
      address: pair,
      token0,
      token1,
      symbol0: token0.toLowerCase() === lab.address.toLowerCase() ? "LAB" : "WBNB",
      symbol1: token1.toLowerCase() === lab.address.toLowerCase() ? "LAB" : "WBNB",
      tx: liquidityTx,
    },
  ],
  notes: {
    seed: "1,000,000 LAB and 1,000 WBNB added as the default LAB/WBNB pool",
    txs: { mintTx, depositTx, liquidityTx },
  },
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(doc, null, 2));
record("deploy", router.tx, "PancakeRouter");
record("pool", liquidityTx, "LAB/WBNB");
console.log("wrote", outPath);
