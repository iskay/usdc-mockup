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
  let gasPriceInMinDenom = new BigNumber('0.000001') // Default for NAM
  
  try {
    const validity = await fetchGasPriceForTokenAddress(candidateToken)
    if (validity?.isValid && validity.minDenomAmount) {
      // Use the actual gas price from the indexer
      gasPriceInMinDenom = new BigNumber(validity.minDenomAmount)
    } else {
      // Fallback to NAM token
      const namAddr = await getNAMAddressFromRegistry()
      selectedGasToken = namAddr || (import.meta.env.VITE_NAMADA_NAM_TOKEN as string)
      // Get gas price for NAM token
      const namValidity = await fetchGasPriceForTokenAddress(selectedGasToken)
      if (namValidity?.isValid && namValidity.minDenomAmount) {
        gasPriceInMinDenom = new BigNumber(namValidity.minDenomAmount)
      }
    }
  } catch {
    const namAddr = await getNAMAddressFromRegistry()
    selectedGasToken = namAddr || (import.meta.env.VITE_NAMADA_NAM_TOKEN as string)
    // Keep default gas price for NAM
  }

  try {
    const estimate = await fetchGasEstimateForKinds(txKinds)
    const gasLimit = new BigNumber((estimate?.avg ?? fallbackGasLimit) * 1.5)
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
      gasPriceInMinDenom,
    }
  }
}


