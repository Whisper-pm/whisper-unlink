// Whisper — Global Configuration

export const CONFIG = {
  // Chains
  chains: {
    baseSepolia: {
      id: 84532,
      name: "Base Sepolia",
      rpc: "https://sepolia.base.org",
    },
    polygonAmoy: {
      id: 80002,
      name: "Polygon Amoy",
      rpc: "https://rpc-amoy.polygon.technology",
    },
  },

  // Unlink
  unlink: {
    engineUrl: "https://staging-api.unlink.xyz",
    apiKey: process.env.NEXT_PUBLIC_UNLINK_API_KEY ?? "AkzGeutvPPQULpjAiyt3Wv",
    pool: "0x647f9b99af97e4b79DD9Dd6de3b583236352f482" as `0x${string}`,
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as `0x${string}`,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`,
  },

  // CCTP V2
  cctp: {
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as `0x${string}`,
    tokenMinter: "0xb43db544E2c27092c107639Ad201b3dEfAbcF192" as `0x${string}`,
    messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as `0x${string}`,
    usdcBaseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`,
    usdcPolygonAmoy: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582" as `0x${string}`,
    domains: { baseSepolia: 6, polygonAmoy: 7 },
    iris: "https://iris-api-sandbox.circle.com",
  },

  // Polymarket
  polymarket: {
    gammaApi: "https://gamma-api.polymarket.com",
    clobApi: "https://clob.polymarket.com",
    amoy: {
      exchange: "0xdFE02Eb6733538f8Ea35D585af8DE5958AD99E40" as `0x${string}`,
      collateral: "0x9c4e1703476e875070ee25b56a58b008cfb8fa78" as `0x${string}`,
      ctf: "0x69308FB512518e39F9b16112fA8d994F4e2Bf8bB" as `0x${string}`,
    },
  },

  // World ID 4.0
  worldId: {
    appId: process.env.NEXT_PUBLIC_WORLD_APP_ID ?? "app_3d5576fc638abf077d13427e3ba4507e",
    rpId: process.env.WORLD_RP_ID ?? "rp_cd004f9bd8012e0a",
    signingKey: process.env.WORLD_SIGNING_KEY ?? "",
    action: "verify-human",
    verifyUrl: "https://developer.world.org/api/v4/verify",
  },
} as const;
