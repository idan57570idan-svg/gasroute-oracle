import { createAgentApp, paymentsFromEnv } from "@lucid-dreams/agent-kit";
import { z } from "zod";

// ─── Chain Configuration ──────────────────────────────────────────────────────

const CHAINS = {
  ethereum: {
    chainId: 1,
    rpc: "https://eth.llamarpc.com",
    nativeToken: "ethereum",
    nativeSymbol: "ETH",
    label: "Ethereum",
  },
  polygon: {
    chainId: 137,
    rpc: "https://polygon-rpc.com",
    nativeToken: "matic-network",
    nativeSymbol: "MATIC",
    label: "Polygon",
  },
  bsc: {
    chainId: 56,
    rpc: "https://bsc-dataseed.binance.org",
    nativeToken: "binancecoin",
    nativeSymbol: "BNB",
    label: "BNB Chain",
  },
  arbitrum: {
    chainId: 42161,
    rpc: "https://arb1.arbitrum.io/rpc",
    nativeToken: "ethereum",
    nativeSymbol: "ETH",
    label: "Arbitrum One",
  },
  optimism: {
    chainId: 10,
    rpc: "https://mainnet.optimism.io",
    nativeToken: "ethereum",
    nativeSymbol: "ETH",
    label: "Optimism",
  },
  base: {
    chainId: 8453,
    rpc: "https://mainnet.base.org",
    nativeToken: "ethereum",
    nativeSymbol: "ETH",
    label: "Base",
  },
  avalanche: {
    chainId: 43114,
    rpc: "https://api.avax.network/ext/bc/C/rpc",
    nativeToken: "avalanche-2",
    nativeSymbol: "AVAX",
    label: "Avalanche",
  },
} as const;

type ChainId = keyof typeof CHAINS;

const VALID_CHAINS = Object.keys(CHAINS) as ChainId[];

// ─── Input Schema ─────────────────────────────────────────────────────────────

const inputSchema = z.object({
  chain_set: z
    .array(z.enum(VALID_CHAINS as [ChainId, ...ChainId[]]))
    .min(1)
    .max(7)
    .default(["ethereum", "polygon", "bsc", "arbitrum", "optimism", "base"]),
  calldata_size_bytes: z
    .number()
    .int()
    .min(0)
    .max(128_000)
    .default(68),
  gas_units_est: z
    .number()
    .int()
    .min(21_000)
    .max(30_000_000)
    .default(100_000),
});

// ─── Gas Fetching via public JSON-RPC ─────────────────────────────────────────

interface GasData {
  baseFeeGwei: number;
  maxFeeGwei: number;
  priorityFeeGwei: number;
  pendingTxCount: number | null;
}

async function rpcCall(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const { result, error } = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (error) throw new Error(`RPC error: ${error.message}`);
  return result;
}

function hexToGwei(hex: string): number {
  return Number(BigInt(hex)) / 1e9;
}

async function fetchGasData(rpc: string): Promise<GasData> {
  // Try EIP-1559 fee history first
  const feeHistory = await rpcCall(rpc, "eth_feeHistory", [4, "latest", [50]]).catch(() => null) as {
    baseFeePerGas: string[];
    reward: string[][];
  } | null;

  if (feeHistory?.baseFeePerGas?.length) {
    const baseFees = feeHistory.baseFeePerGas.map(hexToGwei);
    const baseFeeGwei = baseFees[baseFees.length - 1] ?? baseFees[baseFees.length - 2] ?? 0;
    const rewards = feeHistory.reward?.map((r) => hexToGwei(r[0] ?? "0x0")) ?? [];
    const medianReward = rewards.sort((a, b) => a - b)[Math.floor(rewards.length / 2)] ?? 1.5;
    return {
      baseFeeGwei,
      maxFeeGwei: baseFeeGwei * 1.125 + medianReward,
      priorityFeeGwei: medianReward,
      pendingTxCount: null,
    };
  }

  // Fallback: legacy gasPrice
  const gasPrice = await rpcCall(rpc, "eth_gasPrice", []).catch(() => "0x0") as string;
  const gasPriceGwei = hexToGwei(gasPrice);
  return {
    baseFeeGwei: gasPriceGwei * 0.9,
    maxFeeGwei: gasPriceGwei,
    priorityFeeGwei: gasPriceGwei * 0.1,
    pendingTxCount: null,
  };
}

// ─── Price Fetching via CoinGecko (no auth) ───────────────────────────────────

