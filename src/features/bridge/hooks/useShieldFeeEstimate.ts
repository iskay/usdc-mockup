import { useEffect, useState } from 'react'
import BigNumber from 'bignumber.js'
import { getNAMAddressFromRegistry, getUSDCAddressFromRegistry } from '../../../utils/namadaBalance'
import { estimateGasForToken } from '../utils/gas'

export function useShieldFeeEstimate(isReady: boolean, sdk: any, transparentAddress?: string | null) {
  const [shieldFeeUsdc, setShieldFeeUsdc] = useState<string | null>(null)
  const [shieldFeeNam, setShieldFeeNam] = useState<string | null>(null)

  useEffect(() => {
    const run = async () => {
      try {
        if (!isReady || !sdk) { setShieldFeeUsdc(null); setShieldFeeNam(null); return }
        const usdcToken = await getUSDCAddressFromRegistry()
        const namAddr = await getNAMAddressFromRegistry()
        const gasTokenCandidate = usdcToken || namAddr || (import.meta.env.VITE_NAMADA_NAM_TOKEN as string)

        const transparent = transparentAddress
        const publicKey = transparent ? (await (sdk as any).rpc.queryPublicKey(transparent)) || '' : ''
        const baseKinds = ['ShieldingTransfer']
        const txKinds = publicKey ? baseKinds : ['RevealPk', ...baseKinds]
        const gas = await estimateGasForToken(gasTokenCandidate, txKinds, '50000')

        const feeInMinDenom = new BigNumber(gas.gasLimit).multipliedBy(gas.gasPriceInMinDenom)
        const isUsdcGas = gas.gasToken === usdcToken
        setShieldFeeUsdc(isUsdcGas ? `$${feeInMinDenom.toFixed(4)}` : null)
        setShieldFeeNam(!isUsdcGas ? `${feeInMinDenom.toFixed(6)} NAM` : null)
      } catch {
        setShieldFeeUsdc(null)
        setShieldFeeNam(null)
      }
    }
    run()
  }, [isReady, sdk, transparentAddress])

  return { shieldFeeUsdc, shieldFeeNam }
}


