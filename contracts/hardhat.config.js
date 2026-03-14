require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
 solidity: {
  version: "0.8.25",
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun"
  }
},
  networks: {
    hardhat: {
      chainId: 31337
    },
    "celo-sepolia": {
      url: process.env.CELO_RPC || "https://forno.celo-sepolia.celo-testnet.org",
      chainId: 11142220,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
gasPrice: "auto"
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};