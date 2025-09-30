import { encodeFunctionData } from 'viem'

// Chain configuration for gas-less transactions
export const GASLESS_CHAIN_CONFIG = {
  'base': {
    chainId: 8453,
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    tokenMessengerAddress: '0x1682Ae6375C4E4A97e4B583BC394c861A46D8962'
  },
  'ethereum': {
    chainId: 1,
    usdcAddress: '0xA0b86a33E6441b8c4C8C0C4C0C4C0C4C0C4C0C4C', // USDC on Ethereum
    tokenMessengerAddress: '0xbd3fa81b58ba92a5413606b896'
  },
  'arbitrum': {
    chainId: 42161,
    usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    tokenMessengerAddress: '0x19330d10D9Cc8751218eaf51E8885D058642E08A'
  },
  'polygon': {
    chainId: 137,
    usdcAddress: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    tokenMessengerAddress: '0x9daF8c91AEFAE50b9c0E69629D3F6F40Dd3a5086'
  }
} as const

export type SupportedChain = keyof typeof GASLESS_CHAIN_CONFIG

export function getChainId(chain: string): number {
  const chainKey = chain as SupportedChain
  const config = GASLESS_CHAIN_CONFIG[chainKey]
  if (!config) {
    throw new Error(`Unsupported chain: ${chain}`)
  }
  return config.chainId
}

export function getUSDCAddress(chain: string): string {
  const chainKey = chain as SupportedChain
  const config = GASLESS_CHAIN_CONFIG[chainKey]
  if (!config) {
    throw new Error(`Unsupported chain: ${chain}`)
  }
  return config.usdcAddress
}

export function getTokenMessengerAddress(chain: string): string {
  const chainKey = chain as SupportedChain
  const config = GASLESS_CHAIN_CONFIG[chainKey]
  if (!config) {
    throw new Error(`Unsupported chain: ${chain}`)
  }
  return config.tokenMessengerAddress
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
  ] as const

  // Convert amount to base units (USDC has 6 decimals)
  const amountInBase = BigInt(amount) * BigInt(1e6)
  
  // Noble domain is 4
  const nobleDomain = 4
  
  // Convert Namada address to bytes32 (this would need proper conversion logic)
  // For now, using a placeholder - you'd need to implement proper address conversion
  const mintRecipient = '0x' + '00'.repeat(32) // Placeholder
  
  return encodeFunctionData({
    abi: tokenMessengerAbi,
    functionName: 'depositForBurn',
    args: [
      amountInBase,
      nobleDomain,
      mintRecipient as `0x${string}`,
      chainConfig.usdcAddress as `0x${string}`
    ]
  })
}

export function isChainSupported(chain: string): boolean {
  return chain in GASLESS_CHAIN_CONFIG
}

export function getSupportedChains(): string[] {
  return Object.keys(GASLESS_CHAIN_CONFIG)
}
