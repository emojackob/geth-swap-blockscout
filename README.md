# BSC Lab

一条命令在本机拉起一条 **BNB Smart Chain 兼容的单节点测试链**，并带上 PancakeSwap V2、Blockscout、免登录水龙头，以及用钱包签名登录的管理台。

```bash
./up.sh
```

停止：`./down.sh`。连同链数据、浏览器数据库和已部署地址一起删除：`./down.sh -v`。

## 地址

| 用途 | 地址 |
| --- | --- |
| HTTP RPC | http://localhost:8545 |
| WebSocket | ws://localhost:8546 |
| Chain ID | **56056** |
| 原生币 | BNB |
| Blockscout | http://localhost:4000 （后端直连 http://localhost:4001） |
| 管理台 | http://localhost:8080 |
| 水龙头（无需登录） | http://localhost:8080/faucet |
| 水龙头 API | `POST http://localhost:8080/api/faucet` |
| 已部署合约 | `GET http://localhost:8080/api/deployments`，文件在 Docker volume `lab-data` 的 `/data/deployments.json` |

浏览器里的钱包请使用 **http://localhost:8080** 这个源。SIWE 的 domain 是 `localhost:8080`，不要混用 `127.0.0.1`。

容器之间的 Docker 网桥在部分 Linux 上转发不稳定，而且这版客户端把 `0.0.0.0` 绑成只监听 IPv6。所以 RPC 绑在容器自己的 IPv4 地址上，Postgres 和 Redis 也发布到宿主机，其余服务通过 `host.docker.internal` 访问已发布的端口。宿主机上的 RPC 仍然是 http://localhost:8545。

## 为什么是这条链

执行客户端是官方 **bnb-chain/bsc**（二进制名仍是 `geth`），镜像 **`ghcr.io/bnb-chain/bsc:1.8.2`**（标签没有 `v` 前缀；`v1.8.2-td-enhancement` 是另一条临时标签，这里不用）。对应提交 `54afaff4da31ac9e49ba646a4f65104edac5a2f3`。

没有用上游 go-ethereum。上游客户端没有 Parlia，也没有 BSC 预编译（`IsInBSC`）以及 Haber、Bohr、Pascal、Lorentz、Maxwell、Fermi、Osaka、Mendel、Pasteur、Jenner 这些 BSC 分叉。BSC 从 v1.5.2 起删除了 `--dev`，所以本环境使用 **一个验证人的 Parlia**，这是当前客户端能出块的最小形态。

创世文件来自 `bnb-chain/bsc-genesis-contract` 提交 `84641812a013eda1593e058aeed4dc116c7746eb` 的 `genesis-dev.json`，并做了三处本地修改：

- `chainId` 改为 **56056**（官方 dev 创世是 714）
- 补上客户端要求的 Osaka blob schedule（与 BSC 的 Cancun 参数相同）
- `pasteurTime` 设为 0，让主网已上线的 Pasteur 从创世生效。Jenner 留在客户端里但不激活：官方 dev 系统合约没有 payment lane 配置，打开 Jenner 会在第 9 块停出块

其余 BSC 分叉（到 Mendel / Osaka）在官方 dev 创世里已经是 0。

### 不要用 chain id 56

MetaMask 按 chain id 识别网络。本地节点如果广播 56，会和官方 BNB Smart Chain 撞车：钱包可能把本地 RPC 当成主网，或把测试交易发到主网。没有任何依赖强制要求 56，所以这里用 **56056**。请用下面的测试账户或单独的浏览器配置，不要导入持有真实资产的钱包。

## 测试账户

这些私钥是公开的测试钥。Anvil / Hardhat 账户，以及 BSC 创世仓库里注明 “only use in dev” 的验证人钥。**不要**把它们用于任何公共网络。

每个账户在创世时有 1,000,000,000 BNB。

| 名称 | 地址 | 私钥 | 权限 |
| --- | --- | --- | --- |
| 水龙头 / 管理员 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` | 水龙头签名、默认可登录管理台 |
| 管理员 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` | 默认可登录 |
| 普通账户 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` | 有余额，不能登录管理台 |
| 普通账户 | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6` | 有余额，不能登录管理台 |
| 验证人 | `0x9fB29AAc15b9A4B7F17c3385939b007540f4d791` | `0x9b28f36fbd67381120752d6172ecdcf10e06ab2d9a1367aac00cdcd6ac7855d3` | 出块；默认可登录。节点为了出块会解锁这把钥，RPC 只应留在本机 |

管理台允许名单由 `ADMIN_ADDRESSES` 决定。默认不是“谁先签名谁就是管理员”。`DEV_ALLOW_OPEN_ADMIN` 默认关闭。

## 水龙头

`POST /api/faucet` 不需要登录、签名或 API key。

```bash
curl -s http://localhost:8080/api/faucet \
  -H 'content-type: application/json' \
  -d '{"address":"0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC","asset":"bnb","amount":"10000"}'
```

`asset` 为 `bnb` 或 `lab`。`amount` 是整币数量，单次最多 1,000,000。页面上超过 10,000 会再确认一次。按 IP 限流，默认大约每秒补充 10 次、突发 60 次，只适合本机实验室。

