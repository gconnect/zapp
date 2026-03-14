const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// cUSD on Alfajores testnet
const CUSD_ALFAJORES = "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;

  console.log(`\n🚀 Deploying CeloPay contracts to ${network}`);
  console.log(`📍 Deployer: ${deployer.address}`);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`💰 Balance: ${hre.ethers.formatEther(balance)} CELO\n`);

  const deployments = { network, deployedAt: new Date().toISOString(), contracts: {} };

  // ── 1. Deploy EsusuCircle ──────────────────────────────────────────────────
  console.log("Deploying EsusuCircle...");
  const EsusuCircle = await hre.ethers.getContractFactory("EsusuCircle");
  const esusu = await EsusuCircle.deploy();
  await esusu.waitForDeployment();
  const esusuAddr = await esusu.getAddress();
  console.log(`✅ EsusuCircle deployed to: ${esusuAddr}`);

  deployments.contracts.EsusuCircle = {
    address: esusuAddr,
    abi: "EsusuCircle.json"
  };

  // ── 2. Deploy SplitPayment ────────────────────────────────────────────────
  console.log("\nDeploying SplitPayment...");
  const SplitPayment = await hre.ethers.getContractFactory("SplitPayment");
  const split = await SplitPayment.deploy();
  await split.waitForDeployment();
  const splitAddr = await split.getAddress();
  console.log(`✅ SplitPayment deployed to: ${splitAddr}`);

  deployments.contracts.SplitPayment = {
    address: splitAddr,
    abi: "SplitPayment.json"
  };

  // ── 3. Deploy CeloPayRegistry ─────────────────────────────────────────────
  console.log("\nDeploying CeloPayRegistry...");
  const CeloPayRegistry = await hre.ethers.getContractFactory("CeloPayRegistry");
  const registry = await CeloPayRegistry.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`✅ CeloPayRegistry deployed to: ${registryAddr}`);

  deployments.contracts.CeloPayRegistry = {
    address: registryAddr,
    abi: "CeloPayRegistry.json"
  };

  // ── 4. Add cUSD address ───────────────────────────────────────────────────
  deployments.cUSD = network === "alfajores" ? CUSD_ALFAJORES : "local-mock";

  // ── 5. Save deployments JSON ──────────────────────────────────────────────
  const outPath = path.join(__dirname, `../deployments/${network}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(deployments, null, 2));
  console.log(`\n📄 Deployments saved to deployments/${network}.json`);

  // ── 6. Copy ABIs for backend ──────────────────────────────────────────────
  const backendAbis = path.join(__dirname, "../../backend/abis");
  fs.mkdirSync(backendAbis, { recursive: true });

  const contracts = ["EsusuCircle", "SplitPayment", "CeloPayRegistry"];
  for (const name of contracts) {
    const artifact = await hre.artifacts.readArtifact(name);
    fs.writeFileSync(
      path.join(backendAbis, `${name}.json`),
      JSON.stringify(artifact.abi, null, 2)
    );
  }
  console.log("📦 ABIs copied to backend/abis/");

  console.log("\n🎉 Deployment complete!\n");
  console.log("Contract Addresses:");
  console.log(`  EsusuCircle:     ${esusuAddr}`);
  console.log(`  SplitPayment:    ${splitAddr}`);
  console.log(`  CeloPayRegistry: ${registryAddr}`);
  console.log(`  cUSD (Alfajores): ${CUSD_ALFAJORES}`);
  console.log("\nNext: fund your deployer wallet at https://faucet.celo.org/alfajores");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Deployment failed:", err);
    process.exit(1);
  });
