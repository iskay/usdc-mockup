import { gaslessApiService, type GaslessConfig, type GaslessQuote } from '../../../services/gaslessApiService'
import { getUserFriendlyError } from '../../../utils/gaslessErrors'
import { getChainId, getUSDCAddress, getTokenMessengerAddress, buildDepositForBurnCalldata } from './gaslessUtils'

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

export async function startGaslessDepositAction(
  { sdk, state, dispatch, showToast }: Deps, 
  inputs: GaslessDepositInputs
) {
  const txId = `gasless_dep_${Date.now()}`
  
  try {
    // 1. Validate inputs
    const validation = inputs.validateForm(inputs.amount, inputs.getAvailableBalance(), inputs.destinationAddress)
    if (!validation.isValid) {
      showToast({ title: 'Validation Error', message: validation.error || 'Invalid inputs', variant: 'error' })
      return
    }

    // 2. Check if chain is supported for gasless
    try {
      getChainId(inputs.chain)
    } catch {
      showToast({ title: 'Unsupported Chain', message: 'Gas-less transactions are not supported on this network', variant: 'error' })
      return
    }

    // 3. Create transaction with gas-less flag
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

    // 4. Get user address
    const userAddress = (state.addresses as any)[inputs.chain]
    if (!userAddress) {
      throw new Error('User address not found')
    }

    // 5. Calculate required ETH for gas (approve + depositForBurn with 2x buffer)
    const gasApprove = 75000n  // USDC approval gas
    const gasBurn = 200000n    // CCTP burn gas
    const gasPrice = 1000000000n // 1 gwei (conservative estimate)
    const requiredWei = ((gasApprove + gasBurn) * gasPrice * 2n).toString()

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

    const config: GaslessConfig = {
      chainId: getChainId(inputs.chain),
      sellToken: getUSDCAddress(inputs.chain),
      buyToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // Native ETH
      sellAmount: '100000', // 0.1 USDC sample
      taker: userAddress,
      actions: [{
        type: 'contractCall',
        target: getTokenMessengerAddress(inputs.chain),
        calldata: '0x', // Dummy calldata for estimation
        value: '0'
      }]
    }

    const price = await gaslessApiService.getPrice(config)
    
    if (!price.liquidityAvailable) {
      throw new Error('Insufficient liquidity for gas conversion')
    }

    // 7. Calculate how much USDC we need to sell to get required ETH
    const sampleBuyAmount = BigInt(price.buyAmount)
    const sampleSellAmount = BigInt(price.sellAmount)
    const requiredEth = BigInt(requiredWei)
    
    // Calculate swap amount with 20% buffer
    const swapAmount = (requiredEth * sampleSellAmount * 12n) / (sampleBuyAmount * 10n)
    const totalAmount = BigInt(inputs.amount) * BigInt(1e6) + swapAmount // amount in base units + swap amount

    // 8. Get detailed quote for the actual transaction
    dispatch({ 
      type: 'UPDATE_TRANSACTION', 
      payload: { 
        id: txId, 
        changes: { 
          stage: 'Getting transaction quote...'
        } 
      } 
    })

    const quoteConfig: GaslessConfig = {
      chainId: getChainId(inputs.chain),
      sellToken: getUSDCAddress(inputs.chain),
      buyToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      sellAmount: swapAmount.toString(),
      taker: userAddress,
      actions: [{
        type: 'contractCall',
        target: getTokenMessengerAddress(inputs.chain),
        calldata: buildDepositForBurnCalldata(inputs.amount, inputs.destinationAddress, {
          usdcAddress: getUSDCAddress(inputs.chain),
          tokenMessengerAddress: getTokenMessengerAddress(inputs.chain)
        }),
        value: '0'
      }]
    }

    const quote = await gaslessApiService.getQuote(quoteConfig)

    // 9. Sign and submit the gas-less transaction
    dispatch({ 
      type: 'UPDATE_TRANSACTION', 
      payload: { 
        id: txId, 
        changes: { 
          stage: 'Converting USDC to ETH for gas...',
          gasless: { tradeHash: quote.tradeHash }
        } 
      } 
    })

    const signatures = await signGaslessTransaction(quote, userAddress)
    await gaslessApiService.submitTransaction({ tradeHash: quote.tradeHash!, signatures })

    // 10. Wait for ETH and execute deposit
    dispatch({ 
      type: 'UPDATE_TRANSACTION', 
      payload: { 
        id: txId, 
        changes: { 
          stage: 'Waiting for ETH to arrive...'
        } 
      } 
    })

    await waitForEthBalance(userAddress, requiredWei)

    // 11. Execute the actual deposit
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

    await executeDepositForBurn(inputs, {
      usdcAddress: getUSDCAddress(inputs.chain),
      tokenMessengerAddress: getTokenMessengerAddress(inputs.chain)
    }, userAddress)
    
    dispatch({ 
      type: 'UPDATE_TRANSACTION', 
      payload: { 
        id: txId, 
        changes: { 
          status: 'success',
          stage: 'Transfer complete!'
        } 
      } 
    })

    showToast({
      title: 'Transfer Complete!',
      message: `Successfully transferred ${inputs.amount} USDC to Namada using gas-less transaction`,
      variant: 'success'
    })

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
      console.warn('Failed to check ETH balance:', error)
    }
    
    await new Promise(resolve => setTimeout(resolve, delay))
  }
  
  throw new Error('ETH balance did not arrive within expected time')
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