## PancakeSwap

首次启动时 `deploy` 容器会等链出块，然后部署并写入 `deployments.json`。重复启动如果链上已有代码会直接跳过。

部署内容：

- WBNB
- LabToken（`LAB`，水龙头是 owner，可以 mint）
- PancakeFactory、PancakeRouter（V2，手续费 0.25%）
- 一笔初始流动性：1,000,000 LAB 和 1,000 WBNB

合约来自 Uniswap V2 core（GPL-3.0，改名为 Pancake）和 `pancakeswap/pancake-swap-periphery` `d769a6d`，手续费常量改成当前 V2 的 9975/10000，并用本次编译的 pair creation code 填上 init code hash。产物在 `deploy/artifacts/pancake-v2.json`。

没有自动部署 V3。官方 `pancake-v3-contracts` 是一套 Hardhat monorepo，放进第一次启动里很容易把整栈拖垮。V2 工厂、路由、WBNB 和默认池已经足够做本地兑换。

## 管理台登录

只保护管理台和管理 API。水龙头不走这套登录。

1. `POST /api/auth/siwe-message`，body 只有地址和 chain id。服务端自己构造 EIP-4361 消息（domain、URI、chain id、nonce、issued-at、10 分钟过期、30 秒 not-before）。
2. 钱包对**原文**做 `personal_sign`。连接钱包不会自动要签名。
3. `POST /api/auth/verify`。服务端用 `signinwithethereum` 0.8 校验 domain、URI、chain id、nonce、时间和签名。合约钱包走本地节点上的 ERC-1271 / ERC-6492，不会去打公共 BSC RPC。
4. 成功后轮换 session id，把身份放进服务端 session。Cookie 名 `id`，HttpOnly，SameSite=Strict，Path=/，不设 Domain。空闲 12 小时过期。本地 HTTP 不设 Secure。
5. 签名有效但不在允许名单里返回 403，不建立会话。

变更类的 `/api/auth/*` 和管理接口要求 `Origin` 或 `Referer` 等于 `SIWE_URI`。用 curl 调登录接口时加上 `-H 'Origin: http://localhost:8080'`。

## 持久化

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 链数据 | volume `bsc-data` | 保留 |
| Blockscout Postgres | volume `blockscout-db` | 保留 |
| 部署地址、水龙头记录 | volume `lab-data` | 保留 |
| 容器日志副本 | volume `lab-logs` | 保留 |
| 登录 session | API 进程内存 | 重启管理台后要重新签名 |

`./down.sh` 不删 volume。`./down.sh -v` 会清空上面这些数据，下次启动会重新创世并重新部署合约。

## Blockscout

镜像是 GHCR 上实际存在的标签，而不是 GitHub release 页上尚未发布到仓库的版本号：

- 后端 `ghcr.io/blockscout/blockscout:9.0.2`
- 前端 `ghcr.io/blockscout/frontend:v2.3.5`

内部交易索引默认关闭（`INDEXER_DISABLE_INTERNAL_TRANSACTIONS_FETCHER=true`），避免本地 trace 在第一次启动时拖垮索引器。浏览器仍然显示区块、交易和余额。需要内部交易时在 `.env` 里改成 `false` 再 `./up.sh`。

## 布局

- `chain/` 创世、验证人测试钥、启动脚本
- `deploy/` PancakeSwap 部署
- `crates/api/` Axum API（SIWE、水龙头、只读链信息）
- `console/` Vite + React 管理台，由 API 同源托管
- `blockscout/nginx.conf` 把浏览器的 `/api` 转到后端

## English

`./up.sh` starts one local stack: official BSC client `ghcr.io/bnb-chain/bsc:1.8.2` as a single Parlia validator, chain id **56056**, PancakeSwap V2, Blockscout at http://localhost:4000, an unauthenticated faucet, and a signature-login admin console at http://localhost:8080.

Chain id 56 is intentionally not used. MetaMask keys networks by chain id, so a local node advertising 56 collides with BNB Smart Chain mainnet. No dependency here requires 56. Use the documented test keys only.

Upstream go-ethereum is not used: it has neither Parlia nor the BSC precompiles and hardforks. BSC removed `--dev` in v1.5.2, so this lab runs the smallest setup the current client can seal with: one validator from the official dev genesis. Pasteur is active at genesis. Jenner stays in the v1.8.2 binary but is not scheduled, because the official dev system contracts have no payment-lane config and enabling Jenner stops block production at block 9.

The faucet is `POST /api/faucet` with no login. Admin routes use server-built EIP-4361 SIWE (`signinwithethereum` 0.8), an HttpOnly SameSite=Strict session cookie, and an env allowlist. A valid signature from an address that is not on the list is 403.

PancakeSwap addresses are written to `/data/deployments.json` in the `lab-data` volume and served at `GET /api/deployments`. Chain data and the Blockscout database survive `./down.sh`. Sessions do not. `./down.sh -v` wipes persisted data.

Inside Compose, services reach the node, Postgres, and Redis through `host.docker.internal` and the published ports. This client's RPC socket is IPv4-only on the container address, and some Linux bridge setups drop container-to-container packets. The URLs you use on the host stay `localhost`.
