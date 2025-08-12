require("dotenv").config();
const { ethers } = require("ethers");

async function checkContract() {
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  const RPC_URL = process.env.RPC_URL;

  if (!CONTRACT_ADDRESS || !RPC_URL) {
    console.error("❌ CONTRACT_ADDRESS and RPC_URL must be set in .env");
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

  console.log("🔍 Contract Analysis");
  console.log(`📋 Address: ${CONTRACT_ADDRESS}`);
  console.log(`🌐 RPC: ${RPC_URL}\n`);

  try {
    // Basic contract info
    const code = await provider.getCode(CONTRACT_ADDRESS);
    if (!code || code === "0x") {
      console.error("❌ No contract found at this address");
      return;
    }

    console.log("✅ Contract exists");
    console.log(`📏 Bytecode size: ${(code.length - 2) / 2} bytes\n`);

    // Try to get contract info
    const network = await provider.getNetwork();
    console.log(`🌍 Network: ${network.name} (${network.chainId})`);

    // Check if it's a common NFT contract
    const commonSelectors = {
      "0x70a08231": "balanceOf(address)",
      "0x6352211e": "ownerOf(uint256)",
      "0xa22cb465": "setApprovalForAll(address,bool)",
      "0x42842e0e": "safeTransferFrom(address,address,uint256)",
      "0xa0712d68": "mint(uint256)", // Common mint function
      "0x40c10f19": "mint(address,uint256)",
      "0x1249c58b": "mint()",
      "0x0fcf8e5b": "publicMint(uint256)",
      "0x84bb1e42": "whitelistMint(uint256,bytes32[])",
    };

    console.log("\n🔍 Checking common function selectors:");
    for (const [selector, signature] of Object.entries(commonSelectors)) {
      try {
        const result = await provider.call({
          to: CONTRACT_ADDRESS,
          data: selector + "0".repeat(56), // Pad with zeros
        });
        console.log(`✅ ${signature}`);
      } catch (error) {
        if (error.message.includes("execution reverted")) {
          console.log(`⚠️  ${signature} (reverts - might exist but need params)`);
        } else {
          console.log(`❌ ${signature}`);
        }
      }
    }

    // Try to estimate gas for mint
    const MINT_FUNC = process.env.MINT_FUNC || "mint";
    const MINT_AMOUNT = process.env.MINT_AMOUNT || "1";
    const MINT_PRICE = process.env.MINT_PRICE || "0";

    console.log(`\n⛽ Gas estimation for ${MINT_FUNC}(${MINT_AMOUNT}):`);

    try {
      const iface = new ethers.utils.Interface([`function ${MINT_FUNC}(uint256) payable`]);
      const data = iface.encodeFunctionData(MINT_FUNC, [MINT_AMOUNT]);

      const gasEstimate = await provider.estimateGas({
        to: CONTRACT_ADDRESS,
        data: data,
        value: ethers.utils.parseEther(MINT_PRICE),
      });

      console.log(`✅ Estimated gas: ${gasEstimate.toString()}`);

      // Calculate costs at different gas prices
      const gasPrices = [20, 30, 50, 100]; // gwei
      console.log("\n💰 Cost estimates:");
      gasPrices.forEach((gwei) => {
        const cost = gasEstimate.mul(ethers.utils.parseUnits(gwei.toString(), "gwei"));
        console.log(`  ${gwei} gwei: ${ethers.utils.formatEther(cost)} ETH`);
      });
    } catch (error) {
      console.log(`❌ Gas estimation failed: ${error.message}`);
      console.log("   This might mean the mint is not active or requires different parameters");
    }
  } catch (error) {
    console.error("❌ Error analyzing contract:", error.message);
  }
}

checkContract().catch(console.error);
