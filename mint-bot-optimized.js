require("dotenv").config();
const { ethers } = require("ethers");
const { FlashbotsBundleProvider, FlashbotsBundleResolution } = require("@flashbots/ethers-provider-bundle");

// ---- Enhanced Utilities ----
const toBN = (x) => ethers.BigNumber.from(x.toString());
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();

// Performance monitoring
const perfStats = {
  startTime: Date.now(),
  txSent: 0,
  txConfirmed: 0,
  gasUsed: toBN(0),
  totalFees: toBN(0),
  avgConfirmTime: 0,
};

// ---- Enhanced Config ----
const MODE = (process.env.MODE || "single").toLowerCase();

// Enhanced RPC with priority weighting
const RPC_URL = process.env.RPC_URL;
const RPC_URLS = (process.env.RPC_URLS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Priority RPC for fastest execution
const PRIORITY_RPC = process.env.PRIORITY_RPC; // Fastest RPC for critical operations
const RPC_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS || 3000);
const RPC_RETRY_COUNT = Number(process.env.RPC_RETRY_COUNT || 2);

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const MINT_FUNC = (process.env.MINT_FUNC || "mint").trim();

// Enhanced mint args
const MINT_AMOUNT = toBN(process.env.MINT_AMOUNT || 1);
let MINT_ARGS;
try {
  MINT_ARGS = process.env.MINT_ARGS_JSON ? JSON.parse(process.env.MINT_ARGS_JSON) : [MINT_AMOUNT.toString()];
  if (!Array.isArray(MINT_ARGS)) throw new Error("MINT_ARGS_JSON must be a JSON array");
} catch (e) {
  console.error("Invalid MINT_ARGS_JSON:", e.message || e);
  process.exit(1);
}

const PRICE_WEI = ethers.utils.parseEther(String(process.env.MINT_PRICE || "0"));

// Enhanced gas strategy
const GAS_LIMIT = process.env.GAS_LIMIT ? toBN(process.env.GAS_LIMIT) : undefined;
const GAS_LIMIT_BUFFER_PERCENT = Number(process.env.GAS_LIMIT_BUFFER_PERCENT || 25); // Increased buffer
const AGGRESSIVE_GAS_BUMP = Number(process.env.AGGRESSIVE_GAS_BUMP || 25); // More aggressive bumping

// Enhanced retry with exponential backoff
const RETRY_ATTEMPTS = Number(process.env.RETRY_ATTEMPTS || 8); // More attempts
const RETRY_BACKOFF_MS = Number(process.env.RETRY_BACKOFF_MS || 1000); // Faster initial retry
const RETRY_BACKOFF_MULTIPLIER = Number(process.env.RETRY_BACKOFF_MULTIPLIER || 1.5);
const GAS_BUMP_PERCENT = Number(process.env.GAS_BUMP_PERCENT || AGGRESSIVE_GAS_BUMP);

// Enhanced fee strategy
const MAX_FEE_GWEI = process.env.MAX_FEE_GWEI;
const MAX_PRIORITY_GWEI = process.env.MAX_PRIORITY_GWEI;
const GAS_PRICE_GWEI = process.env.GAS_PRICE_GWEI;

// Dynamic fee adjustment
const DYNAMIC_FEE_MULTIPLIER = Number(process.env.DYNAMIC_FEE_MULTIPLIER || 1.2);
const MAX_FEE_CAP_GWEI = Number(process.env.MAX_FEE_CAP_GWEI || 500); // Safety cap

// Enhanced nonce strategy
const NONCE_STRATEGY = (process.env.NONCE_STRATEGY || "pending").toLowerCase();
const NONCE_MANUAL = process.env.NONCE ? Number(process.env.NONCE) : undefined;
const NONCE_OFFSET = Number(process.env.NONCE_OFFSET || 0); // For advanced nonce management

// Multi-wallet enhancements
const PRIVATE_KEYS = (process.env.PRIVATE_KEYS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const TX_DELAY_MS = Number(process.env.TX_DELAY_MS || 0);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 6)); // Increased concurrency
const JITTER_MS = Number(process.env.JITTER_MS || 100); // Reduced jitter for speed

// Enhanced timing
const WAIT_NEXT_BLOCK = String(process.env.WAIT_NEXT_BLOCK || "false").toLowerCase() === "true";
const PRELOAD_NONCES = String(process.env.PRELOAD_NONCES || "true").toLowerCase() === "true";
const MEMPOOL_MONITORING = String(process.env.MEMPOOL_MONITORING || "true").toLowerCase() === "true";

// Safety and monitoring
const DRY_RUN = String(process.env.DRY_RUN || "false").toLowerCase() === "true";
const VERBOSE_LOGGING = String(process.env.VERBOSE_LOGGING || "false").toLowerCase() === "true";

