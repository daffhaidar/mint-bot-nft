require("dotenv").config();
const { ethers } = require("ethers");

// Simple gas price monitoring utility
async function monitorGasPrices() {
  const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);

  console.log("🔍 Gas Price Monitor Started");
  console.log("Press Ctrl+C to stop\n");

  const formatGwei = (wei) => ethers.utils.formatUnits(wei, "gwei");

  setInterval(async () => {
    try {
      const feeData = await provider.getFeeData();
      const block = await provider.getBlock("latest");

      console.log(`[${new Date().toISOString()}] Block: ${block.number}`);

      if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        console.log(`  EIP-1559: ${formatGwei(feeData.maxFeePerGas)} / ${formatGwei(feeData.maxPriorityFeePerGas)} gwei`);
      }

      if (feeData.gasPrice) {
        console.log(`  Legacy: ${formatGwei(feeData.gasPrice)} gwei`);
      }

      console.log(`  Base Fee: ${formatGwei(block.baseFeePerGas || 0)} gwei`);
      console.log("---");
    } catch (error) {
      console.error("Error fetching gas data:", error.message);
    }
  }, 3000);
}

monitorGasPrices().catch(console.error);
