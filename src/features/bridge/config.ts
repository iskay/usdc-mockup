import { getEvmChainsConfig, getDefaultEvmChainKey } from '../../config/evmChains'
import { SOLANA_MAINNET } from '../../config/solana'
import { getChainDisplayName, getChainLogo } from '../../utils/chain'

export type ChainOption = {
  label: string
  value: string
  iconUrl: string
}

// Generate chain options from EVM config
export function getChainOptions(): ChainOption[] {
  const config = getEvmChainsConfig()
  if (!config) {
    // Fallback to Sepolia if config not loaded yet
    return [
      { label: 'Sepolia', value: 'sepolia', iconUrl: '/ethereum-logo.svg' },
      { label: 'Solana', value: 'solana', iconUrl: '/solana-logo.svg' },
    ]
  }

  const evmOptions = config.chains.map(chain => ({
    label: chain.name,
    value: chain.key,
    iconUrl: chain.logo || '/ethereum-logo.svg'
  }))
  // Append Solana
  const sol = SOLANA_MAINNET
  const solOption: ChainOption = { label: sol.name, value: sol.key, iconUrl: sol.logo || '/solana-logo.svg' }
  return [...evmOptions, solOption]
}

// Get the default selected chain
export function getDefaultChain(): string {
  return getDefaultEvmChainKey()
}

// Legacy export for backward compatibility - this will be updated when config loads
export let chains = getChainOptions()

// Function to update chains when config loads
export function updateChains(newConfig: any) {
  if (newConfig) {
    chains = newConfig.chains.map((chain: any) => ({
      label: chain.name,
      value: chain.key,
      iconUrl: chain.logo || '/ethereum-logo.svg'
    }))
  }
}