// Enhanced submission modes
const SUBMIT_MODE = (process.env.SUBMIT_MODE || "public").toLowerCase();
const FLASHBOTS_RELAY = process.env.FLASHBOTS_RELAY || "https://relay.flashbots.net";
const FLASHBOTS_AUTH_KEY = process.env.FLASHBOTS_AUTH_KEY;

// Multi-relay support for redundancy
const FLASHBOTS_RELAYS = (process.env.FLASHBOTS_RELAYS || FLASHBOTS_RELAY)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Pre-checks
const CALLSTATIC_CHECK = String(process.env.CALLSTATIC_CHECK || "true").toLowerCase() === "true";
const BALANCE_CHECK = String(process.env.BALANCE_CHECK || "true").toLowerCase() === "true";

// Scheduling
const START_AT_BLOCK = process.env.START_AT_BLOCK ? Number(process.env.START_AT_BLOCK) : undefined;
const START_AT_TIMESTAMP = process.env.START_AT_TIMESTAMP ? (isNaN(Number(process.env.START_AT_TIMESTAMP)) ? new Date(process.env.START_AT_TIMESTAMP).getTime() : Number(process.env.START_AT_TIMESTAMP)) : undefined;

// Chain presets with enhanced RPC lists
const CHAIN = (process.env.CHAIN || "").toLowerCase();
const INFURA_KEY = process.env.INFURA_KEY;
const ALCHEMY_KEY = process.env.ALCHEMY_KEY;
const QUICKNODE_KEY = process.env.QUICKNODE_KEY;
const ANKR_KEY = process.env.ANKR_KEY;

// ---- Enhanced Provider Management ----
class EnhancedProvider {
  constructor(urls, priorityUrl = null) {
    this.urls = urls;
    this.priorityUrl = priorityUrl;
    this.providers = [];
    this.priorityProvider = null;
    this.currentIndex = 0;
    this.failedProviders = new Set();
    this.setupProviders();
  }

  setupProviders() {
    // Setup priority provider
    if (this.priorityUrl) {
      this.priorityProvider = new ethers.providers.JsonRpcProvider({
        url: this.priorityUrl,
        timeout: RPC_TIMEOUT_MS,
      });
    }

    // Setup regular providers
    this.providers = this.urls.map(
      (url) =>
        new ethers.providers.JsonRpcProvider({
          url,
          timeout: RPC_TIMEOUT_MS,
        })
    );

    // Use fallback provider for redundancy
    if (this.providers.length > 1) {
      this.fallbackProvider = new ethers.providers.FallbackProvider(
        this.providers.map((provider, index) => ({
          provider,
          priority: index === 0 ? 1 : 2,
          stallTimeout: RPC_TIMEOUT_MS,
          weight: 1,
        }))
      );
    }
  }

  async getProvider(preferPriority = false) {
    if (preferPriority && this.priorityProvider) {
      return this.priorityProvider;
    }

    if (this.fallbackProvider) {
      return this.fallbackProvider;
    }

    return this.providers[0] || this.priorityProvider;
  }

  async executeWithRetry(operation, preferPriority = false) {
    let lastError;

    for (let attempt = 0; attempt < RPC_RETRY_COUNT; attempt++) {
      try {
        const provider = await this.getProvider(preferPriority);
        return await operation(provider);
      } catch (error) {
        lastError = error;
        if (VERBOSE_LOGGING) {
          console.warn(`[${now()}] RPC attempt ${attempt + 1} failed:`, error.message);
        }

        if (attempt < RPC_RETRY_COUNT - 1) {
          await sleep(500 * (attempt + 1));
        }
      }
    }

    throw lastError;
  }
}

// ---- Enhanced Gas Management ----
class GasManager {
  constructor(provider) {
    this.provider = provider;
    this.baseFeeHistory = [];
    this.priorityFeeHistory = [];
    this.lastUpdate = 0;
  }

  async updateFeeHistory() {
    if (Date.now() - this.lastUpdate < 5000) return; // Cache for 5 seconds

    try {
      const feeHistory = await this.provider.send("eth_feeHistory", [
        "0x14", // 20 blocks
        "latest",
        [25, 50, 75], // 25th, 50th, 75th percentiles
      ]);

      this.baseFeeHistory = feeHistory.baseFeePerGas.map((fee) => toBN(fee));
      this.priorityFeeHistory = feeHistory.reward.map((rewards) => rewards.map((reward) => toBN(reward)));
      this.lastUpdate = Date.now();
    } catch (error) {
      if (VERBOSE_LOGGING) {
        console.warn("Failed to update fee history:", error.message);
      }
    }
  }

