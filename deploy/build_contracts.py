#!/usr/bin/env python3
"""Vendor PancakeSwap V2 (Uniswap V2 core, renamed) and compile artifacts.

Sources
- Uniswap v2-core (GPL-3.0) renamed UniswapV2 -> Pancake, error strings included.
- pancakeswap/pancake-swap-periphery @ d769a6d (GPL-3.0).
- Fee math is the current PancakeSwap V2 0.25% schedule (9975/10000), patched
  into both the pair and PancakeLibrary so they match. The 2020 periphery
  snapshot still had the earlier 0.20% constants.

The pair creation-code keccak is written into PancakeLibrary before the router
is compiled, so pairFor() matches this factory.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor"
CORE_SRC = Path("/tmp/src/v2-core/contracts")
PERI_SRC = Path("/tmp/src/pancake-swap-periphery/contracts")
LIB_SRC = Path("/tmp/src/solidity-lib/contracts/libraries/TransferHelper.sol")
SOLC0516 = Path("/tmp/solc/solc0516")
SOLC066 = Path("/tmp/solc/solc066")
SOLC0820 = Path("/tmp/solc/solc0820")
ART = ROOT / "artifacts"

RENAMES = [
    ("IUniswapV2ERC20", "IPancakeERC20"),
    ("IUniswapV2Factory", "IPancakeFactory"),
    ("IUniswapV2Pair", "IPancakePair"),
    ("IUniswapV2Callee", "IPancakeCallee"),
    ("UniswapV2ERC20", "PancakeERC20"),
    ("UniswapV2Factory", "PancakeFactory"),
    ("UniswapV2Pair", "PancakePair"),
    ("UniswapV2", "Pancake"),
]


def rewrite(text: str) -> str:
    for old, new in RENAMES:
        text = text.replace(old, new)
    return text


def copy_tree(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True)
    for path in src.rglob("*"):
        if path.is_dir():
            continue
        if "test" in path.parts:
            continue
        rel = Path(rewrite(path.relative_to(src).as_posix()))
        out = dst / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        if path.suffix == ".sol":
            out.write_text(rewrite(path.read_text()))
        else:
            shutil.copy2(path, out)


def patch_pair_fee(path: Path) -> None:
    text = path.read_text()
    old = """        uint balance0Adjusted = balance0.mul(1000).sub(amount0In.mul(3));
        uint balance1Adjusted = balance1.mul(1000).sub(amount1In.mul(3));
        require(balance0Adjusted.mul(balance1Adjusted) >= uint(_reserve0).mul(_reserve1).mul(1000**2), 'Pancake: K');"""
    new = """        // PancakeSwap V2 fee is 0.25% (25 / 10000), not Uniswap's 0.30%.
        uint balance0Adjusted = balance0.mul(10000).sub(amount0In.mul(25));
        uint balance1Adjusted = balance1.mul(10000).sub(amount1In.mul(25));
        require(balance0Adjusted.mul(balance1Adjusted) >= uint(_reserve0).mul(_reserve1).mul(10000**2), 'Pancake: K');"""
    if old not in text:
        raise SystemExit("pair fee pattern not found")
    path.write_text(text.replace(old, new, 1))


def patch_factory_hash_constant(path: Path) -> None:
    text = path.read_text()
    needle = "contract PancakeFactory is IPancakeFactory {\n"
    insert = needle + "    bytes32 public constant INIT_CODE_PAIR_HASH = keccak256(abi.encodePacked(type(PancakePair).creationCode));\n"
    if needle not in text:
        raise SystemExit("factory header not found")
    path.write_text(text.replace(needle, insert, 1))


def patch_library(path: Path, init_hash: str) -> None:
    text = path.read_text()
    text = text.replace(
        "import '@uniswap/v2-core/contracts/interfaces/IPancakePair.sol';",
        "import './IPancakePair.sol';",
    )
    text = text.replace(
        "uint amountInWithFee = amountIn.mul(998);",
        "uint amountInWithFee = amountIn.mul(9975);",
    )
    text = text.replace(
        "uint denominator = reserveIn.mul(1000).add(amountInWithFee);",
        "uint denominator = reserveIn.mul(10000).add(amountInWithFee);",
    )
    text = text.replace(
        "uint numerator = reserveIn.mul(amountOut).mul(1000);",
        "uint numerator = reserveIn.mul(amountOut).mul(10000);",
    )
    text = text.replace(
        "uint denominator = reserveOut.sub(amountOut).mul(998);",
        "uint denominator = reserveOut.sub(amountOut).mul(9975);",
    )
    # init code hash placeholder replaced after we know it; first pass uses a marker
    import re

    text2, n = re.subn(
        r"hex'[0-9a-fA-F]{64}' // init code hash",
        f"hex'{init_hash}' // init code hash",
        text,
        count=1,
    )
    if n != 1:
        raise SystemExit("init code hash placeholder not found")
    path.write_text(text2)


def patch_router_imports(path: Path) -> None:
    text = path.read_text()
    replacements = {
        "import '@uniswap/v2-core/contracts/interfaces/IPancakeFactory.sol';": "import './IPancakeFactory.sol';",
        "import '@uniswap/lib/contracts/libraries/TransferHelper.sol';": "import './TransferHelper.sol';",
        "import './interfaces/IPancakeRouter02.sol';": "import './IPancakeRouter02.sol';",
        "import './libraries/PancakeLibrary.sol';": "import './PancakeLibrary.sol';",
        "import './libraries/SafeMath.sol';": "import './SafeMath.sol';",
        "import './interfaces/IERC20.sol';": "import './IERC20.sol';",
        "import './interfaces/IWETH.sol';": "import './IWETH.sol';",
    }
    for old, new in replacements.items():
        if old not in text:
            raise SystemExit(f"router import missing: {old}")
        text = text.replace(old, new)
    path.write_text(text)


def solc_standard(solc: Path, sources: dict[str, str], evm: str) -> dict:
    payload = {
        "language": "Solidity",
        "sources": {name: {"content": content} for name, content in sources.items()},
        "settings": {
            "optimizer": {"enabled": True, "runs": 200},
            "evmVersion": evm,
            "outputSelection": {"*": {"": ["abi"], "*": ["abi", "evm.bytecode.object"]}},
        },
    }
    proc = subprocess.run(
        [str(solc), "--standard-json"],
        input=json.dumps(payload).encode(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode != 0:
        raise SystemExit(proc.stderr.decode() or proc.stdout.decode())
    out = json.loads(proc.stdout)
    if out.get("errors"):
        fatal = [e for e in out["errors"] if e.get("severity") == "error"]
        if fatal:
            raise SystemExit(json.dumps(fatal, indent=2))
    return out


def read_sources(base: Path) -> dict[str, str]:
    sources = {}
    for path in base.rglob("*.sol"):
        rel = path.relative_to(base).as_posix()
        sources[rel] = path.read_text()
    return sources


def artifact(out: dict, filename: str, contract: str) -> dict:
    compiled = out["contracts"][filename][contract]
    bytecode = compiled["evm"]["bytecode"]["object"]
    if not bytecode:
        raise SystemExit(f"empty bytecode for {contract}")
    return {"contract": contract, "abi": compiled["abi"], "bytecode": "0x" + bytecode}


def main() -> None:
    core = VENDOR / "core"
    copy_tree(CORE_SRC, core)
    patch_pair_fee(core / "PancakePair.sol")
    patch_factory_hash_constant(core / "PancakeFactory.sol")

    # Interfaces the periphery imports, kept next to the router sources.
    peri = VENDOR / "periphery"
    if peri.exists():
        shutil.rmtree(peri)
    peri.mkdir(parents=True)
    for name in [
        "PancakeRouter.sol",
        "libraries/PancakeLibrary.sol",
        "libraries/SafeMath.sol",
        "interfaces/IPancakeRouter01.sol",
        "interfaces/IPancakeRouter02.sol",
        "interfaces/IERC20.sol",
        "interfaces/IWETH.sol",
    ]:
        src = PERI_SRC / name
        dst = peri / Path(name).name
        dst.write_text(src.read_text())
    (peri / "IPancakeFactory.sol").write_text((core / "interfaces" / "IPancakeFactory.sol").read_text())
    (peri / "IPancakePair.sol").write_text((core / "interfaces" / "IPancakePair.sol").read_text())
    (peri / "TransferHelper.sol").write_text(LIB_SRC.read_text())
    patch_router_imports(peri / "PancakeRouter.sol")

    core_out = solc_standard(SOLC0516, read_sources(core), "istanbul")
    factory = artifact(core_out, "PancakeFactory.sol", "PancakeFactory")
    pair = artifact(core_out, "PancakePair.sol", "PancakePair")

    import hashlib

    # hashlib doesn't do keccak. Use a tiny node-free implementation via pysha3 or openssl.
    init_hash = keccak256(bytes.fromhex(pair["bytecode"][2:]))

    patch_library(peri / "PancakeLibrary.sol", init_hash)
    # Library import path for SafeMath is "./SafeMath.sol" already relative from libraries/.
    # We flattened library next to the router, and SafeMath import is "./SafeMath.sol" which
    # is correct after the copy (we copied libraries/SafeMath.sol to SafeMath.sol).
    lib_text = (peri / "PancakeLibrary.sol").read_text()
    if 'import "./SafeMath.sol";' not in lib_text and "import \"./SafeMath.sol\";" not in lib_text:
        # original is ./SafeMath.sol from libraries/. Our file is flattened beside SafeMath.sol.
        pass

    peri_sources = read_sources(peri)
    peri_out = solc_standard(SOLC066, peri_sources, "istanbul")
    router = artifact(peri_out, "PancakeRouter.sol", "PancakeRouter")

    own = {
        "WBNB.sol": (ROOT / "contracts" / "WBNB.sol").read_text(),
        "LabToken.sol": (ROOT / "contracts" / "LabToken.sol").read_text(),
    }
    own_out = solc_standard(SOLC0820, own, "paris")
    wbnb = artifact(own_out, "WBNB.sol", "WBNB")
    lab = artifact(own_out, "LabToken.sol", "LabToken")

    ART.mkdir(exist_ok=True)
    bundle = {
        "compiler": {
            "core": "solc 0.5.16+commit.9c3226ce optimizer 200 istanbul",
            "router": "solc 0.6.6+commit.6c089d02 optimizer 200 istanbul",
            "tokens": "solc 0.8.20+commit.a1b79de6 optimizer 200 paris",
        },
        "initCodeHash": "0x" + init_hash,
        "feeBps": 25,
        "contracts": {
            "PancakeFactory": factory,
            "PancakePair": {"abi": pair["abi"]},
            "PancakeRouter": router,
            "WBNB": wbnb,
            "LabToken": lab,
        },
    }
    (ART / "pancake-v2.json").write_text(json.dumps(bundle))
    print("initCodeHash", bundle["initCodeHash"])
    print("factory bytes", len(factory["bytecode"]))
    print("router bytes", len(router["bytecode"]))
    print("wrote", ART / "pancake-v2.json")


def keccak256(data: bytes) -> str:
    try:
        from Crypto.Hash import keccak

        h = keccak.new(digest_bits=256)
        h.update(data)
        return h.hexdigest()
    except ImportError:
        proc = subprocess.run(
            ["node", "--input-type=module", "-e",
             "import {keccak256} from 'viem'; import {readFileSync} from 'fs';"
             "const hex=readFileSync(0,'utf8').trim();"
             "process.stdout.write(keccak256('0x'+hex).slice(2));"],
            input=data.hex().encode(),
            stdout=subprocess.PIPE,
            check=False,
        )
        if proc.returncode != 0:
            raise SystemExit("need pycryptodome or viem to compute keccak")
        return proc.stdout.decode().strip()


if __name__ == "__main__":
    main()
