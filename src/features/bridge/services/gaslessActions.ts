import { gaslessApiService, type GaslessConfig, type GaslessQuote } from '../../../services/gaslessApiService'
import { getUserFriendlyError } from '../../../utils/gaslessErrors'
import { getChainId, getUSDCAddress, getTokenMessengerAddress } from './gaslessUtils'
import { switchToNetwork } from '../../../utils/chain'
import { loadEvmChainsConfig } from '../../../config/evmChains'
import { encodeBech32ToBytes32 } from '../../../utils/forwarding'
import { startEvmDepositAction } from './bridgeActions'
import { ethers } from 'ethers'
import { USDC_ABI, TOKEN_MESSENGER_ABI } from '../../../utils/evmCctp'

type SupportedChain = string

export interface GaslessDepositInputs {
  chain: string
  amount: string
  destinationAddress: string
  validateForm: (amount: string, balance: string, address: string) => any
  getAvailableBalance: () => string
}

type Deps = {
  sdk: any
  state: any
  dispatch: (action: any) => void
  showToast: (args: { title: string; message: string; variant: 'info' | 'warning' | 'success' | 'error'; action?: any }) => void
  getNamadaAccounts: () => Promise<readonly any[]>
}

// Fetch Noble forwarding address (same as normal flow)
async function fetchNobleForwardingAddress(destinationAddress: string): Promise<string> {
  const channelId = (import.meta as any)?.env?.VITE_NOBLE_TO_NAMADA_CHANNEL || 'channel-136'
  const lcdUrl = import.meta.env.VITE_NOBLE_LCD_URL
  if (!lcdUrl) throw new Error('VITE_NOBLE_LCD_URL not set')
  const url = `${lcdUrl}/noble/forwarding/v1/address/${channelId}/${destinationAddress}/`
  const res = await fetch(url)
  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Failed to fetch forwarding address: ${res.status} - ${errorText}`)
  }
  const data = await res.json()
  if (!data?.address) throw new Error('No forwarding address returned')
  return data.address as string
}

// Build exact TokenMessenger.depositForBurn calldata identical to normal path
function buildDepositForBurnCalldataExact(
  amountUsdc: string,
  chainKey: string,
  forwardingBytes32: string,
  destinationDomain?: number
): string {
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
  ]

  const amountWei = ethers.parseUnits(amountUsdc, 6)
  const destDomain = Number((destinationDomain ?? (import.meta as any)?.env?.VITE_NOBLE_DOMAIN_ID ?? 4))
  const usdcAddress = getUSDCAddress(chainKey)
  const iface = new ethers.Interface(tokenMessengerAbi)
  return iface.encodeFunctionData('depositForBurn', [
    amountWei,
    destDomain,
    forwardingBytes32,
    usdcAddress,
  ])
}

export async function startGaslessDepositAction(
  { sdk, state, dispatch, showToast, getNamadaAccounts }: Deps, 
  inputs: GaslessDepositInputs
) {
  const txId = `gasless_dep_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  
  try {
    // 1. Ensure EVM configuration is loaded
    await loadEvmChainsConfig()

    // 2. Validate inputs
    const validation = inputs.validateForm(inputs.amount, inputs.getAvailableBalance(), inputs.destinationAddress)
    if (!validation.isValid) {
      showToast({ title: 'Validation Error', message: validation.error || 'Invalid inputs', variant: 'error' })
      return
    }

    // 3. Check if chain is supported for gasless
    try {
      getChainId(inputs.chain)
    } catch {
      showToast({ title: 'Unsupported Chain', message: 'Gas-less transactions are not supported on this network', variant: 'error' })
      return
    }

    // 4. Create transaction with gas-less flag
    dispatch({
      type: 'ADD_TRANSACTION',
      payload: {
        id: txId,
        kind: 'deposit',
        amount: inputs.amount,
        fromChain: inputs.chain,
        toChain: 'namada',
        destination: inputs.destinationAddress,
        status: 'submitting',
        gasless: { swapStatus: 'pending' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    })

    // 5. Get user address
    const userAddress = state.addresses.sepolia || state.addresses.ethereum || state.addresses.base || state.addresses.polygon || state.addresses.arbitrum
    if (!userAddress) {
      throw new Error('User address not found')
    }

    // 5. Calculate required ETH for gas using on-chain estimates (approve + depositForBurn)
    if (!window.ethereum) throw new Error('MetaMask not available')
    const provider = new ethers.BrowserProvider(window.ethereum as any)
    const signer = await provider.getSigner()
    const wallet = await signer.getAddress()
    const feeData = await provider.getFeeData()
    const gasPrice = (feeData.maxFeePerGas ?? feeData.gasPrice ?? 1000000000n) // fallback 1 gwei

    // Estimate approve gas (use large approval amount to match app behavior)
    const usdc = new ethers.Contract(getUSDCAddress(inputs.chain), USDC_ABI, signer)
    const largeApprovalAmount = ethers.parseUnits('1000000', 6)
    const approveTx = await usdc.approve.populateTransaction(getTokenMessengerAddress(inputs.chain), largeApprovalAmount)
    const approveGas = await provider.estimateGas({ ...approveTx, from: wallet, gasPrice })

    // Estimate depositForBurn gas using placeholder values (estimation only)
    const tokenMessenger = new ethers.Contract(getTokenMessengerAddress(inputs.chain), TOKEN_MESSENGER_ABI, signer)
    const burnEstimateTx = await tokenMessenger.depositForBurn.populateTransaction(
      1n,
      4,
      '0x' + '00'.repeat(32),
      getUSDCAddress(inputs.chain)
    )
    const burnGas = await provider.estimateGas({ ...burnEstimateTx, from: wallet, gasPrice })

    // Use 1.2x buffer for safety margin (lower than previous 2.0x to avoid excessive swap amounts)
    const requiredWeiBig = ((approveGas + burnGas) * gasPrice * 12n) / 10n

    // 6. Get price quote for USDC to ETH conversion
    dispatch({ 
      type: 'UPDATE_TRANSACTION', 
      payload: { 
        id: txId, 
        changes: { 
          stage: 'Getting gas quote...',
          status: 'pending' 
        } 
      } 
    })

    // Debug: Check chain configuration
    console.log('[Gasless] Chain:', inputs.chain)
    console.log('[Gasless] ChainId:', getChainId(inputs.chain))
    console.log('[Gasless] USDC Address:', getUSDCAddress(inputs.chain))
    console.log('[Gasless] TokenMessenger Address:', getTokenMessengerAddress(inputs.chain))

    // Prepare real calldata up-front using normal flow parity
    const forwardingAddress = await fetchNobleForwardingAddress(inputs.destinationAddress)
    const forwardingBytes32 = encodeBech32ToBytes32(forwardingAddress)
    const depositCalldata = buildDepositForBurnCalldataExact(
      inputs.amount,
      inputs.chain,
      forwardingBytes32
    )

    const config: GaslessConfig = {
      chainId: getChainId(inputs.chain),
      sellToken: getUSDCAddress(inputs.chain),
      buyToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // Native ETH
      sellAmount: '100000', // sample to derive rate
      taker: userAddress,
      actionsString: 'permit2,swap'
    }

    const price = await gaslessApiService.getPrice(config)
    
    if (!price.liquidityAvailable) {
      throw new Error('Insufficient liquidity for gas conversion')
    }

    // 7. Calculate how much USDC we need to sell to get required ETH (ceiling division)
    const sampleBuyAmount = BigInt(price.buyAmount)
    const sampleSellAmount = BigInt(price.sellAmount)
    const requiredEth = requiredWeiBig
    
    console.log('[Gasless] Price calculation debug:')
    console.log('[Gasless] sampleBuyAmount (ETH):', sampleBuyAmount.toString())
    console.log('[Gasless] sampleSellAmount (USDC):', sampleSellAmount.toString())
    console.log('[Gasless] requiredEth (wei):', requiredEth.toString())
    console.log('[Gasless] requiredEth (ETH):', (Number(requiredEth) / 1e18).toFixed(6))
    
    // Ceil: (requiredEth * sampleSell + (sampleBuy - 1)) / sampleBuy
    let sellAmt = (requiredEth * sampleSellAmount + (sampleBuyAmount - 1n)) / sampleBuyAmount
    console.log('[Gasless] initial sellAmt (USDC base):', sellAmt.toString())

    // 8. Iteratively check price minBuyAmount and adjust sellAmt (and handle SELL_AMOUNT_TOO_SMALL)
    dispatch({ 
      type: 'UPDATE_TRANSACTION', 
      payload: { id: txId, changes: { stage: 'Getting transaction quote...' } } 
    })

    const priceCheck = async (amt: bigint) => {
      const cfg: GaslessConfig = {
        chainId: getChainId(inputs.chain),
        sellToken: getUSDCAddress(inputs.chain),
        buyToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        sellAmount: amt.toString(),
        taker: userAddress,
        actionsString: 'permit2,swap'
      }
      try {
        const p = await gaslessApiService.getPrice(cfg)
        return { ok: true as const, minBuyAmount: BigInt(p?.minBuyAmount || '0') }
      } catch (e: any) {
        const msg = String(e?.message || '')
        console.log('[Gasless] /price error caught. message:', msg)
        // Parse nested JSON if present e.g. "0x API error: 400 - { ... }"
        let j: any = null
        const braceIdx = msg.indexOf('{')
        if (braceIdx >= 0) {
          try { 
            j = JSON.parse(msg.slice(braceIdx))
            console.log('[Gasless] Parsed JSON from /price error:', j)
          } catch (parseErr) {
            console.log('[Gasless] Failed to parse JSON from /price error at brace index', braceIdx)
          }
        }
        if (!j) {
          // Try regex extraction
          const m = msg.match(/\{.*\}$/)
          if (m && m[0]) { 
            try { 
              j = JSON.parse(m[0])
              console.log('[Gasless] Parsed JSON from /price error via regex:', j)
            } catch {}
          }
        }
        if (j) {
          const name = j?.name
          const minSell = j?.data?.minSellAmount ? BigInt(j.data.minSellAmount) : undefined
          console.log('[Gasless] Extracted from /price error: name=', name, 'minSell=', minSell?.toString())
          if (name === 'SELL_AMOUNT_TOO_SMALL' && minSell !== undefined) {
            console.warn('[Gasless] SELL_AMOUNT_TOO_SMALL from /price. minSellAmount=', String(minSell))
            return { ok: false as const, minSellAmount: minSell }
          }
        } else {
          console.log('[Gasless] Could not parse JSON from /price error')
        }
        return { ok: false as const }
      }
    }

    for (let i = 0; i < 6; i++) {
      const r = await priceCheck(sellAmt)
      if (!r.ok && (r as any).minSellAmount) {
        const ms = (r as any).minSellAmount as bigint
        if (sellAmt < ms) {
          console.log('[Gasless] bumping sellAmt to minSellAmount:', ms.toString())
          sellAmt = ms
          continue
        }
      }
      const minBuy = (r as any).minBuyAmount as bigint | undefined
      if (minBuy !== undefined && minBuy >= requiredEth) {
        break
      }
      sellAmt = (sellAmt * 12n) / 10n // +20%
    }

    console.log('[Gasless] final sellAmt (USDC base):', sellAmt.toString())

    const quoteConfig: GaslessConfig = {
      chainId: getChainId(inputs.chain),
      sellToken: getUSDCAddress(inputs.chain),
      buyToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      sellAmount: sellAmt.toString(),
      taker: userAddress,
      actionsString: 'permit2,swap'
    }

    let quote: GaslessQuote
    for (let attempt = 0; ; attempt++) {
      try {
        quote = await gaslessApiService.getQuote(quoteConfig)
        break
      } catch (e: any) {
        const msg = String(e?.message || '')
        console.log('[Gasless] /quote error caught. message:', msg)
        let minSellFromQuote: bigint | undefined
        const idx = msg.indexOf('{')
        if (idx >= 0) {
          try {
            const j = JSON.parse(msg.slice(idx))
            console.log('[Gasless] Parsed JSON from /quote error:', j)
            if (j?.name === 'SELL_AMOUNT_TOO_SMALL' && j?.data?.minSellAmount) {
              minSellFromQuote = BigInt(j.data.minSellAmount)
              console.log('[Gasless] Extracted minSellAmount from /quote:', String(minSellFromQuote))
            }
          } catch (parseErr) {
            console.log('[Gasless] Failed to parse JSON from /quote error')
          }
        }
        if (minSellFromQuote && sellAmt < minSellFromQuote && attempt < 2) {
          console.warn('[Gasless] /quote SELL_AMOUNT_TOO_SMALL. Bumping sellAmt to:', String(minSellFromQuote))
          sellAmt = minSellFromQuote
          quoteConfig.sellAmount = sellAmt.toString()
          continue
        }
        throw e
      }
    }

    // 9. Switch to correct network before signing
    dispatch({ 
      type: 'UPDATE_TRANSACTION', 
      payload: { 
        id: txId, 
        changes: { 
          stage: 'Switching to correct network...'
        } 
      } 
    })

    try {
      await switchToNetwork(inputs.chain)
    } catch (error: any) {
      throw new Error(`Please switch MetaMask to ${inputs.chain} network. ${error.message}`)
    }

    // 10. Sign and submit the gas-less transaction
    dispatch({ 
      type: 'UPDATE_TRANSACTION', 
      payload: { 
        id: txId, 
        changes: { 
          stage: 'Converting USDC to Native Token for gas...',
          gasless: { tradeHash: quote.tradeHash }
        } 
      } 
    })

    // 0x submit expects signature objects { r, s, v } embedded under approval/trade
    const approvalSigObj = quote.approval?.eip712
      ? await signEIP712(quote.approval.eip712, userAddress)
      : undefined
    const tradeSigObj = quote.trade?.eip712
      ? await signEIP712(quote.trade.eip712, userAddress)
      : undefined

    await gaslessApiService.submitTransaction({
      chainId: getChainId(inputs.chain),
      approval: quote.approval && approvalSigObj
        ? { ...quote.approval, signature: { ...approvalSigObj, signatureType: 2 } }
        : undefined,
      trade: quote.trade && tradeSigObj
        ? { ...quote.trade, signature: { ...tradeSigObj, signatureType: 2 } }
        : undefined,
    })

    // 11. Wait for ETH and execute deposit
    dispatch({ 
      type: 'UPDATE_TRANSACTION', 
      payload: { 
        id: txId, 
        changes: { 
          stage: 'Waiting for Native Token to arrive...'
        } 
      } 
    })

    await waitForEthBalance(userAddress, requiredWeiBig.toString())

    // 12. Hand off to the existing deposit flow (parity with normal deposits)
    dispatch({ 
      type: 'UPDATE_TRANSACTION', 
      payload: { 
        id: txId, 
        changes: { 
          stage: 'Processing deposit...',
          gasless: { swapStatus: 'success' }
        } 
      } 
    })

    // Hand off to existing deposit flow - it will handle completion and status updates
    await startEvmDepositAction(
      { sdk, state, dispatch, showToast, getNamadaAccounts, getCurrentState: () => state },
      {
        amount: inputs.amount,
        destinationAddress: inputs.destinationAddress,
        chain: inputs.chain,
        getAvailableBalance: (_chain: string) => inputs.getAvailableBalance(),
        validateForm: inputs.validateForm,
        txId,
        chainKey: inputs.chain,
      }
    )

  } catch (error: any) {
    console.error('Gas-less deposit failed:', error)
    
    const userError = getUserFriendlyError(error)
    showToast({
      title: userError.title,
      message: userError.message,
      variant: 'error',
      action: userError.action ? { label: 'Learn More', onClick: () => {} } : undefined
    })
    
    dispatch({ 
      type: 'UPDATE_TRANSACTION', 
      payload: { 
        id: txId, 
        changes: { 
          status: 'error',
          errorMessage: userError.message
        } 
      } 
    })
  }
}

// Helper function to sign EIP-712 payloads
async function signGaslessTransaction(quote: GaslessQuote, userAddress: string): Promise<any[]> {
  const signatures: any[] = []
  
  // Sign approval if needed
  if (quote.approval?.eip712) {
    const approvalSig = await signEIP712(quote.approval.eip712, userAddress)
    signatures.push({
      ...approvalSig,
      signatureType: 'EIP712'
    })
  }
  
  // Sign trade
  if (quote.trade?.eip712) {
    const tradeSig = await signEIP712(quote.trade.eip712, userAddress)
    signatures.push({
      ...tradeSig,
      signatureType: 'EIP712'
    })
  }
  
  return signatures
}

// Helper function to sign EIP-712 payloads with MetaMask
async function signEIP712(payload: any, userAddress: string): Promise<{ r: string; s: string; v: number }> {
  if (!window.ethereum) {
    throw new Error('MetaMask not available')
  }

  const signature = await window.ethereum.request({
    method: 'eth_signTypedData_v4',
    params: [userAddress, JSON.stringify(payload)]
  })

  // Split signature into r, s, v components
  const sig = signature.slice(2) // Remove 0x prefix
  const r = `0x${sig.slice(0, 64)}`
  const s = `0x${sig.slice(64, 128)}`
  const v = parseInt(sig.slice(128, 130), 16)

  return { r, s, v }
}

// Helper to return raw hex signature (for 0x submit payload)
async function signEip712Hex(payload: any, userAddress: string): Promise<string> {
  if (!window.ethereum) {
    throw new Error('MetaMask not available')
  }
  const signature = await window.ethereum.request({
    method: 'eth_signTypedData_v4',
    params: [userAddress, JSON.stringify(payload)]
  })
  return signature as string
}

// Helper function to wait for ETH balance
async function waitForEthBalance(userAddress: string, minWei: string): Promise<void> {
  const maxAttempts = 20
  const delay = 3000 // 3 seconds
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const balance = await getEthBalance(userAddress)
      if (BigInt(balance) >= BigInt(minWei)) {
        return
      }
    } catch (error) {
      console.warn('Failed to check Native Token balance:', error)
    }
    
    await new Promise(resolve => setTimeout(resolve, delay))
  }
  
  throw new Error('Native Token balance did not arrive within expected time')
}

// Helper function to get ETH balance
async function getEthBalance(address: string): Promise<string> {
  if (!window.ethereum) {
    throw new Error('MetaMask not available')
  }

  const balance = await window.ethereum.request({
    method: 'eth_getBalance',
    params: [address, 'latest']
  })

  return balance
}

// Helper function to execute the actual deposit
async function executeDepositForBurn(
  inputs: GaslessDepositInputs, 
  chainConfig: any, 
  userAddress: string
): Promise<void> {
  // This would integrate with your existing deposit logic
  // For now, we'll simulate the deposit execution
  console.log('Executing deposit for burn:', {
    amount: inputs.amount,
    destination: inputs.destinationAddress,
    chainConfig,
    userAddress
  })
  
  // TODO: Integrate with existing depositForBurn logic
  // This should call the same logic as your existing deposit flow
  // but now the user has ETH for gas fees
}