  async getOptimalFees() {
    await this.updateFeeHistory();

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

    // Dynamic fee calculation based on network conditions
    const feeData = await this.provider.getFeeData();

    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      let maxFee = feeData.maxFeePerGas.mul(Math.floor(DYNAMIC_FEE_MULTIPLIER * 100)).div(100);
      let priorityFee = feeData.maxPriorityFeePerGas.mul(Math.floor(DYNAMIC_FEE_MULTIPLIER * 100)).div(100);

      // Apply safety cap
      const maxFeeCap = ethers.utils.parseUnits(MAX_FEE_CAP_GWEI.toString(), "gwei");
      if (maxFee.gt(maxFeeCap)) {
        maxFee = maxFeeCap;
        priorityFee = maxFee.div(4); // 25% of max fee as priority
      }

      return {
        type: "eip1559",
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: priorityFee,
      };
    }

    // Fallback to legacy
    let gasPrice = feeData.gasPrice || ethers.utils.parseUnits("20", "gwei");
    gasPrice = gasPrice.mul(Math.floor(DYNAMIC_FEE_MULTIPLIER * 100)).div(100);

    return { type: "legacy", gasPrice };
  }

  bumpFees(currentFees, multiplier = 1.0) {
    const bumpPercent = Math.floor(GAS_BUMP_PERCENT * multiplier);

    if (currentFees.type === "legacy") {
      return {
        type: "legacy",
        gasPrice: currentFees.gasPrice.mul(100 + bumpPercent).div(100),
      };
    }

    return {
      type: "eip1559",
      maxFeePerGas: currentFees.maxFeePerGas.mul(100 + bumpPercent).div(100),
      maxPriorityFeePerGas: currentFees.maxPriorityFeePerGas.mul(100 + bumpPercent).div(100),
    };
  }
}

// ---- Enhanced Nonce Management ----
class NonceManager {
  constructor() {
    this.walletNonces = new Map();
    this.pendingNonces = new Map();
  }

  async preloadNonces(wallets, provider) {
    if (!PRELOAD_NONCES) return;

    const promises = wallets.map(async (wallet) => {
      try {
        const address = wallet.address;
        const nonce = await this.getNonce(wallet, provider);
        this.walletNonces.set(address, nonce);
        this.pendingNonces.set(address, nonce);

        if (VERBOSE_LOGGING) {
          console.log(`[${now()}] Preloaded nonce for ${address}: ${nonce}`);
        }
      } catch (error) {
        console.warn(`Failed to preload nonce for ${wallet.address}:`, error.message);
      }
    });

    await Promise.all(promises);
  }

  async getNonce(wallet, provider) {
    if (DRY_RUN) return 0;

    const address = wallet.address;

    if (NONCE_STRATEGY === "manual") {
      if (typeof NONCE_MANUAL !== "number" || Number.isNaN(NONCE_MANUAL)) {
        throw new Error("NONCE_STRATEGY=manual requires NONCE to be set");
      }
      return NONCE_MANUAL + NONCE_OFFSET;
    }

    // Use cached nonce if available
    if (this.walletNonces.has(address)) {
      const cachedNonce = this.walletNonces.get(address);
      this.walletNonces.set(address, cachedNonce + 1);
      return cachedNonce;
    }

    const blockTag = NONCE_STRATEGY === "latest" ? "latest" : "pending";
    const nonce = await wallet.getTransactionCount(blockTag);

    this.walletNonces.set(address, nonce + 1);
    return nonce + NONCE_OFFSET;
  }

  markNonceUsed(address, nonce) {
    this.pendingNonces.set(address, Math.max(this.pendingNonces.get(address) || 0, nonce + 1));
  }
}

// ---- Enhanced Mempool Monitoring ----
class MempoolMonitor {
  constructor(provider) {
    this.provider = provider;
    this.pendingTxs = new Map();
    this.gasTracker = new Map();
    this.isMonitoring = false;
  }

  async startMonitoring() {
    if (!MEMPOOL_MONITORING || this.isMonitoring) return;

    this.isMonitoring = true;

    this.provider.on("pending", (txHash) => {
      this.trackPendingTx(txHash);
    });

    if (VERBOSE_LOGGING) {
      console.log(`[${now()}] Started mempool monitoring`);
    }
  }

  async trackPendingTx(txHash) {
    try {
      const tx = await this.provider.getTransaction(txHash);
      if (tx && tx.to === CONTRACT_ADDRESS) {
        this.pendingTxs.set(txHash, {
          gasPrice: tx.gasPrice,
          maxFeePerGas: tx.maxFeePerGas,
          timestamp: Date.now(),
        });

        if (VERBOSE_LOGGING) {
          console.log(`[${now()}] Detected competing mint tx: ${txHash}`);
        }
      }
    } catch (error) {
      // Ignore errors in mempool monitoring
    }
  }

