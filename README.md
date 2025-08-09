
# Mint Bot (ethers.js)

A robust NFT mint bot for Node.js using ethers.js.

— English below —

## 🇮🇩 Ringkas (Bahasa Indonesia)
- Fitur utama:
  - Single/multi-wallet (sequential/parallel)
  - Nonce replacement + gas bump (anti double-mint, cepat konfirmasi)
  - EIP-1559 & legacy gas, fallback RPC (multi RPC)
  - Estimasi gas + buffer, callStatic pre-check (anti revert)
  - Private relay Flashbots (opsional)
  - Jadwal kirim by block/waktu
  - ABI & argumen custom, DRY_RUN
- Prasyarat: Node 16+

### Setup
```powershell
npm install
copy env.example .env
# edit .env → isi RPC/CHAIN, CONTRACT_ADDRESS, PRIVATE_KEY, dll
```

### Jalankan
```powershell
npm run start:dry   # cek tanpa kirim
npm start           # kirim transaksi
```

### Variabel utama (.env)
- RPC: `RPC_URL` atau `RPC_URLS` (comma) atau `CHAIN` preset (`ethereum|eth`, `base`, `arbitrum|arb`, `optimism|op`, `polygon|matic`, `bnb|bsc`)
- Vendor keys (opsional): `INFURA_KEY`, `ALCHEMY_KEY`
- Kontrak: `CONTRACT_ADDRESS`, `MINT_FUNC`, `MINT_AMOUNT`, `MINT_PRICE`, `MINT_ARGS_JSON`, `ABI_OVERRIDE`
- Eksekusi: `MODE=single|multi|multi_parallel`, `PRIVATE_KEY` atau `PRIVATE_KEYS`
- Fee: `GAS_PRICE_GWEI` atau `MAX_FEE_GWEI`/`MAX_PRIORITY_GWEI`, `GAS_BUMP_PERCENT`
- Nonce: `NONCE_STRATEGY`, `NONCE`
- Timing: `WAIT_NEXT_BLOCK`, `START_AT_BLOCK`, `START_AT_TIMESTAMP`
- Keamanan: `CALLSTATIC_CHECK`, `DRY_RUN`
- Relay privat: `SUBMIT_MODE=public|flashbots`, `FLASHBOTS_RELAY`, `FLASHBOTS_AUTH_KEY`

### Testnet
- Silakan isi `RPC_URL`/`RPC_URLS` testnet Anda sendiri.

---

## 🇬🇧 Overview (English)
- Key features:
  - Single/multi-wallet (sequential/parallel)
  - Nonce replacement with progressive fee bump
  - EIP-1559 and legacy gas, multi-RPC fallback
  - Gas estimation with buffer, callStatic pre-check
  - Optional Flashbots private relay
  - Scheduled start by block/time
  - Custom ABI/args, DRY_RUN mode
- Requirement: Node 16+

### Setup
```bash
npm install
# Windows PowerShell
type env.example > .env  # or: copy env.example .env
# Bash
# cp env.example .env
# Edit .env → fill RPC/CHAIN, CONTRACT_ADDRESS, PRIVATE_KEY, etc.
```

### Run
```bash
npm run start:dry  # dry run (no broadcast)
npm start          # live run
```

### Core .env variables
- RPC: `RPC_URL` or `RPC_URLS` (comma) or `CHAIN` preset (`ethereum|eth`, `base`, `arbitrum|arb`, `optimism|op`, `polygon|matic`, `bnb|bsc`)
- Optional vendor keys: `INFURA_KEY`, `ALCHEMY_KEY`
- Contract: `CONTRACT_ADDRESS`, `MINT_FUNC`, `MINT_AMOUNT`, `MINT_PRICE`, `MINT_ARGS_JSON`, `ABI_OVERRIDE`
- Execution: `MODE=single|multi|multi_parallel`, `PRIVATE_KEY` or `PRIVATE_KEYS`
- Fees: `GAS_PRICE_GWEI` or `MAX_FEE_GWEI`/`MAX_PRIORITY_GWEI`, `GAS_BUMP_PERCENT`
- Nonce: `NONCE_STRATEGY`, `NONCE`
- Timing: `WAIT_NEXT_BLOCK`, `START_AT_BLOCK`, `START_AT_TIMESTAMP`
- Safety: `CALLSTATIC_CHECK`, `DRY_RUN`
- Private relay: `SUBMIT_MODE=public|flashbots`, `FLASHBOTS_RELAY`, `FLASHBOTS_AUTH_KEY`

### Testnets
- Provide your own `RPC_URL`/`RPC_URLS` for testnets. `CHAIN` presets may not exist for all testnets.

### Notes
- Default function is payable `mint(uint256)`. Use `MINT_ARGS_JSON` and `ABI_OVERRIDE` for custom signatures (e.g., WL mints).
- Nonce replacement ensures only one actual on-chain mint per wallet while retrying with higher fees.
- Fallback provider improves resilience and latency across multiple RPCs.
