require("dotenv").config();
const { ethers } = require("ethers");
const { FlashbotsBundleProvider, FlashbotsBundleResolution } = require('@flashbots/ethers-provider-bundle');

// ---- Utilities ----
const toBN = (x) => ethers.BigNumber.from(x.toString());
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();

// ---- Config ----
const MODE = (process.env.MODE || "single").toLowerCase(); // simple|single|multi|multi_parallel

// RPC and provider
const RPC_URL = process.env.RPC_URL; // single URL (backward compatible)
const RPC_URLS = (process.env.RPC_URLS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const MINT_FUNC = (process.env.MINT_FUNC || "mint").trim();

// Args for the mint function; default to [MINT_AMOUNT]
const MINT_AMOUNT = toBN(process.env.MINT_AMOUNT || 1);
let MINT_ARGS;
try {
  // Allow any function signature; user can specify full args as JSON array
  // e.g. ["0xYourAddress", 1, "0xproof..."]
  MINT_ARGS = process.env.MINT_ARGS_JSON ? JSON.parse(process.env.MINT_ARGS_JSON) : [MINT_AMOUNT.toString()];
  if (!Array.isArray(MINT_ARGS)) throw new Error("MINT_ARGS_JSON must be a JSON array");
} catch (e) {
  console.error("Invalid MINT_ARGS_JSON:", e.message || e);
  process.exit(1);
}

// Price
const PRICE_WEI = ethers.utils.parseEther(String(process.env.MINT_PRICE || "0"));

// Gas limit / estimate config
const GAS_LIMIT = process.env.GAS_LIMIT ? toBN(process.env.GAS_LIMIT) : undefined;
const GAS_LIMIT_BUFFER_PERCENT = Number(process.env.GAS_LIMIT_BUFFER_PERCENT || 20); // add 20% on top of estimate

// Retry config
const RETRY_ATTEMPTS = Number(process.env.RETRY_ATTEMPTS || 5);
const RETRY_BACKOFF_MS = Number(process.env.RETRY_BACKOFF_MS || 2000);
const RETRY_BACKOFF_MULTIPLIER = Number(process.env.RETRY_BACKOFF_MULTIPLIER || 1.6);
const GAS_BUMP_PERCENT = Number(process.env.GAS_BUMP_PERCENT || 15);

// EIP-1559 / legacy fee config
const MAX_FEE_GWEI = process.env.MAX_FEE_GWEI;
const MAX_PRIORITY_GWEI = process.env.MAX_PRIORITY_GWEI;
const GAS_PRICE_GWEI = process.env.GAS_PRICE_GWEI;

// Nonce strategy
const NONCE_STRATEGY = (process.env.NONCE_STRATEGY || "pending").toLowerCase(); // pending|latest|manual
const NONCE_MANUAL = process.env.NONCE ? Number(process.env.NONCE) : undefined;

// Multi-wallet config
const PRIVATE_KEYS = (process.env.PRIVATE_KEYS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const TX_DELAY_MS = Number(process.env.TX_DELAY_MS || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 4));
const JITTER_MS = Number(process.env.JITTER_MS || 250);

// Timing options
const WAIT_NEXT_BLOCK = String(process.env.WAIT_NEXT_BLOCK || "false").toLowerCase() === "true";

// Safety
const DRY_RUN = String(process.env.DRY_RUN || "false").toLowerCase() === "true";

// Submission mode
const SUBMIT_MODE = (process.env.SUBMIT_MODE || "public").toLowerCase(); // public|flashbots
const FLASHBOTS_RELAY = process.env.FLASHBOTS_RELAY || "https://relay.flashbots.net";
const FLASHBOTS_AUTH_KEY = process.env.FLASHBOTS_AUTH_KEY; // optional; random if not provided

// Pre-checks
const CALLSTATIC_CHECK = String(process.env.CALLSTATIC_CHECK || "true").toLowerCase() === "true";

// Scheduling
const START_AT_BLOCK = process.env.START_AT_BLOCK ? Number(process.env.START_AT_BLOCK) : undefined;
const START_AT_TIMESTAMP = process.env.START_AT_TIMESTAMP
  ? (isNaN(Number(process.env.START_AT_TIMESTAMP))
      ? new Date(process.env.START_AT_TIMESTAMP).getTime()
      : Number(process.env.START_AT_TIMESTAMP))
  : undefined;

// Chain presets
const CHAIN = (process.env.CHAIN || "").toLowerCase(); // ethereum|base|arbitrum|optimism|polygon|bnb|...
const INFURA_KEY = process.env.INFURA_KEY;
const ALCHEMY_KEY = process.env.ALCHEMY_KEY;

// ---- ABI helpers ----
function buildAbi() {
  const abiStr = process.env.ABI_OVERRIDE?.trim();
  if (abiStr) {
    try {
      return JSON.parse(abiStr);
    } catch (e) {
      console.error("Invalid ABI_OVERRIDE JSON:", e.message || e);
      process.exit(1);
    }
  }
  // Generic default: a payable mint with uint256 count
  return [`function ${MINT_FUNC}(uint256 _count) payable`];
}

function bumpLegacyGas(gasPrice) {
  return gasPrice.mul(100 + GAS_BUMP_PERCENT).div(100);
}

function bumpEip1559(fees) {
  const next = { ...fees };
  next.maxFeePerGas = next.maxFeePerGas.mul(100 + GAS_BUMP_PERCENT).div(100);
  next.maxPriorityFeePerGas = next.maxPriorityFeePerGas.mul(100 + GAS_BUMP_PERCENT).div(100);
  return next;
}

async function getStartingFees(provider) {
  if (MAX_FEE_GWEI && MAX_PRIORITY_GWEI) {
    return {
      type: "eip1559",
      maxFeePerGas: ethers.utils.parseUnits(MAX_FEE_GWEI, "gwei"),
      maxPriorityFeePerGas: ethers.utils.parseUnits(MAX_PRIORITY_GWEI, "gwei"),
    };
  }
  if (GAS_PRICE_GWEI) {
    return {
      type: "legacy",
      gasPrice: ethers.utils.parseUnits(GAS_PRICE_GWEI, "gwei"),
    };
  }
  const fee = await provider.getFeeData();
  if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
    return { type: "eip1559", maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas };
  }
  return { type: "legacy", gasPrice: fee.gasPrice || ethers.utils.parseUnits("20", "gwei") };
}

