import { getEvmChain, type EvmChainConfig } from '../config/evmChains';

/**
 * Get EVM transaction explorer URL for a given chain and transaction hash
 */
export function getEvmTxUrl(chainKey: string, txHash: string): string | undefined {
  const chain = getEvmChain(chainKey);
  if (!chain) {
    console.warn('[ChainUtils] Unknown chain key:', chainKey);
    return undefined;
  }

  const base = chain.explorer.baseUrl?.replace(/\/$/, '');
  if (!base) {
    console.warn('[ChainUtils] No explorer base URL for chain:', chainKey);
    return undefined;
  }

  const txPath = chain.explorer.txPath ?? 'tx';
  return `${base}/${txPath}/${txHash}`;
}

/**
 * Get EVM address explorer URL for a given chain and address
 */
export function getEvmAddressUrl(chainKey: string, address: string): string | undefined {
  const chain = getEvmChain(chainKey);
  if (!chain) {
    console.warn('[ChainUtils] Unknown chain key:', chainKey);
    return undefined;
  }

  const base = chain.explorer.baseUrl?.replace(/\/$/, '');
  if (!base) {
    console.warn('[ChainUtils] No explorer base URL for chain:', chainKey);
    return undefined;
  }

  const addressPath = chain.explorer.addressPath ?? 'address';
  return `${base}/${addressPath}/${address}`;
}

/**
 * Get chain display name for UI
 */
export function getChainDisplayName(chainKey: string): string {
  const chain = getEvmChain(chainKey);
  return chain?.name ?? chainKey;
}

/**
 * Get chain logo URL
 */
export function getChainLogo(chainKey: string): string | undefined {
  const chain = getEvmChain(chainKey);
  return chain?.logo;
}

/**
 * Check if a chain supports gasless transactions
 */
export function isGaslessEnabled(chainKey: string): boolean {
  const chain = getEvmChain(chainKey);
  return chain?.gasless?.enabled ?? false;
}

/**
 * Get gasless configuration for a chain
 */
export function getGaslessConfig(chainKey: string): { zeroExChainId?: number; zeroExBaseUrl?: string } | undefined {
  const chain = getEvmChain(chainKey);
  return chain?.gasless;
}

/**
 * Get USDC contract address for a chain
 */
export function getUsdcAddress(chainKey: string): string | undefined {
  const chain = getEvmChain(chainKey);
  return chain?.contracts.usdc;
}

/**
 * Get TokenMessenger contract address for a chain
 */
export function getTokenMessengerAddress(chainKey: string): string | undefined {
  const chain = getEvmChain(chainKey);
  return chain?.contracts.tokenMessenger;
}

/**
 * Get MessageTransmitter contract address for a chain
 */
export function getMessageTransmitterAddress(chainKey: string): string | undefined {
  const chain = getEvmChain(chainKey);
  return chain?.contracts.messageTransmitter;
}

/**
 * Get CCTP domain for a chain
 */
export function getCctpDomain(chainKey: string): number | undefined {
  const chain = getEvmChain(chainKey);
  return chain?.cctpDomain;
}

/**
 * Get RPC URLs for a chain
 */
export function getRpcUrls(chainKey: string): string[] {
  const chain = getEvmChain(chainKey);
  return chain?.rpcUrls ?? [];
}

/**
 * Get primary RPC URL for a chain
 */
export function getPrimaryRpcUrl(chainKey: string): string | undefined {
  const urls = getRpcUrls(chainKey);
  return urls[0];
}

/**
 * Get chain ID for a chain
 */
export function getChainId(chainKey: string): number | undefined {
  const chain = getEvmChain(chainKey);
  return chain?.chainId;
}

/**
 * Get chain ID hex for a chain
 */
export function getChainIdHex(chainKey: string): string | undefined {
  const chain = getEvmChain(chainKey);
  return chain?.chainIdHex;
}

/**
 * Validate that a chain configuration is complete
 */
export function validateChainConfig(chain: EvmChainConfig): string[] {
  const errors: string[] = [];

  if (!chain.key) errors.push('Missing chain key');
  if (!chain.name) errors.push('Missing chain name');
  if (!chain.chainId) errors.push('Missing chain ID');
  if (!chain.chainIdHex) errors.push('Missing chain ID hex');
  if (!chain.rpcUrls || chain.rpcUrls.length === 0) errors.push('Missing RPC URLs');
  if (!chain.explorer?.baseUrl) errors.push('Missing explorer base URL');
  if (!chain.contracts?.usdc) errors.push('Missing USDC contract address');
  if (!chain.contracts?.tokenMessenger) errors.push('Missing TokenMessenger contract address');
  if (chain.cctpDomain === undefined) errors.push('Missing CCTP domain');

  return errors;
}

/**
 * Format stage text with chain name
 */
export function formatStageWithChain(stage: string, chainKey: string): string {
  const chainName = getChainDisplayName(chainKey);
  return stage.replace(/Sepolia/g, chainName);
}

/**
 * Switch MetaMask to the specified network
 */
export async function switchToNetwork(chainKey: string): Promise<void> {
  const chain = getEvmChain(chainKey);
  if (!chain) {
    throw new Error(`Chain configuration not found for: ${chainKey}`);
  }

  if (!window.ethereum) {
    throw new Error('MetaMask not found');
  }

  const chainIdHex = chain.chainIdHex;
  const chainId = chain.chainId;

  try {
    // Try to switch to the network
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  } catch (switchError: any) {
    // If the network doesn't exist, add it
    if (switchError.code === 4902) {
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: chainIdHex,
              chainName: chain.name,
              nativeCurrency: chain.nativeCurrency,
              rpcUrls: chain.rpcUrls,
              blockExplorerUrls: chain.explorer?.baseUrl ? [chain.explorer.baseUrl] : undefined,
            },
          ],
        });
      } catch (addError) {
        throw new Error(`Failed to add network: ${addError}`);
      }
    } else {
      throw new Error(`Failed to switch network: ${switchError.message}`);
    }
  }
}
