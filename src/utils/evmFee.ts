import { ethers } from 'ethers'
import { USDC_ABI, TOKEN_MESSENGER_ABI } from './evmCctp'

export type EvmFeeEstimate = {
  approveUsd: number
  burnUsd: number
  nobleRegUsd: number
  totalUsd: number
}

export async function estimateDepositFeesUSD(params: {
  amountUsdc: string
  usdcAddress: string
  tokenMessengerAddress: string
}): Promise<EvmFeeEstimate> {
  if (!window.ethereum) throw new Error('MetaMask not available')
  try { console.info('[FeeEst] Starting EVM fee estimation', params) } catch {}
  const provider = new ethers.BrowserProvider(window.ethereum)
  let signer: ethers.Signer | null = null
  let wallet: string | null = null
  try {
    signer = await provider.getSigner()
    wallet = await signer.getAddress()
    try { console.info('[FeeEst] wallet:', wallet) } catch {}
  } catch (e) {
    try { console.warn('[FeeEst] signer not available yet; falling back to partial estimate', e) } catch {}
  }

  // Gas price (EIP-1559 aware)
  let gasPrice: bigint = 0n
  try {
    const feeData = await provider.getFeeData()
    gasPrice = (feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n)
    try { console.info('[FeeEst] feeData', { gasPrice: gasPrice.toString(), maxFeePerGas: feeData.maxFeePerGas?.toString(), maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString() }) } catch {}
  } catch (e) {
    try { console.warn('[FeeEst] getFeeData failed, trying eth_gasPrice', e) } catch {}
    try {
      const raw: string = await (provider as any).send('eth_gasPrice', [])
      gasPrice = BigInt(raw)
      try { console.info('[FeeEst] eth_gasPrice(wei):', gasPrice.toString()) } catch {}
    } catch (e2) {
      try { console.warn('[FeeEst] eth_gasPrice failed; assuming 0', e2) } catch {}
      gasPrice = 0n
    }
  }

  // 1) Approve estimate (max approve for amount)
  let approveGas = 0n
  try {
    if (signer && wallet) {
      const usdc = new ethers.Contract(params.usdcAddress, USDC_ABI, signer)
      const amountWei = ethers.parseUnits(params.amountUsdc || '0', 6)
      const approveTx = await usdc.approve.populateTransaction(params.tokenMessengerAddress, amountWei)
      const txForEst: any = { ...approveTx, from: wallet }
      if (gasPrice > 0n) {
        // Prefer legacy gasPrice for estimate if EIP-1559 fields are absent
        if (!('maxFeePerGas' in txForEst) && !('maxPriorityFeePerGas' in txForEst)) {
          txForEst.gasPrice = gasPrice
        }
      }
      approveGas = await provider.estimateGas(txForEst)
      try { console.info('[FeeEst] approveGas:', approveGas.toString()) } catch {}
    } else {
      try { console.info('[FeeEst] skipping approve gas estimate (no signer)') } catch {}
    }
  } catch (e) {
    try { console.warn('[FeeEst] approve gas estimate failed', e) } catch {}
  }

  // 2) depositForBurn estimate (rough; we cannot include dynamic mintRecipient here)
  let burnGas = 0n
  try {
    if (signer && wallet) {
      const tokenMessenger = new ethers.Contract(params.tokenMessengerAddress, TOKEN_MESSENGER_ABI, signer)
      // Dummy values for estimation; downstream UI calls use accurate execution path.
      const estimateTx = await tokenMessenger.depositForBurn.populateTransaction(
        1n, // minimal non-zero amount for estimation
        4, // noble domain default
        '0x' + '00'.repeat(32),
        params.usdcAddress
      )
      const txForEst: any = { ...estimateTx, from: wallet }
      if (gasPrice > 0n) {
        if (!('maxFeePerGas' in txForEst) && !('maxPriorityFeePerGas' in txForEst)) {
          txForEst.gasPrice = gasPrice
        }
      }
      burnGas = await provider.estimateGas(txForEst)
      try { console.info('[FeeEst] burnGas:', burnGas.toString()) } catch {}
    } else {
      try { console.info('[FeeEst] skipping burn gas estimate (no signer)') } catch {}
    }
  } catch (e) {
    try { console.warn('[FeeEst] burn gas estimate failed', e) } catch {}
  }

  // Convert to USD using Sepolia ETH price assumption via on-chain gas price and a fixed ETH price.
  // If you have a live price feed, plug it in; default $ETH= $2500.
  const assumedEthUsd = Number((import.meta as any)?.env?.VITE_ETH_USD_PRICE || 2500)
  try { console.info('[FeeEst] assumedEthUsd:', assumedEthUsd) } catch {}
  const approveUsd = Number(approveGas * gasPrice) / 1e18 * assumedEthUsd
  const burnUsd = Number(burnGas * gasPrice) / 1e18 * assumedEthUsd

  // 3) Noble registration flat fee: 20000 uusdc = $0.02
  const nobleRegUsd = 0.02

  const totalUsd = approveUsd + burnUsd + nobleRegUsd
  try { console.info('[FeeEst] computed USD', { approveUsd, burnUsd, nobleRegUsd, totalUsd }) } catch {}
  return { approveUsd, burnUsd, nobleRegUsd, totalUsd }
}


