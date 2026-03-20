const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;

  console.log(`\n🚀 Deploying Mock USDC to ${network}`);
  console.log(`📍 Deployer: ${deployer.address}`);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`💰 Balance: ${hre.ethers.formatEther(balance)} CELO\n`);

  console.log("Deploying MockERC20 as USDC...");
  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USDC", "USDC");
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log(`✅ USDC deployed to: ${usdcAddr}`);

  console.log("Minting 1 Billion USDC to deployer...");
  const amount = hre.ethers.parseUnits("1000000000", 18);
  const tx = await usdc.mint(deployer.address, amount);
  await tx.wait();
  console.log(`✅ Minted 1,000,000,000 USDC`);

  // Update the deployments JSON
  const outPath = path.join(__dirname, `../deployments/${network}.json`);
  let deployments = {};
  if (fs.existsSync(outPath)) {
    deployments = JSON.parse(fs.readFileSync(outPath));
  } else {
    deployments = { network, deployedAt: new Date().toISOString(), contracts: {} };
  }
  
  // Replace the cUSD address with our new mock USDC so the backend uses it by default
  deployments.cUSD = usdcAddr; 
  
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(deployments, null, 2));
  console.log(`\n📄 Added cUSD mapping to deployments/${network}.json`);

  console.log("\n🎉 Deployment complete!\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Deployment failed:", err);
    process.exit(1);
  });