async function fetchPricesUSD(tokenIds: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(tokenIds)];
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${unique.join(",")}&vs_currencies=usd`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, { usd: number }>;
  const prices: Record<string, number> = {};
  for (const id of unique) {
    prices[id] = data[id]?.usd ?? 0;
  }
  return prices;
}

// ─── Congestion Classifier ────────────────────────────────────────────────────

// Approximate gwei thresholds per chain for LOW/MEDIUM/HIGH congestion
const CONGESTION_THRESHOLDS: Record<ChainId, [number, number]> = {
  ethereum:  [5,   20],
  polygon:   [30, 100],
  bsc:       [1,    5],
  arbitrum:  [0.05, 0.2],
  optimism:  [0.01, 0.1],
  base:      [0.005, 0.05],
  avalanche: [25,  80],
};

function busyLevel(chainId: ChainId, maxFeeGwei: number): "LOW" | "MEDIUM" | "HIGH" {
  const [lo, hi] = CONGESTION_THRESHOLDS[chainId];
  if (maxFeeGwei <= lo) return "LOW";
  if (maxFeeGwei <= hi) return "MEDIUM";
  return "HIGH";
}

// ─── Calldata overhead (EIP-1559 calldata cost) ───────────────────────────────

function calldataGasOverhead(calldataSizeBytes: number): number {
  // 4 gas per zero byte, 16 gas per non-zero byte (approx 50% zero)
  return Math.ceil(calldataSizeBytes * 10);
}

// ─── Agent App ────────────────────────────────────────────────────────────────

export function createGasRouteOracleApp() {
  const { app, addEntrypoint } = createAgentApp(
    {
      name: "gasroute-oracle",
      version: "0.1.0",
      description:
        "Choose cheapest chain and timing for a swap or contract call. Queries live gas prices across EVM chains and returns fee estimates in native token and USD.",
    },
    {
      payments: paymentsFromEnv({ defaultPrice: "1000" }),
    },
  );

  addEntrypoint({
    key: "estimate",
    description:
      "Return best chain and fee estimate for given gas load across selected EVM chains.",
    input: inputSchema,
    async handler({ input }) {
      const parsed = inputSchema.parse(input);
      const chainIds = parsed.chain_set as ChainId[];
      const gasUnits = parsed.gas_units_est + calldataGasOverhead(parsed.calldata_size_bytes);

      // Collect unique native token IDs
      const tokenIds = [...new Set(chainIds.map((c) => CHAINS[c].nativeToken))];

      // Fetch gas data + prices in parallel
      const [gasResults, prices] = await Promise.all([
        Promise.allSettled(
          chainIds.map(async (chainId) => {
            const chain = CHAINS[chainId];
            const gas = await fetchGasData(chain.rpc);
            return { chainId, gas };
          }),
        ),
        fetchPricesUSD(tokenIds).catch(() => ({} as Record<string, number>)),
      ]);

      // Build chain estimates
      const estimates = gasResults.flatMap((r) => {
        if (r.status === "rejected") return [];
        const { chainId, gas } = r.value;
        const chain = CHAINS[chainId];
        const tokenPriceUSD = prices[chain.nativeToken] ?? 0;
        const feeNative = (gasUnits * gas.maxFeeGwei) / 1e9;
        const feeUSD = feeNative * tokenPriceUSD;
        const busy = busyLevel(chainId, gas.maxFeeGwei);
        return [
          {
            chain: chainId,
            chain_label: chain.label,
            chain_id: chain.chainId,
            fee_native: Number(feeNative.toFixed(8)),
            fee_usd: Number(feeUSD.toFixed(4)),
            busy_level: busy,
            base_fee_gwei: Number(gas.baseFeeGwei.toFixed(4)),
            max_fee_gwei: Number(gas.maxFeeGwei.toFixed(4)),
            tip_hint: Number(gas.priorityFeeGwei.toFixed(4)),
            native_symbol: chain.nativeSymbol,
            gas_used: gasUnits,
          },
        ];
      });

      // Sort by fee_usd ascending
      estimates.sort((a, b) => a.fee_usd - b.fee_usd);

      const best = estimates[0] ?? null;

      return {
        output: {
          recommended_chain: best?.chain ?? null,
          chain: best?.chain ?? null,
          fee_native: best?.fee_native ?? null,
          fee_usd: best?.fee_usd ?? null,
          busy_level: best?.busy_level ?? null,
          tip_hint: best?.tip_hint ?? null,
          all_chains: estimates,
          inputs_used: {
            calldata_size_bytes: parsed.calldata_size_bytes,
            gas_units_est: parsed.gas_units_est,
            effective_gas_units: gasUnits,
          },
        },
        usage: {
          total_tokens: estimates.length * 10,
        },
      };
    },
  });

  return app;
}

const app = createGasRouteOracleApp();
export default app;
