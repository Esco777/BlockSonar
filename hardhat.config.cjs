require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("dotenv").config();

const path = require("node:path");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// Use the pinned npm compiler so tests do not download an unpinned binary.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }, _hre, runSuper) => {
  if (solcVersion !== "0.8.26") return runSuper();

  return {
    compilerPath: require.resolve("solc/soljson.js"),
    isSolcJs: true,
    version: solcVersion,
    longVersion: require("solc").version()
  };
});

const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

if (privateKey && !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("DEPLOYER_PRIVATE_KEY must be a 0x-prefixed 32-byte key");
}

const accounts = privateKey
  ? [privateKey]
  : [];

function rpcUrl(name, value) {
  try {
    if (["http:", "https:"].includes(new URL(value).protocol)) return value;
  } catch {
    // Show the setting name without exposing its value.
  }

  throw new Error(`${name} must be an HTTP(S) RPC URL`);
}

const forkUrl = process.env.HARDHAT_FORK_RPC_URL?.trim();
const forkBlock = process.env.HARDHAT_FORK_BLOCK_NUMBER?.trim();

if (forkBlock && (!forkUrl || !/^\d+$/.test(forkBlock) || !Number.isSafeInteger(Number(forkBlock)))) {
  throw new Error("HARDHAT_FORK_BLOCK_NUMBER requires a fork RPC URL and a valid block number");
}

const remoteNetworks = {
  sepolia: [11155111, "SEPOLIA_RPC_URL"],
  ethereum: [1, "ETHEREUM_RPC_URL"],
  base: [8453, "BASE_RPC_URL"],
  bnb: [56, "BNB_RPC_URL"],
  bnbTestnet: [97, "BNB_TESTNET_RPC_URL"]
};

const configuredNetworks = Object.fromEntries(
  Object.entries(remoteNetworks).flatMap(([name, [chainId, setting]]) => {
    const url = process.env[setting]?.trim();
    if (!url) return [];

    return [[name, {
      url: rpcUrl(setting, url),
      chainId,
      accounts
    }]];
  })
);

module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      evmVersion: "paris"
    }
  },

  paths: {
    sources: "./contracts",
    tests: "./contracts/test",
    cache: "./.hardhat-cache",
    artifacts: "./artifacts",
    abis: path.join(__dirname, "src", "abis")
  },

  networks: {
    localhost: {
      url: rpcUrl("LOCAL_RPC_URL", process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545"),
      chainId: 31337
    },

    hardhat: {
      chainId: 31337,
      ...(forkUrl && {
        forking: {
          url: rpcUrl("HARDHAT_FORK_RPC_URL", forkUrl),
          ...(forkBlock && { blockNumber: Number(forkBlock) })
        }
      })
    },

    ...configuredNetworks
  }
};
