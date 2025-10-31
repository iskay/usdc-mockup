import { ethers } from 'ethers'
import { getEvmChain } from '../../../config/evmChains'

export type SupportedChain = string

export function getChainId(chain: string): number {
  const config = getEvmChain(chain)
  console.log('[GaslessUtils] getChainId called with chain:', chain)
  console.log('[GaslessUtils] getEvmChain result:', config)
  if (!config) {
    throw new Error(`Unsupported chain: ${chain}`)
  }
  console.log('[GaslessUtils] returning chainId:', config.chainId)
  return config.chainId
}

export function getUSDCAddress(chain: string): string {
  const config = getEvmChain(chain)
  if (!config) {
    throw new Error(`Unsupported chain: ${chain}`)
  }
  return config.contracts.usdc
}

export function getTokenMessengerAddress(chain: string): string {
  const config = getEvmChain(chain)
  if (!config) {
    throw new Error(`Unsupported chain: ${chain}`)
  }
  return config.contracts.tokenMessenger
}

export function buildDepositForBurnCalldata(
  amount: string, 
  destinationAddress: string, 
  chainConfig: any
): string {
  // TokenMessenger ABI for depositForBurn
  const tokenMessengerAbi = [
    {
      name: 'depositForBurn',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'amount', type: 'uint256' },
        { name: 'destinationDomain', type: 'uint32' },
        { name: 'mintRecipient', type: 'bytes32' },
        { name: 'burnToken', type: 'address' }
      ],
      outputs: [{ name: 'messageNonce', type: 'uint64' }]
    }
  ]

  // Convert amount to base units (USDC has 6 decimals)
  const amountInBase = ethers.parseUnits(amount, 6)
  
  // Noble domain is 4
  const nobleDomain = 4
  
  // Convert Namada address to bytes32 (this would need proper conversion logic)
  // For now, using a placeholder - you'd need to implement proper address conversion
  const mintRecipient = '0x' + '00'.repeat(32) // Placeholder
  
  const iface = new ethers.Interface(tokenMessengerAbi)
  return iface.encodeFunctionData('depositForBurn', [
    amountInBase,
    nobleDomain,
    mintRecipient,
    chainConfig.usdcAddress
  ])
}

export function isChainSupported(chain: string): boolean {
  const config = getEvmChain(chain)
  return config !== undefined && config.gasless?.enabled === true
}

export function getSupportedChains(): string[] {
  // This would need to be async to get the config, but for now return empty array
  // The calling code should use the centralized chain options instead
  return []
}
