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
        // Get real-time gas price from MetaMask
        if (!window.ethereum) throw new Error('MetaMask not available')
        const { ethers } = await import('ethers')
        const provider = new ethers.BrowserProvider(window.ethereum as any)
        const feeData = await provider.getFeeData()
        const gasPrice = (feeData.maxFeePerGas ?? feeData.gasPrice ?? 1000000000n)

        // Use realistic gas estimates based on typical USDC approve + CCTP depositForBurn
        // These are more accurate than the old fallback values and match production usage
        let approveGas = 50000n   // Typical USDC approve gas
        let burnGas = 150000n     // Typical CCTP depositForBurn gas
        
        try {
          const signer = await provider.getSigner()
          const wallet = await signer.getAddress()
          
          // Try to get precise estimates if wallet has ETH
          const USDC_ABI = ['function approve(address spender, uint256 amount) returns (bool)']
          const TOKEN_MESSENGER_ABI = ['function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) returns (uint64)']
          
          const usdc = new ethers.Contract(usdcAddress, USDC_ABI, signer)
          const largeApprovalAmount = ethers.parseUnits('1000000', 6)
          const approveTx = await usdc.approve.populateTransaction(tokenMessengerAddress, largeApprovalAmount)
          approveGas = await provider.estimateGas({ ...approveTx, from: wallet })

          const tokenMessenger = new ethers.Contract(tokenMessengerAddress, TOKEN_MESSENGER_ABI, signer)
          const burnEstimateTx = await tokenMessenger.depositForBurn.populateTransaction(1n, 4, '0x' + '00'.repeat(32), usdcAddress)
          burnGas = await provider.estimateGas({ ...burnEstimateTx, from: wallet })
          
          console.log('[Gasless] Using on-chain gas estimates:', { approveGas: approveGas.toString(), burnGas: burnGas.toString() })
        } catch (estimateError: any) {
          // If estimation fails (e.g., insufficient funds), use realistic defaults
          console.log('[Gasless] Using fallback gas estimates due to:', estimateError.code || estimateError.message)
          console.log('[Gasless] Fallback estimates:', { approveGas: approveGas.toString(), burnGas: burnGas.toString() })
        }

        // Use 1.2x buffer for safety margin
        const requiredWei = ((approveGas + burnGas) * gasPrice * 12n / 10n).toString()

        // Get price quote for USDC to ETH conversion
        const gaslessConfig: GaslessConfig = {
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

        const price = await gaslessApiService.getPrice(gaslessConfig)
        
        if (!price.liquidityAvailable) {
          throw new Error('Insufficient liquidity for gas conversion')
        }

        // Calculate how much USDC we need to sell to get required ETH
        const sampleBuyAmount = BigInt(price.buyAmount)
        const sampleSellAmount = BigInt(price.sellAmount)
        const requiredEth = BigInt(requiredWei)
        
        console.log('[Gasless] Fee calculation:', {
          gasPrice: gasPrice.toString(),
          approveGas: approveGas.toString(),
          burnGas: burnGas.toString(),
          totalGas: (approveGas + burnGas).toString(),
          requiredWei: requiredWei,
          requiredEth: (Number(requiredWei) / 1e18).toFixed(6),
          sampleSellAmount: sampleSellAmount.toString(),
          sampleBuyAmount: sampleBuyAmount.toString(),
          swapRate: (Number(sampleBuyAmount) / Number(sampleSellAmount)).toFixed(6)
        })
        
        // Calculate swap amount (no additional buffer - already included in requiredWei calculation)
        const swapAmount = (requiredEth * sampleSellAmount + (sampleBuyAmount - 1n)) / sampleBuyAmount // ceiling division
        
        console.log('[Gasless] Swap amount:', {
          swapAmountBase: swapAmount.toString(),
          swapAmountUsdc: (Number(swapAmount) / 1e6).toFixed(4)
        })
        
        const totalNeeded = BigInt(Math.floor(parseFloat(amount) * 1e6)) + swapAmount // amount in base units + swap amount

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