function mergeTxFees(base, fees) {
  if (!fees) return base;
  if (fees.type === "legacy") return { ...base, gasPrice: fees.gasPrice };
  return { ...base, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
}

function getProvider() {
  const urls = resolveRpcUrls();
  if (urls.length === 1) {
    return new ethers.providers.JsonRpcProvider(urls[0]);
  }
  const providers = urls.map((u) => new ethers.providers.JsonRpcProvider(u));
  return new ethers.providers.FallbackProvider(providers);
}

function resolveRpcUrls() {
  const explicit = [...RPC_URLS];
  if (RPC_URL) explicit.push(RPC_URL);
  const cleaned = explicit.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length) return cleaned;

  const preset = getPresetRpcUrls(CHAIN);
  if (preset.length) return preset;

  throw new Error("RPC_URL or RPC_URLS must be provided (or set CHAIN to use presets)");
}

function getPresetRpcUrls(chain) {
  if (!chain) return [];
  const urls = [];
  const add = (u) => { if (u && !urls.includes(u)) urls.push(u); };

  switch (chain) {
    case "ethereum":
    case "eth":
      if (INFURA_KEY) add(`https://mainnet.infura.io/v3/${INFURA_KEY}`);
      if (ALCHEMY_KEY) add(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`);
      add("https://1rpc.io/eth");
      add("https://eth.llamarpc.com");
      break;
    case "base":
      if (ALCHEMY_KEY) add(`https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`);
      add("https://mainnet.base.org");
      add("https://1rpc.io/base");
      break;
    case "arbitrum":
    case "arb":
      if (ALCHEMY_KEY) add(`https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`);
      add("https://arb1.arbitrum.io/rpc");
      add("https://1rpc.io/arb");
      break;
    case "optimism":
    case "op":
      if (ALCHEMY_KEY) add(`https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`);
      add("https://mainnet.optimism.io");
      add("https://1rpc.io/op");
      break;
    case "polygon":
    case "matic":
      if (ALCHEMY_KEY) add(`https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`);
      add("https://polygon-rpc.com");
      add("https://1rpc.io/matic");
      break;
    case "bnb":
    case "bsc":
      add("https://bsc-dataseed.binance.org");
      add("https://1rpc.io/bnb");
      break;
    // For newer/less common chains (ape, hype, abstract), please provide RPC_URLS manually in .env
    case "ape":
    case "hype":
    case "abstract":
      // Placeholder: user should set RPC_URLS for these chains due to evolving infra
      break;
    default:
      break;
  }
  return urls;
}

async function preflight(provider) {
  const network = await provider.getNetwork();
  console.log(`[${now()}] Connected to chainId=${network.chainId}`);

  const code = await provider.getCode(CONTRACT_ADDRESS);
  if (!code || code === "0x") {
    throw new Error(`No contract code at ${CONTRACT_ADDRESS}`);
  }
}

async function waitUntilBlock(provider, targetBlock) {
  if (!targetBlock) return;
  while (true) {
    const n = await provider.getBlockNumber();
    if (n >= targetBlock) return;
    await sleep(300);
  }
}

async function waitUntilTimestamp(targetMs) {
  if (!targetMs) return;
  while (Date.now() < targetMs) {
    await sleep(300);
  }
}

async function callStaticMintCheck(contract) {
  if (!CALLSTATIC_CHECK || DRY_RUN) return;
  const value = PRICE_WEI.mul(toBN(MINT_AMOUNT));
  try {
    await contract.callStatic[MINT_FUNC](...MINT_ARGS, { value });
  } catch (e) {
    const reason = e?.error?.message || e?.data?.message || e?.reason || e?.message || String(e);
    throw new Error(`callStatic check failed (mint would revert): ${reason}`);
  }
}

async function createFlashbotsProvider(provider) {
  const authSigner = FLASHBOTS_AUTH_KEY ? new ethers.Wallet(FLASHBOTS_AUTH_KEY) : ethers.Wallet.createRandom();
  return await FlashbotsBundleProvider.create(provider, authSigner, FLASHBOTS_RELAY);
}

async function sendViaFlashbots(wallet, initialRequest, provider) {
  const fb = await createFlashbotsProvider(provider);

  let attempt = 0;
  let waitMs = RETRY_BACKOFF_MS;
  let fees = await getStartingFees(provider);

  while (true) {
    const request = mergeTxFees({ ...initialRequest }, fees);
    const signed = await wallet.signTransaction(request);
    const txHash = ethers.utils.keccak256(signed);

    const currentBlock = await provider.getBlockNumber();
    const targetBlock = currentBlock + 1;

    try {
      const sim = await fb.simulate([{ signedTransaction: signed }], targetBlock);
      if (sim.error) throw new Error(sim.error.message || String(sim.error));

      const submit = await fb.sendRawBundle([{ signedTransaction: signed }], targetBlock);
      const res = await submit.wait();
      if (res === FlashbotsBundleResolution.BundleIncluded) {
        console.log(`[${now()}] ✅ Flashbots included ${txHash} at block ${targetBlock}`);
        const rc = await provider.waitForTransaction(txHash);
        return rc;
      }
      if (res === FlashbotsBundleResolution.AccountNonceTooHigh) {
        throw new Error("Nonce too high: transaction already mined or replaced");
      }
      // Not included in this block; continue retrying with higher fees
      attempt += 1;
      console.warn(`[${now()}] ⚠️ Bundle not included (attempt ${attempt}), bumping fees...`);
    } catch (e) {
      attempt += 1;
      console.warn(`[${now()}] ❌ Flashbots attempt ${attempt} failed: ${e.message || e}`);
    }

    if (attempt >= RETRY_ATTEMPTS) throw new Error("Flashbots: max attempts reached without inclusion");

    // bump fees and backoff
    if (fees.type === "legacy") {
      fees = { type: "legacy", gasPrice: bumpLegacyGas(fees.gasPrice) };
    } else {
      fees = { type: "eip1559", ...bumpEip1559(fees) };
    }
    await sleep(waitMs);
    waitMs = Math.ceil(waitMs * RETRY_BACKOFF_MULTIPLIER);
  }
}

async function estimateGasWithBuffer(contract, args, overrides) {
  try {
    if (DRY_RUN) return undefined;
    if (GAS_LIMIT) return GAS_LIMIT;
    const est = await contract.estimateGas[MINT_FUNC](...args, overrides);
    const buffered = est.mul(100 + GAS_LIMIT_BUFFER_PERCENT).div(100);
    return buffered;
  } catch (e) {
    if (GAS_LIMIT) return GAS_LIMIT;
    console.warn("Gas estimation failed, proceeding without explicit gasLimit:", e.message || e);
    return undefined;
  }
}

async function getNonce(wallet) {
  if (DRY_RUN) return 0;
  if (NONCE_STRATEGY === "manual") {
    if (typeof NONCE_MANUAL !== "number" || Number.isNaN(NONCE_MANUAL)) {
      throw new Error("NONCE_STRATEGY=manual requires NONCE to be set");
    }
    return NONCE_MANUAL;
  }
  const blockTag = NONCE_STRATEGY === "latest" ? "latest" : "pending";
  return wallet.getTransactionCount(blockTag);
}

async function buildMintRequest(wallet, contract, provider, fees) {
  const value = PRICE_WEI.mul(toBN(MINT_AMOUNT));
  const feeFields = fees?.type === "legacy" ? { gasPrice: fees.gasPrice } : { maxFeePerGas: fees?.maxFeePerGas, maxPriorityFeePerGas: fees?.maxPriorityFeePerGas };

  const populated = await contract.populateTransaction[MINT_FUNC](...MINT_ARGS, { value });

  const gasLimit = await estimateGasWithBuffer(contract, MINT_ARGS, { value, ...feeFields });

  const nonce = await getNonce(wallet);

  const request = {
    to: CONTRACT_ADDRESS,
    data: populated.data,
    value,
    gasLimit,
    ...feeFields,
    nonce,
  };
  if (!DRY_RUN && provider) {
    request.chainId = (await provider.getNetwork()).chainId;
  }

  return request;
}

async function sendWithReplacement(wallet, initialRequest, provider) {
  let attempt = 0;
  let waitMs = RETRY_BACKOFF_MS;
  let fees = await getStartingFees(provider);

  // Apply starting fees
  let request = mergeTxFees(initialRequest, fees);

  // Optional: align to next block for fair ordering
  if (WAIT_NEXT_BLOCK) {
    const current = await provider.getBlockNumber();
    await new Promise((resolve) => {
      const handler = (n) => {
        if (n >= current + 1) {
          provider.off("block", handler);
          resolve();
        }
      };
      provider.on("block", handler);
    });
  }

  while (true) {
    try {
      const tx = await wallet.sendTransaction(request);
      console.log(`[${now()}] Tx sent: ${tx.hash} (attempt ${attempt + 1}, nonce ${tx.nonce})`);
      const rc = await tx.wait();
      console.log(`[${now()}] ✅ Confirmed: ${rc.transactionHash} in block ${rc.blockNumber}`);
      return rc;
    } catch (err) {
      attempt += 1;
      const message = err && err.message ? err.message : String(err);
      console.warn(`[${now()}] ❌ Attempt ${attempt} failed: ${message}`);

      if (attempt >= RETRY_ATTEMPTS) throw err;

      // Bump gas using same nonce for replacement
      if (fees.type === "legacy") {
        fees = { type: "legacy", gasPrice: bumpLegacyGas(fees.gasPrice) };
      } else {
        fees = { type: "eip1559", ...bumpEip1559(fees) };
      }
      request = mergeTxFees({ ...request }, fees);

      console.log(`[${now()}] ⏳ Retrying in ${waitMs}ms with higher fees...`);
      await sleep(waitMs);
      waitMs = Math.ceil(waitMs * RETRY_BACKOFF_MULTIPLIER);
    }
  }
}

async function mintOnce(wallet, contract, provider) {
  await callStaticMintCheck(contract);
  const initialRequest = await buildMintRequest(wallet, contract, provider);
  if (DRY_RUN) {
    console.log("DRY_RUN=true → built tx request:");
    console.log({
      to: initialRequest.to,
      value: initialRequest.value?.toString?.() || initialRequest.value,
      gasLimit: initialRequest.gasLimit?.toString?.() || initialRequest.gasLimit,
      nonce: initialRequest.nonce,
      feeType: initialRequest.gasPrice ? "legacy" : "eip1559",
      maxFeePerGas: initialRequest.maxFeePerGas?.toString?.(),
      maxPriorityFeePerGas: initialRequest.maxPriorityFeePerGas?.toString?.(),
      submitMode: SUBMIT_MODE,
    });
    return null;
  }
  if (SUBMIT_MODE === "flashbots") {
    return sendViaFlashbots(wallet, initialRequest, provider);
  }
  return sendWithReplacement(wallet, initialRequest, provider);
}

async function runSimple(provider) {
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const abi = ["function mint(uint256 _count) public payable"]; // maintain backward compatibility
  const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);
  await mintOnce(wallet, contract, provider);
}

async function runAdvanced(provider) {
  const abi = buildAbi();

  if (MODE === "single") {
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);
    await mintOnce(wallet, contract, provider);
  } else if (MODE === "multi") {
    // Sequential with optional delay
    for (const pk of PRIVATE_KEYS) {
      try {
        const wallet = new ethers.Wallet(pk, provider);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);
        await mintOnce(wallet, contract, provider);
      } catch (e) {
        console.error("❌ Wallet error:", e.message || e);
      }
      const delay = TX_DELAY_MS + Math.floor(Math.random() * JITTER_MS);
      if (delay > 0) await sleep(delay);
    }
  } else if (MODE === "multi_parallel") {
    // Parallel with bounded concurrency
    const queue = [...PRIVATE_KEYS];
    let active = 0;
    const errors = [];

    await new Promise((resolve) => {
      const next = () => {
        if (!queue.length && active === 0) return resolve();
        while (active < CONCURRENCY && queue.length) {
          const pk = queue.shift();
          active += 1;
          const jitter = TX_DELAY_MS + Math.floor(Math.random() * JITTER_MS);
          (async () => {
            try {
              if (jitter > 0) await sleep(jitter);
              const wallet = new ethers.Wallet(pk, provider);
              const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);
              await mintOnce(wallet, contract, provider);
            } catch (e) {
              errors.push(e);
              console.error("❌ Wallet error:", e.message || e);
            } finally {
              active -= 1;
              next();
            }
          })();
        }
      };
      next();
    });

    if (errors.length) {
      console.warn(`${errors.length} wallet(s) encountered errors`);
    }
  } else {
    throw new Error(`Unknown MODE: ${MODE}`);
  }
}

async function main() {
  if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS is required");

  const provider = DRY_RUN ? undefined : getProvider();
  if (!DRY_RUN) await preflight(provider);

  if (!DRY_RUN) {
    if (START_AT_TIMESTAMP) {
      console.log(`[${now()}] Waiting until timestamp ${START_AT_TIMESTAMP}...`);
      await waitUntilTimestamp(START_AT_TIMESTAMP);
    }
    if (START_AT_BLOCK) {
      console.log(`[${now()}] Waiting until block ${START_AT_BLOCK}...`);
      await waitUntilBlock(provider, START_AT_BLOCK);
    }
  }

  if (MODE === "simple") {
    await runSimple(provider);
  } else {
    await runAdvanced(provider);
  }
}

main().catch((e) => {
  console.error("Fatal:", e && e.message ? e.message : e);
  process.exit(1);
});
