import BigNumber from 'bignumber.js'
import { fetchGasEstimateForKinds, fetchGasPriceForTokenAddress } from '../../../utils/indexer'
import { getNAMAddressFromRegistry } from '../../../utils/namadaBalance'
import type { GasConfig as ShieldGasConfig } from '../../../utils/txShield'

export const estimateGasForToken = async (
  candidateToken: string,
  txKinds: string[],
  fallbackGasLimit: string = '50000'
): Promise<ShieldGasConfig> => {
  let selectedGasToken = candidateToken
  try {
    const validity = await fetchGasPriceForTokenAddress(candidateToken)
    if (!validity?.isValid) {
      const namAddr = await getNAMAddressFromRegistry()
      selectedGasToken = namAddr || (import.meta.env.VITE_NAMADA_NAM_TOKEN as string)
    }
  } catch {
    const namAddr = await getNAMAddressFromRegistry()
    selectedGasToken = namAddr || (import.meta.env.VITE_NAMADA_NAM_TOKEN as string)
  }

  try {
    const estimate = await fetchGasEstimateForKinds(txKinds)
    const gasLimit = new BigNumber(estimate?.avg ?? fallbackGasLimit)
    const gasPriceInMinDenom = new BigNumber('0.000001')
    return {
      gasToken: selectedGasToken,
      gasLimit,
      gasPriceInMinDenom,
    }
  } catch (e) {
    console.warn('[Gas Estimation] Failed, using fallback defaults', e)
    return {
      gasToken: selectedGasToken,
      gasLimit: new BigNumber(fallbackGasLimit),
      gasPriceInMinDenom: new BigNumber('0.000001'),
    }
  }
}


