import { useEffect, useState } from 'react'
import { gaslessApiService, type GaslessConfig } from '../../../services/gaslessApiService'
import { formatUsdc, formatEth } from '../../../utils/gaslessErrors'
import { getChainId, getUSDCAddress, getTokenMessengerAddress } from '../services/gaslessUtils'

export interface GaslessFeeEstimate {
  gasFeeEth: string
  swapAmountUsdc: string
  totalUsdcNeeded: string
  isLoading: boolean
  error: string | null
}

type SupportedChain = string

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

      let chainId: number
      let usdcAddress: string
      let tokenMessengerAddress: string
      
      try {
        chainId = getChainId(chain)
        usdcAddress = getUSDCAddress(chain)
        tokenMessengerAddress = getTokenMessengerAddress(chain)
      } catch {
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
          chainId: chainId,
          sellToken: usdcAddress,
          buyToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // Native ETH
          sellAmount: '100000', // 0.1 USDC sample
          taker: userAddress,
          actions: [{
            type: 'contractCall',
            target: tokenMessengerAddress,
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
