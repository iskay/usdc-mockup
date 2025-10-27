export type ExplorerConfig = {
  baseUrl: string; // e.g., https://sepolia.etherscan.io
  addressPath?: string; // default 'address'
  txPath?: string; // default 'tx'
};

export type EvmChainConfig = {
  key: string;             // 'sepolia' | 'base-sepolia' | 'arbitrum-sepolia' | 'polygon-amoy'
  name: string;            // Display name
  chainId: number;         // 11155111 etc
  chainIdHex: string;      // 0xaa36a7 etc
  cctpDomain: number;      // Circle domain id for the chain
  rpcUrls: string[];
  explorer: ExplorerConfig;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  contracts: {
    usdc: string;
    tokenMessenger: string;
    messageTransmitter?: string;
  };
  gasless?: { enabled: boolean; zeroExChainId?: number; zeroExBaseUrl?: string };
  estimatedTimes?: { deposit: string; send: string };
  logo?: string;
  testnet?: boolean;
};

// Runtime config loaded from JSON file or env
export type EvmChainsConfig = {
  chains: EvmChainConfig[];
  defaults: {
    selectedChainKey: string;
  };
};

// Built-in fallback config (used if runtime config fails to load)
export const FALLBACK_EVM_CHAINS: EvmChainConfig[] = [
  {
    key: 'sepolia',
    name: 'Sepolia',
    chainId: 11155111,
    chainIdHex: '0xaa36a7',
    cctpDomain: 0, // Circle domain for Ethereum (per Circle testnet docs)
    rpcUrls: ['https://sepolia.gateway.tenderly.co'],
    explorer: { baseUrl: 'https://sepolia.etherscan.io' },
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    contracts: {
      usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      tokenMessenger: '0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5'
    },
    gasless: { 
      enabled: false, 
      zeroExChainId: 11155111, 
      zeroExBaseUrl: 'https://api.0x.org' 
    },
    logo: '/ethereum-logo.svg',
    testnet: true,
  },
  // Add more chains here as needed
];

export const FALLBACK_DEFAULTS = {
  selectedChainKey: 'sepolia'
};

// Global config state
let evmChainsConfig: EvmChainsConfig | null = null;

/**
 * Load EVM chains configuration from runtime JSON file or use fallback
 */
export async function loadEvmChainsConfig(): Promise<EvmChainsConfig> {
  if (evmChainsConfig) {
    return evmChainsConfig;
  }

  try {
    // Try to load from runtime config URL first
    const configUrl = import.meta.env.VITE_EVM_CHAINS_CONFIG_URL;
    if (configUrl) {
      console.log('[EVMConfig] Loading from URL:', configUrl);
      const response = await fetch(configUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch config: ${response.status} ${response.statusText}`);
      }
      const config = await response.json() as EvmChainsConfig;
      
      // Validate config structure
      if (!config.chains || !Array.isArray(config.chains) || !config.defaults) {
        throw new Error('Invalid config structure');
      }
      
      evmChainsConfig = config;
      console.log('[EVMConfig] Loaded from URL:', config.chains.length, 'chains');
      return config;
    } else {
      // Try to load from local JSON file
      console.log('[EVMConfig] Loading from local file: /evm-chains.json');
      const response = await fetch('/evm-chains.json');
      if (!response.ok) {
        throw new Error(`Failed to fetch local config: ${response.status} ${response.statusText}`);
      }
      const config = await response.json() as EvmChainsConfig;
      
      // Validate config structure
      if (!config.chains || !Array.isArray(config.chains) || !config.defaults) {
        throw new Error('Invalid config structure');
      }
      
      evmChainsConfig = config;
      console.log('[EVMConfig] Loaded from local file:', config.chains.length, 'chains');
      return config;
    }
  } catch (error) {
    console.warn('[EVMConfig] Failed to load config, using fallback:', error);
  }

  // Fallback to built-in config
  evmChainsConfig = {
    chains: FALLBACK_EVM_CHAINS,
    defaults: FALLBACK_DEFAULTS
  };
  
  console.log('[EVMConfig] Using fallback config:', evmChainsConfig.chains.length, 'chains');
  return evmChainsConfig;
}

/**
 * Get the current EVM chains configuration
 */
export function getEvmChainsConfig(): EvmChainsConfig | null {
  return evmChainsConfig;
}

/**
 * Get a specific chain configuration by key
 */
export function getEvmChain(key: string): EvmChainConfig | undefined {
  const config = getEvmChainsConfig();
  return config?.chains.find(chain => chain.key === key);
}

/**
 * Get all available chain keys
 */
export function getEvmChainKeys(): string[] {
  const config = getEvmChainsConfig();
  return config?.chains.map(chain => chain.key) ?? [];
}

/**
 * Get the default selected chain key
 */
export function getDefaultEvmChainKey(): string {
  const config = getEvmChainsConfig();
  return config?.defaults.selectedChainKey ?? FALLBACK_DEFAULTS.selectedChainKey;
}