  getCompetingGasPrices() {
    const recent = Array.from(this.pendingTxs.values())
      .filter((tx) => Date.now() - tx.timestamp < 30000) // Last 30 seconds
      .map((tx) => tx.gasPrice || tx.maxFeePerGas)
      .filter(Boolean);

    if (recent.length === 0) return null;

    // Return 75th percentile of competing gas prices
    recent.sort((a, b) => (a.sub(b).lt(0) ? -1 : 1));
    const index = Math.floor(recent.length * 0.75);
    return recent[index];
  }

  stopMonitoring() {
    if (this.isMonitoring) {
      this.provider.removeAllListeners("pending");
      this.isMonitoring = false;
    }
  }
}

// Initialize enhanced components
let enhancedProvider;
let gasManager;
let nonceManager;
let mempoolMonitor;

// ---- Enhanced Utility Functions ----
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
  return [`function ${MINT_FUNC}(uint256 _count) payable`];
}

function getEnhancedRpcUrls() {
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
  const add = (u) => {
    if (u && !urls.includes(u)) urls.push(u);
  };

  switch (chain) {
    case "ethereum":
    case "eth":
      if (ALCHEMY_KEY) add(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`);
      if (INFURA_KEY) add(`https://mainnet.infura.io/v3/${INFURA_KEY}`);
      if (QUICKNODE_KEY) add(`https://eth-mainnet.g.quicknode.com/v1/${QUICKNODE_KEY}`);
      if (ANKR_KEY) add(`https://rpc.ankr.com/eth/${ANKR_KEY}`);
      add("https://1rpc.io/eth");
      add("https://eth.llamarpc.com");
      add("https://rpc.flashbots.net");
      add("https://ethereum.publicnode.com");
      break;
    case "base":
      if (ALCHEMY_KEY) add(`https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`);
      if (QUICKNODE_KEY) add(`https://base-mainnet.g.quicknode.com/v1/${QUICKNODE_KEY}`);
      add("https://mainnet.base.org");
      add("https://1rpc.io/base");
      add("https://base.llamarpc.com");
      break;
    case "arbitrum":
    case "arb":
      if (ALCHEMY_KEY) add(`https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`);
      if (QUICKNODE_KEY) add(`https://arb-mainnet.g.quicknode.com/v1/${QUICKNODE_KEY}`);
      add("https://arb1.arbitrum.io/rpc");
      add("https://1rpc.io/arb");
      add("https://arbitrum.llamarpc.com");
      break;
    default:
      break;
  }
  return urls;
}

async function enhancedPreflight(provider) {
  const network = await provider.getNetwork();
  console.log(`[${now()}] 🚀 Connected to chainId=${network.chainId}`);

  const code = await provider.getCode(CONTRACT_ADDRESS);
  if (!code || code === "0x") {
    throw new Error(`No contract code at ${CONTRACT_ADDRESS}`);
  }

  // Enhanced balance checks
  if (BALANCE_CHECK && !DRY_RUN) {
    const wallets = PRIVATE_KEYS.map((pk) => new ethers.Wallet(pk, provider));
    const balanceChecks = wallets.map(async (wallet) => {
      const balance = await wallet.getBalance();
      const requiredBalance = PRICE_WEI.mul(MINT_AMOUNT);

      if (balance.lt(requiredBalance)) {
        console.warn(`⚠️ Low balance for ${wallet.address}: ${ethers.utils.formatEther(balance)} ETH`);
      }

      return { address: wallet.address, balance };
    });

    const balances = await Promise.all(balanceChecks);
    if (VERBOSE_LOGGING) {
      balances.forEach(({ address, balance }) => {
        console.log(`💰 ${address}: ${ethers.utils.formatEther(balance)} ETH`);
      });
    }
  }

  console.log(`[${now()}] ✅ Preflight checks completed`);
}
async function waitUntilBlock(provider, targetBlock) {
  if (!targetBlock) return;
  console.log(`[${now()}] ⏳ Waiting for block ${targetBlock}...`);

  while (true) {
    const current = await provider.getBlockNumber();
    if (current >= targetBlock) {
      console.log(`[${now()}] 🎯 Target block ${targetBlock} reached (current: ${current})`);
      return;
    }
    await sleep(200); // Faster polling
  }
}

async function waitUntilTimestamp(targetMs) {
  if (!targetMs) return;
  console.log(`[${now()}] ⏳ Waiting until timestamp ${targetMs}...`);

  while (Date.now() < targetMs) {
    const remaining = targetMs - Date.now();
    if (remaining > 1000) {
      console.log(`[${now()}] ⏰ ${Math.ceil(remaining / 1000)}s remaining...`);
    }
    await sleep(Math.min(200, remaining));
  }

  console.log(`[${now()}] 🎯 Target timestamp reached!`);
}

async function enhancedCallStaticCheck(contract, wallet) {
  if (!CALLSTATIC_CHECK || DRY_RUN) return;

  const value = PRICE_WEI.mul(toBN(MINT_AMOUNT));
  try {
    const result = await contract.connect(wallet).callStatic[MINT_FUNC](...MINT_ARGS, { value });

    if (VERBOSE_LOGGING) {
      console.log(`[${now()}] ✅ callStatic check passed for ${wallet.address}`);
    }

    return result;
  } catch (e) {
    const reason = e?.error?.message || e?.data?.message || e?.reason || e?.message || String(e);
    throw new Error(`callStatic check failed for ${wallet.address}: ${reason}`);
  }
}

async function createEnhancedFlashbotsProvider(provider) {
  const authSigner = FLASHBOTS_AUTH_KEY ? new ethers.Wallet(FLASHBOTS_AUTH_KEY) : ethers.Wallet.createRandom();

  // Try multiple relays for redundancy
  for (const relay of FLASHBOTS_RELAYS) {
    try {
      const fbProvider = await FlashbotsBundleProvider.create(provider, authSigner, relay);
      if (VERBOSE_LOGGING) {
        console.log(`[${now()}] 🔗 Connected to Flashbots relay: ${relay}`);
      }
      return fbProvider;
    } catch (error) {
      console.warn(`Failed to connect to ${relay}:`, error.message);
    }
  }

  throw new Error("Failed to connect to any Flashbots relay");
}

async function sendViaEnhancedFlashbots(wallet, initialRequest, provider) {
  const fb = await createEnhancedFlashbotsProvider(provider);

  let attempt = 0;
  let waitMs = RETRY_BACKOFF_MS;
  let fees = await gasManager.getOptimalFees();

  // Check for competing transactions
  const competingGas = mempoolMonitor.getCompetingGasPrices();
  if (competingGas) {
    fees = gasManager.bumpFees(fees, 1.5); // More aggressive bump if competition detected
    if (VERBOSE_LOGGING) {
      console.log(`[${now()}] 🏁 Competition detected, bumping fees aggressively`);
    }
  }

  while (true) {
    const request = mergeTxFees({ ...initialRequest }, fees);
    const signed = await wallet.signTransaction(request);
    const txHash = ethers.utils.keccak256(signed);

    const currentBlock = await provider.getBlockNumber();
    const targetBlock = currentBlock + 1;

    try {
      // Simulate bundle
      const sim = await fb.simulate([{ signedTransaction: signed }], targetBlock);
      if (sim.error) {
        throw new Error(`Simulation failed: ${sim.error.message || String(sim.error)}`);
      }

      if (VERBOSE_LOGGING && sim.results?.[0]) {
        console.log(`[${now()}] 📊 Simulation successful - Gas used: ${sim.results[0].gasUsed}`);
      }

      // Submit bundle
      const submit = await fb.sendRawBundle([{ signedTransaction: signed }], targetBlock);

      // Wait for inclusion with timeout
      const waitPromise = submit.wait();
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Bundle wait timeout")), 15000));

      const res = await Promise.race([waitPromise, timeoutPromise]);

      if (res === FlashbotsBundleResolution.BundleIncluded) {
        console.log(`[${now()}] 🎉 Flashbots bundle included: ${txHash} at block ${targetBlock}`);

        // Update performance stats
        perfStats.txSent++;
        perfStats.txConfirmed++;

        const receipt = await provider.waitForTransaction(txHash);
        perfStats.gasUsed = perfStats.gasUsed.add(receipt.gasUsed);
        perfStats.totalFees = perfStats.totalFees.add(receipt.gasUsed.mul(receipt.effectiveGasPrice));

        return receipt;
      }

      if (res === FlashbotsBundleResolution.AccountNonceTooHigh) {
        throw new Error("Nonce too high: transaction already mined or replaced");
      }

      // Bundle not included, retry with higher fees
      attempt += 1;
      console.warn(`[${now()}] ⚠️ Bundle not included (attempt ${attempt}), retrying...`);
    } catch (e) {
      attempt += 1;
      console.warn(`[${now()}] ❌ Flashbots attempt ${attempt} failed: ${e.message || e}`);
    }

    if (attempt >= RETRY_ATTEMPTS) {
      throw new Error(`Flashbots: max attempts (${RETRY_ATTEMPTS}) reached without inclusion`);
    }

    // Exponential fee bumping with competition awareness
    const bumpMultiplier = competingGas ? 1.8 : 1.2;
    fees = gasManager.bumpFees(fees, bumpMultiplier);

    if (VERBOSE_LOGGING) {
      const feeStr = fees.type === "legacy" ? `${ethers.utils.formatUnits(fees.gasPrice, "gwei")} gwei` : `${ethers.utils.formatUnits(fees.maxFeePerGas, "gwei")}/${ethers.utils.formatUnits(fees.maxPriorityFeePerGas, "gwei")} gwei`;
      console.log(`[${now()}] 📈 Bumped fees to: ${feeStr}`);
    }

    await sleep(waitMs);
    waitMs = Math.ceil(waitMs * RETRY_BACKOFF_MULTIPLIER);
  }
}

async function estimateGasWithEnhancedBuffer(contract, args, overrides) {
  try {
    if (DRY_RUN) return undefined;
    if (GAS_LIMIT) return GAS_LIMIT;

    // Try multiple estimation methods for accuracy
    const estimationMethods = [
      () => contract.estimateGas[MINT_FUNC](...args, overrides),
      () =>
        contract.provider.estimateGas({
          to: contract.address,
          data: contract.interface.encodeFunctionData(MINT_FUNC, args),
          value: overrides.value,
        }),
    ];

    let bestEstimate;
    for (const method of estimationMethods) {
      try {
        const estimate = await method();
        if (!bestEstimate || estimate.gt(bestEstimate)) {
          bestEstimate = estimate;
        }
      } catch (e) {
        if (VERBOSE_LOGGING) {
          console.warn("Gas estimation method failed:", e.message);
        }
      }
    }

    if (!bestEstimate) {
      throw new Error("All gas estimation methods failed");
    }

    // Apply enhanced buffer
    const buffered = bestEstimate.mul(100 + GAS_LIMIT_BUFFER_PERCENT).div(100);

    if (VERBOSE_LOGGING) {
      console.log(`[${now()}] ⛽ Gas estimate: ${bestEstimate.toString()} → ${buffered.toString()} (+${GAS_LIMIT_BUFFER_PERCENT}%)`);
    }

    return buffered;
  } catch (e) {
    if (GAS_LIMIT) {
      console.warn("Gas estimation failed, using manual limit:", e.message);
      return GAS_LIMIT;
    }
    console.warn("Gas estimation failed, proceeding without explicit gasLimit:", e.message);
    return undefined;
  }
}

function mergeTxFees(base, fees) {
  if (!fees) return base;
  if (fees.type === "legacy") return { ...base, gasPrice: fees.gasPrice };
  return { ...base, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
}

async function buildEnhancedMintRequest(wallet, contract, provider, fees) {
  const value = PRICE_WEI.mul(toBN(MINT_AMOUNT));
  const feeFields = fees?.type === "legacy" ? { gasPrice: fees.gasPrice } : { maxFeePerGas: fees?.maxFeePerGas, maxPriorityFeePerGas: fees?.maxPriorityFeePerGas };

  const populated = await contract.populateTransaction[MINT_FUNC](...MINT_ARGS, { value });
  const gasLimit = await estimateGasWithEnhancedBuffer(contract, MINT_ARGS, { value, ...feeFields });
  const nonce = await nonceManager.getNonce(wallet, provider);

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

async function sendWithEnhancedReplacement(wallet, initialRequest, provider) {
  let attempt = 0;
  let waitMs = RETRY_BACKOFF_MS;
  let fees = await gasManager.getOptimalFees();

  // Check mempool competition
  const competingGas = mempoolMonitor.getCompetingGasPrices();
  if (competingGas && competingGas.gt(fees.gasPrice || fees.maxFeePerGas)) {
    fees = gasManager.bumpFees(fees, 1.3);
    if (VERBOSE_LOGGING) {
      console.log(`[${now()}] 🏁 Adjusting fees based on mempool competition`);
    }
  }

  let request = mergeTxFees(initialRequest, fees);

  // Optional: align to next block for fair ordering
  if (WAIT_NEXT_BLOCK) {
    const current = await provider.getBlockNumber();
    console.log(`[${now()}] ⏳ Waiting for next block (current: ${current})...`);

    await new Promise((resolve) => {
      const handler = (blockNumber) => {
        if (blockNumber >= current + 1) {
          provider.off("block", handler);
          console.log(`[${now()}] 🎯 Next block reached: ${blockNumber}`);
          resolve();
        }
      };
      provider.on("block", handler);
    });
  }

  const startTime = Date.now();

  while (true) {
    try {
      perfStats.txSent++;

      const tx = await wallet.sendTransaction(request);
      console.log(`[${now()}] 🚀 Tx sent: ${tx.hash} (attempt ${attempt + 1}, nonce ${tx.nonce})`);

      if (VERBOSE_LOGGING) {
        const feeStr = tx.gasPrice ? `${ethers.utils.formatUnits(tx.gasPrice, "gwei")} gwei` : `${ethers.utils.formatUnits(tx.maxFeePerGas, "gwei")}/${ethers.utils.formatUnits(tx.maxPriorityFeePerGas, "gwei")} gwei`;
        console.log(`[${now()}] 💰 Fee: ${feeStr}, Gas limit: ${tx.gasLimit?.toString()}`);
      }

      const receipt = await tx.wait();
      const confirmTime = Date.now() - startTime;

      // Update performance stats
      perfStats.txConfirmed++;
      perfStats.gasUsed = perfStats.gasUsed.add(receipt.gasUsed);
      perfStats.totalFees = perfStats.totalFees.add(receipt.gasUsed.mul(receipt.effectiveGasPrice));
      perfStats.avgConfirmTime = (perfStats.avgConfirmTime + confirmTime) / 2;

      console.log(`[${now()}] ✅ Confirmed: ${receipt.transactionHash} in block ${receipt.blockNumber} (${confirmTime}ms)`);

      if (VERBOSE_LOGGING) {
        console.log(`[${now()}] ⛽ Gas used: ${receipt.gasUsed.toString()}, Effective price: ${ethers.utils.formatUnits(receipt.effectiveGasPrice, "gwei")} gwei`);
      }

      // Mark nonce as used
      nonceManager.markNonceUsed(wallet.address, tx.nonce);

      return receipt;
    } catch (err) {
      attempt += 1;
      const message = err?.message || String(err);
      console.warn(`[${now()}] ❌ Attempt ${attempt} failed: ${message}`);

      if (attempt >= RETRY_ATTEMPTS) {
        console.error(`[${now()}] 💀 Max attempts (${RETRY_ATTEMPTS}) reached for ${wallet.address}`);
        throw err;
      }

      // Enhanced fee bumping strategy
      const bumpMultiplier = attempt > 3 ? 2.0 : 1.5; // More aggressive after 3 attempts
      fees = gasManager.bumpFees(fees, bumpMultiplier);
      request = mergeTxFees({ ...request }, fees);

      if (VERBOSE_LOGGING) {
        const feeStr = fees.type === "legacy" ? `${ethers.utils.formatUnits(fees.gasPrice, "gwei")} gwei` : `${ethers.utils.formatUnits(fees.maxFeePerGas, "gwei")}/${ethers.utils.formatUnits(fees.maxPriorityFeePerGas, "gwei")} gwei`;
        console.log(`[${now()}] 📈 Bumped fees to: ${feeStr}`);
      }

      console.log(`[${now()}] ⏳ Retrying in ${waitMs}ms...`);
      await sleep(waitMs);
      waitMs = Math.ceil(waitMs * RETRY_BACKOFF_MULTIPLIER);
    }
  }
}

async function enhancedMintOnce(wallet, contract, provider) {
  try {
    await enhancedCallStaticCheck(contract, wallet);
    const initialRequest = await buildEnhancedMintRequest(wallet, contract, provider);

    if (DRY_RUN) {
      console.log(`[${now()}] 🧪 DRY_RUN for ${wallet.address}:`);
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
      return await sendViaEnhancedFlashbots(wallet, initialRequest, provider);
    }

    return await sendWithEnhancedReplacement(wallet, initialRequest, provider);
  } catch (error) {
    console.error(`[${now()}] ❌ Enhanced mint failed for ${wallet.address}:`, error.message);
    throw error;
  }
}

async function runEnhancedSingle(provider) {
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const abi = buildAbi();
  const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);

  console.log(`[${now()}] 🎯 Starting single wallet mint: ${wallet.address}`);
  await enhancedMintOnce(wallet, contract, provider);
}

async function runEnhancedMulti(provider) {
  const abi = buildAbi();
  const wallets = PRIVATE_KEYS.map((pk) => new ethers.Wallet(pk, provider));

  console.log(`[${now()}] 🎯 Starting multi wallet mint: ${wallets.length} wallets`);

  if (MODE === "multi") {
    // Sequential execution with enhanced timing
    for (let i = 0; i < wallets.length; i++) {
      const wallet = wallets[i];
      try {
        console.log(`[${now()}] 🔄 Processing wallet ${i + 1}/${wallets.length}: ${wallet.address}`);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);
        await enhancedMintOnce(wallet, contract, provider);
      } catch (e) {
        console.error(`[${now()}] ❌ Wallet ${wallet.address} failed:`, e.message);
      }

      // Enhanced delay with jitter
      if (i < wallets.length - 1) {
        const delay = TX_DELAY_MS + Math.floor(Math.random() * JITTER_MS);
        if (delay > 0) {
          console.log(`[${now()}] ⏳ Delay: ${delay}ms`);
          await sleep(delay);
        }
      }
    }
  } else if (MODE === "multi_parallel") {
    // Enhanced parallel execution with better concurrency control
    const queue = [...wallets];
    let active = 0;
    const errors = [];
    const results = [];

    console.log(`[${now()}] 🚀 Starting parallel execution with concurrency: ${CONCURRENCY}`);

    await new Promise((resolve) => {
      const processNext = () => {
        if (queue.length === 0 && active === 0) {
          return resolve();
        }

        while (active < CONCURRENCY && queue.length > 0) {
          const wallet = queue.shift();
          active++;

          const jitter = Math.floor(Math.random() * JITTER_MS);

          (async () => {
            try {
              if (jitter > 0) await sleep(jitter);

              console.log(`[${now()}] 🔄 Processing ${wallet.address} (${active} active, ${queue.length} queued)`);
              const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);
              const result = await enhancedMintOnce(wallet, contract, provider);
              results.push({ wallet: wallet.address, result });
            } catch (e) {
              errors.push({ wallet: wallet.address, error: e });
              console.error(`[${now()}] ❌ Wallet ${wallet.address} failed:`, e.message);
            } finally {
              active--;
              processNext();
            }
          })();
        }
      };

      processNext();
    });

    // Report results
    console.log(`[${now()}] 📊 Parallel execution completed:`);
    console.log(`  ✅ Successful: ${results.length}`);
    console.log(`  ❌ Failed: ${errors.length}`);

    if (errors.length > 0 && VERBOSE_LOGGING) {
      errors.forEach(({ wallet, error }) => {
        console.log(`    ${wallet}: ${error.message}`);
      });
    }
  }
}

