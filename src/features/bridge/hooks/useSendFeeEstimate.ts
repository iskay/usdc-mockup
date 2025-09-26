import { useEffect, useState } from 'react'
import BigNumber from 'bignumber.js'
import { fetchGasEstimateIbcUnshieldingTransfer } from '../../../utils/indexer'
import { getNAMAddressFromRegistry, getUSDCAddressFromRegistry } from '../../../utils/namadaBalance'
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
        const formatted = isUSDC
          ? `$${feeInMinDenom.toFixed(4)}`
          : `${feeInMinDenom.toFixed(6)} NAM`
        setSendFeeEst(formatted)
      } catch (e) {
        setSendFeeEst(null)
      }
    }
    run()
  }, [isReady, sdk, amount, address])

  return sendFeeEst
}


