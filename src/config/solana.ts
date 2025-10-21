// Solana chain configuration and CCTP program constants

export type ExplorerConfig = {
  baseUrl: string;
  addressPath?: string; // default 'address'
  txPath?: string; // default 'tx'
};

export type SolanaChainConfig = {
  key: string; // 'solana' | 'solana-testnet' | 'solana-devnet'
  name: string;
  type: 'solana';
  cluster: 'mainnet-beta' | 'testnet' | 'devnet';
  rpcUrls: string[];
  explorer: ExplorerConfig;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  contracts: {
    usdc: string; // SPL USDC mint address
    tokenMessengerMinter: string; // CCTP TokenMessengerMinter program id
    messageTransmitter: string; // CCTP MessageTransmitter program id
    tokenProgram?: string; // SPL Token program id
    associatedTokenProgram?: string; // Associated Token Account program id
  };
  cctpDomain: number; // Circle domain id for Solana (5 on mainnet)
  logo?: string;
  testnet?: boolean;
};

export const SOLANA_MAINNET: SolanaChainConfig = {
  key: 'solana',
  name: 'Solana',
  type: 'solana',
  cluster: 'mainnet-beta',
  rpcUrls: ['https://api.mainnet-beta.solana.com'],
  explorer: { baseUrl: 'https://explorer.solana.com', addressPath: 'address', txPath: 'tx' },
  nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 },
  contracts: {
    // Native USDC mint on Solana (mainnet)
    usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    // Circle CCTP V1 programs (mainnet)
    tokenMessengerMinter: 'CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3',
    messageTransmitter: 'CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd',
    // SPL programs (well-known IDs)
    tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    associatedTokenProgram: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  },
  cctpDomain: 5,
  logo: '/solana-logo.svg',
  testnet: false,
};

// Placeholder for testnet/devnet; program ids and USDC mint should be updated when available
export const SOLANA_DEVNET: SolanaChainConfig = {
  key: 'solana-devnet',
  name: 'Solana Devnet',
  type: 'solana',
  cluster: 'devnet',
  rpcUrls: ['https://api.devnet.solana.com'],
  explorer: { baseUrl: 'https://explorer.solana.com', addressPath: 'address', txPath: 'tx' },
  nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 },
  contracts: {
    usdc: '',
    tokenMessengerMinter: '',
    messageTransmitter: '',
    tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    associatedTokenProgram: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  },
  cctpDomain: 5,
  logo: '/solana-logo.svg',
  testnet: true,
};

export function getSolanaChain(key: string): SolanaChainConfig | undefined {
  switch (key) {
    case 'solana':
      return SOLANA_MAINNET;
    case 'solana-devnet':
      return SOLANA_DEVNET;
    default:
      return undefined;
  }
}


