import { useEffect, useState } from 'react'
import BigNumber from 'bignumber.js'
import { fetchGasEstimateIbcUnshieldingTransfer } from '../../../utils/indexer'
import { getNAMAddressFromRegistry, getUSDCAddressFromRegistry, getAssetDecimalsByDisplay } from '../../../utils/namadaBalance'
import { estimateGasForToken } from '../utils/gas'

export function useSendFeeEstimate(isReady: boolean, sdk: any, amount: string, address: string) {
  const [sendFeeEst, setSendFeeEst] = useState<string | null>(null)

  useEffect(() => {
    const run = async () => {
      try {
        if (!isReady || !sdk) return
        const usdcToken = await getUSDCAddressFromRegistry()
        const namAddr = await getNAMAddressFromRegistry()
        const gasTokenCandidate = usdcToken || namAddr || (import.meta.env.VITE_NAMADA_NAM_TOKEN as string)
        const estimate = await fetchGasEstimateIbcUnshieldingTransfer()
        const gas = await estimateGasForToken(gasTokenCandidate, ['IbcTransfer'], String(estimate.avg || 75000))
        const feeInMinDenom = new BigNumber(gas.gasLimit).multipliedBy(gas.gasPriceInMinDenom)
        const isUSDC = gas.gasToken === usdcToken
        
        // Convert from min denom to display units using correct decimal places for each token
        const tokenDisplay = isUSDC ? 'USDC' : 'NAM'
        const decimals = getAssetDecimalsByDisplay(tokenDisplay, 6)
        const feeInDisplayUnits = feeInMinDenom.dividedBy(new BigNumber(10).pow(decimals))
        
        const formatted = isUSDC
          ? `$${feeInDisplayUnits.toFixed(4)}`
          : `${feeInDisplayUnits.toFixed(6)} NAM`
        setSendFeeEst(formatted)
      } catch (e) {
        setSendFeeEst(null)
      }
    }
    run()
  }, [isReady, sdk, amount, address])

  return sendFeeEst
}