function printPerformanceStats() {
  const runtime = Date.now() - perfStats.startTime;
  const successRate = perfStats.txSent > 0 ? ((perfStats.txConfirmed / perfStats.txSent) * 100).toFixed(1) : 0;

  console.log(`\n[${now()}] 📊 Performance Summary:`);
  console.log(`  ⏱️  Runtime: ${runtime}ms`);
  console.log(`  📤 Transactions sent: ${perfStats.txSent}`);
  console.log(`  ✅ Transactions confirmed: ${perfStats.txConfirmed}`);
  console.log(`  📈 Success rate: ${successRate}%`);

  if (perfStats.txConfirmed > 0) {
    console.log(`  ⛽ Total gas used: ${perfStats.gasUsed.toString()}`);
    console.log(`  💰 Total fees paid: ${ethers.utils.formatEther(perfStats.totalFees)} ETH`);
    console.log(`  ⚡ Avg confirmation time: ${Math.round(perfStats.avgConfirmTime)}ms`);
  }
}

async function main() {
  console.log(`[${now()}] 🚀 Starting Enhanced Mint Bot v2.0`);
  console.log(`[${now()}] 🎯 Mode: ${MODE.toUpperCase()}`);
  console.log(`[${now()}] 📋 Contract: ${CONTRACT_ADDRESS}`);
  console.log(`[${now()}] 🔧 Submit mode: ${SUBMIT_MODE.toUpperCase()}`);

  if (!CONTRACT_ADDRESS) {
    throw new Error("CONTRACT_ADDRESS is required");
  }

  // Initialize enhanced components
  const rpcUrls = getEnhancedRpcUrls();
  enhancedProvider = new EnhancedProvider(rpcUrls, PRIORITY_RPC);

  const provider = DRY_RUN ? null : await enhancedProvider.getProvider();

  if (!DRY_RUN) {
    gasManager = new GasManager(provider);
    nonceManager = new NonceManager();
    mempoolMonitor = new MempoolMonitor(provider);

    await enhancedPreflight(provider);

    // Start mempool monitoring
    await mempoolMonitor.startMonitoring();

    // Preload nonces for better performance
    const wallets = MODE === "single" ? [new ethers.Wallet(process.env.PRIVATE_KEY, provider)] : PRIVATE_KEYS.map((pk) => new ethers.Wallet(pk, provider));

    await nonceManager.preloadNonces(wallets, provider);

    // Wait for scheduled start
    if (START_AT_TIMESTAMP) {
      await waitUntilTimestamp(START_AT_TIMESTAMP);
    }
    if (START_AT_BLOCK) {
      await waitUntilBlock(provider, START_AT_BLOCK);
    }
  }

  try {
    if (MODE === "single") {
      await runEnhancedSingle(provider);
    } else {
      await runEnhancedMulti(provider);
    }
  } finally {
    // Cleanup
    if (mempoolMonitor) {
      mempoolMonitor.stopMonitoring();
    }

    // Print performance stats
    printPerformanceStats();
  }

  console.log(`[${now()}] 🎉 Enhanced Mint Bot completed successfully!`);
}

// Enhanced error handling
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  printPerformanceStats();
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  printPerformanceStats();
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[SIGINT] Graceful shutdown...");
  if (mempoolMonitor) {
    mempoolMonitor.stopMonitoring();
  }
  printPerformanceStats();
  process.exit(0);
});

main().catch((e) => {
  console.error(`[${now()}] 💀 Fatal error:`, e?.message || e);
  printPerformanceStats();
  process.exit(1);
});
