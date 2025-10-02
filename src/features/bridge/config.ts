import { getEvmChainsConfig, getDefaultEvmChainKey } from '../../config/evmChains'
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
    return [{ label: 'Sepolia', value: 'sepolia', iconUrl: '/ethereum-logo.svg' }]
  }

  return config.chains.map(chain => ({
    label: chain.name,
    value: chain.key,
    iconUrl: chain.logo || '/ethereum-logo.svg'
  }))
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


