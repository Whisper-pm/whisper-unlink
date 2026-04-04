import { cookieStorage, createStorage, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";

// Reown Project ID — get yours at https://cloud.reown.com
const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "b5646c6f3a1959b1e0e85ebc36e73ec1";

export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({ storage: typeof window !== "undefined" ? cookieStorage : undefined }),
  ssr: true,
  projectId,
  networks: [baseSepolia],
  transports: {
    [baseSepolia.id]: http("https://sepolia.base.org"),
  },
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
export { projectId };
