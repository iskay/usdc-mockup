import { useEffect, useState } from 'react'
import { gaslessApiService, type GaslessConfig } from '../../../services/gaslessApiService'
import { formatUsdc, formatEth } from '../../../utils/gaslessErrors'

export interface GaslessFeeEstimate {
  gasFeeEth: string
  swapAmountUsdc: string
  totalUsdcNeeded: string
  isLoading: boolean
  error: string | null
}

// Chain configuration for gas-less transactions
const GASLESS_CHAIN_CONFIG = {
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

type SupportedChain = keyof typeof GASLESS_CHAIN_CONFIG

export function useGaslessFeeEstimate(
  chain: string, 
  amount: string, 
  enabled: boolean,
  userAddress?: string
): GaslessFeeEstimate {
  const [estimate, setEstimate] = useState<GaslessFeeEstimate>({
    gasFeeEth: '0.000000',
    swapAmountUsdc: '0.0000',
    totalUsdcNeeded: '0.0000',
    isLoading: false,
    error: null
  })

  useEffect(() => {
    const calculateEstimate = async () => {
      if (!enabled || !amount || !userAddress || !chain) {
        setEstimate({
          gasFeeEth: '0.000000',
          swapAmountUsdc: '0.0000',
          totalUsdcNeeded: '0.0000',
          isLoading: false,
          error: null
        })
        return
      }

      const chainKey = chain as SupportedChain
      const chainConfig = GASLESS_CHAIN_CONFIG[chainKey]
      
      if (!chainConfig) {
        setEstimate(prev => ({
          ...prev,
          isLoading: false,
          error: 'Unsupported chain for gas-less transactions'
        }))
        return
      }

      setEstimate(prev => ({ ...prev, isLoading: true, error: null }))

      try {
        // Calculate required ETH for gas (approve + depositForBurn with 2x buffer)
        const gasApprove = 75000n  // USDC approval gas
        const gasBurn = 200000n    // CCTP burn gas
        const gasPrice = 1000000000n // 1 gwei (conservative estimate)
        const requiredWei = ((gasApprove + gasBurn) * gasPrice * 2n).toString()

        // Get price quote for USDC to ETH conversion
        const config: GaslessConfig = {
          chainId: chainConfig.chainId,
          sellToken: chainConfig.usdcAddress,
          buyToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // Native ETH
          sellAmount: '100000', // 0.1 USDC sample
          taker: userAddress,
          actions: [{
            type: 'contractCall',
            target: chainConfig.tokenMessengerAddress,
            calldata: '0x', // Dummy calldata for estimation
            value: '0'
          }]
        }

        const price = await gaslessApiService.getPrice(config)
        
        if (!price.liquidityAvailable) {
          throw new Error('Insufficient liquidity for gas conversion')
        }

        // Calculate how much USDC we need to sell to get required ETH
        const sampleBuyAmount = BigInt(price.buyAmount)
        const sampleSellAmount = BigInt(price.sellAmount)
        const requiredEth = BigInt(requiredWei)
        
        // Calculate swap amount with some buffer
        const swapAmount = (requiredEth * sampleSellAmount * 12n) / (sampleBuyAmount * 10n) // 20% buffer
        
        const totalNeeded = BigInt(amount) * BigInt(1e6) + swapAmount // amount in base units + swap amount

        setEstimate({
          gasFeeEth: formatEth(requiredWei),
          swapAmountUsdc: formatUsdc(swapAmount.toString()),
          totalUsdcNeeded: formatUsdc(totalNeeded.toString()),
          isLoading: false,
          error: null
        })

      } catch (error: any) {
        console.error('Gas-less fee estimation failed:', error)
        setEstimate({
          gasFeeEth: '0.000000',
          swapAmountUsdc: '0.0000',
          totalUsdcNeeded: '0.0000',
          isLoading: false,
          error: error.message || 'Failed to estimate gas-less fees'
        })
      }
    }

    calculateEstimate()
  }, [chain, amount, enabled, userAddress])

  return estimate
}
