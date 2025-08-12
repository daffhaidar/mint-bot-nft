require("dotenv").config();
const { ethers } = require("ethers");

// Benchmark utility untuk testing performance
async function runBenchmark() {
  console.log("🚀 Enhanced Mint Bot Benchmark");
  console.log("================================\n");

  const RPC_URLS = (process.env.RPC_URLS || process.env.RPC_URL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (RPC_URLS.length === 0) {
    console.error("❌ No RPC URLs configured");
    return;
  }

  console.log(`🔍 Testing ${RPC_URLS.length} RPC endpoints:\n`);

  const results = [];

  for (let i = 0; i < RPC_URLS.length; i++) {
    const url = RPC_URLS[i];
    console.log(`[${i + 1}/${RPC_URLS.length}] Testing: ${url}`);

    try {
      const provider = new ethers.providers.JsonRpcProvider({
        url,
        timeout: 5000,
      });

      // Test 1: Connection speed
      const startTime = Date.now();
      const network = await provider.getNetwork();
      const connectionTime = Date.now() - startTime;

      // Test 2: Block number fetch
      const blockStart = Date.now();
      const blockNumber = await provider.getBlockNumber();
      const blockTime = Date.now() - blockStart;

      // Test 3: Gas price fetch
      const gasStart = Date.now();
      const feeData = await provider.getFeeData();
      const gasTime = Date.now() - gasStart;

      // Test 4: Multiple concurrent requests
      const concurrentStart = Date.now();
      await Promise.all([provider.getBlockNumber(), provider.getFeeData(), provider.getNetwork()]);
      const concurrentTime = Date.now() - concurrentStart;

      const result = {
        url,
        chainId: network.chainId,
        connectionTime,
        blockTime,
        gasTime,
        concurrentTime,
        blockNumber,
        gasPrice: feeData.gasPrice ? ethers.utils.formatUnits(feeData.gasPrice, "gwei") : "N/A",
        maxFee: feeData.maxFeePerGas ? ethers.utils.formatUnits(feeData.maxFeePerGas, "gwei") : "N/A",
        status: "✅ OK",
      };

      results.push(result);

      console.log(`  ✅ Chain ID: ${network.chainId}`);
      console.log(`  ⏱️  Connection: ${connectionTime}ms`);
      console.log(`  📊 Block fetch: ${blockTime}ms`);
      console.log(`  ⛽ Gas fetch: ${gasTime}ms`);
      console.log(`  🔄 Concurrent: ${concurrentTime}ms`);
      console.log(`  📈 Block: ${blockNumber}`);
      console.log(`  💰 Gas: ${result.gasPrice} gwei\n`);
    } catch (error) {
      const result = {
        url,
        status: `❌ ${error.message}`,
        error: error.message,
      };
      results.push(result);
      console.log(`  ❌ Error: ${error.message}\n`);
    }
  }

  // Summary
  console.log("📊 BENCHMARK SUMMARY");
  console.log("===================\n");

  const workingRPCs = results.filter((r) => r.status === "✅ OK");
  const failedRPCs = results.filter((r) => r.status !== "✅ OK");

  console.log(`✅ Working RPCs: ${workingRPCs.length}/${results.length}`);
  console.log(`❌ Failed RPCs: ${failedRPCs.length}/${results.length}\n`);

  if (workingRPCs.length > 0) {
    // Sort by performance (connection time + block time)
    workingRPCs.sort((a, b) => a.connectionTime + a.blockTime - (b.connectionTime + b.blockTime));

    console.log("🏆 PERFORMANCE RANKING:");
    workingRPCs.forEach((rpc, index) => {
      const totalTime = rpc.connectionTime + rpc.blockTime + rpc.gasTime;
      console.log(`${index + 1}. ${rpc.url}`);
      console.log(`   Total: ${totalTime}ms | Conn: ${rpc.connectionTime}ms | Block: ${rpc.blockTime}ms | Gas: ${rpc.gasTime}ms`);
    });

    console.log("\n💡 RECOMMENDATIONS:");
    console.log(`🥇 Fastest RPC: ${workingRPCs[0].url}`);
    console.log(`   Use as PRIORITY_RPC for best performance`);

    if (workingRPCs.length > 1) {
      const top3 = workingRPCs
        .slice(0, 3)
        .map((r) => r.url)
        .join(",");
      console.log(`🔄 Top 3 for RPC_URLS: ${top3}`);
    }

    // Gas price analysis
    const gasPrices = workingRPCs.filter((r) => r.gasPrice !== "N/A").map((r) => parseFloat(r.gasPrice));

    if (gasPrices.length > 0) {
      const avgGas = gasPrices.reduce((a, b) => a + b, 0) / gasPrices.length;
      const minGas = Math.min(...gasPrices);
      const maxGas = Math.max(...gasPrices);

      console.log(`\n⛽ GAS PRICE ANALYSIS:`);
      console.log(`   Average: ${avgGas.toFixed(2)} gwei`);
      console.log(`   Range: ${minGas.toFixed(2)} - ${maxGas.toFixed(2)} gwei`);

      if (maxGas - minGas > 5) {
        console.log(`   ⚠️  High variance detected - consider using fastest RPC for consistency`);
      }
    }
  }

  if (failedRPCs.length > 0) {
    console.log("\n❌ FAILED RPCs:");
    failedRPCs.forEach((rpc) => {
      console.log(`   ${rpc.url}: ${rpc.error}`);
    });
  }

  // Configuration suggestions
  console.log("\n🔧 SUGGESTED .ENV CONFIGURATION:");
  if (workingRPCs.length > 0) {
    console.log(`PRIORITY_RPC=${workingRPCs[0].url}`);
    if (workingRPCs.length > 1) {
      const topRPCs = workingRPCs.slice(0, Math.min(5, workingRPCs.length)).map((r) => r.url);
      console.log(`RPC_URLS=${topRPCs.join(",")}`);
    }
    console.log(`RPC_TIMEOUT_MS=3000`);
    console.log(`RPC_RETRY_COUNT=3`);
  }
}

// Network stress test
async function stressTest() {
  console.log("\n🔥 STRESS TEST");
  console.log("==============\n");

  const RPC_URL = process.env.PRIORITY_RPC || process.env.RPC_URL;
  if (!RPC_URL) {
    console.error("❌ No RPC URL configured for stress test");
    return;
  }

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const concurrency = 10;
  const iterations = 5;

  console.log(`🎯 Testing ${RPC_URL} with ${concurrency} concurrent requests x ${iterations} iterations\n`);

  const results = [];

  for (let i = 0; i < iterations; i++) {
    console.log(`Iteration ${i + 1}/${iterations}...`);

    const startTime = Date.now();
    const promises = Array(concurrency)
      .fill()
      .map(async () => {
        const reqStart = Date.now();
        try {
          await provider.getBlockNumber();
          return Date.now() - reqStart;
        } catch (error) {
          return -1; // Error
        }
      });

    const times = await Promise.all(promises);
    const totalTime = Date.now() - startTime;
    const successful = times.filter((t) => t > 0);
    const failed = times.filter((t) => t < 0).length;

    results.push({
      iteration: i + 1,
      totalTime,
      successful: successful.length,
      failed,
      avgTime: successful.length > 0 ? successful.reduce((a, b) => a + b, 0) / successful.length : 0,
      minTime: successful.length > 0 ? Math.min(...successful) : 0,
      maxTime: successful.length > 0 ? Math.max(...successful) : 0,
    });

    console.log(`  ✅ Success: ${successful.length}/${concurrency} | Avg: ${results[i].avgTime.toFixed(0)}ms | Total: ${totalTime}ms`);
  }

  // Stress test summary
  const totalSuccess = results.reduce((sum, r) => sum + r.successful, 0);
  const totalRequests = iterations * concurrency;
  const successRate = ((totalSuccess / totalRequests) * 100).toFixed(1);
  const avgResponseTime = results.reduce((sum, r) => sum + r.avgTime, 0) / results.length;

  console.log(`\n📊 STRESS TEST RESULTS:`);
  console.log(`   Success Rate: ${successRate}% (${totalSuccess}/${totalRequests})`);
  console.log(`   Avg Response Time: ${avgResponseTime.toFixed(0)}ms`);
  console.log(`   Recommended Concurrency: ${successRate > 95 ? concurrency : Math.max(1, Math.floor(concurrency * 0.7))}`);
}

async function main() {
  await runBenchmark();
  await stressTest();

  console.log("\n🎉 Benchmark completed!");
  console.log("Use the recommendations above to optimize your .env configuration");
}

main().catch(console.error);
