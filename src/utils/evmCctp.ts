import { ethers } from 'ethers'
import { getUsdcAddress, getTokenMessengerAddress, getCctpDomain, getPrimaryRpcUrl, getChainId, switchToNetwork } from './chain'

export const USDC_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)'
]

export const TOKEN_MESSENGER_ABI = [
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) external returns (uint64 nonce)'
]

export type DepositForBurnParams = {
  chainKey: string
  amountUsdc: string
  forwardingAddressBytes32: string
  destinationDomain?: number // Optional, will use chain config if not provided
}

export type DepositForBurnResult = {
  txHash: string
  nonce?: string
}

export async function depositForBurn(params: DepositForBurnParams): Promise<DepositForBurnResult> {
  if (!window.ethereum) throw new Error('MetaMask not available')

  // Get chain configuration
  const usdcAddress = getUsdcAddress(params.chainKey)
  const tokenMessengerAddress = getTokenMessengerAddress(params.chainKey)
  const destinationDomain = params.destinationDomain ?? getCctpDomain(params.chainKey)

  if (!usdcAddress) throw new Error(`USDC address not configured for chain: ${params.chainKey}`)
  if (!tokenMessengerAddress) throw new Error(`TokenMessenger address not configured for chain: ${params.chainKey}`)
  if (destinationDomain === undefined) throw new Error(`CCTP domain not configured for chain: ${params.chainKey}`)

  console.log('🚀 Starting depositForBurn with params:', {
    chainKey: params.chainKey,
    amountUsdc: params.amountUsdc,
    forwardingAddressBytes32: params.forwardingAddressBytes32,
    usdcAddress,
    tokenMessengerAddress,
    destinationDomain
  })

  // Create provider with the correct RPC URL for the chain
  const rpcUrl = getPrimaryRpcUrl(params.chainKey)
  console.log('🌐 Using RPC URL:', rpcUrl)
  
  // Use custom RPC provider for reading, browser provider for signing
  const readProvider = new ethers.JsonRpcProvider(rpcUrl)
  const browserProvider = new ethers.BrowserProvider(window.ethereum)
  const signer = await browserProvider.getSigner()
  const walletAddress = await signer.getAddress()
  console.log('👤 Wallet address:', walletAddress)
  
  // Check if MetaMask is on the correct network
  const network = await browserProvider.getNetwork()
  const expectedChainId = getChainId(params.chainKey)
  console.log('🌐 Current network chainId:', network.chainId.toString())
  console.log('🌐 Expected chainId:', expectedChainId)
  
  let newSigner: ethers.Signer | null = null
  
  if (network.chainId !== BigInt(expectedChainId || 0)) {
    console.log('🔄 Network mismatch, attempting to switch...')
    try {
      await switchToNetwork(params.chainKey)
      console.log('✅ Network switch initiated')
    } catch (error) {
      // Check if it's a network change error (which is actually success)
      if (error instanceof Error && error.message.includes('network changed')) {
        console.log('✅ Network change detected, continuing...')
      } else {
        throw new Error(`Please switch MetaMask to ${params.chainKey} network (Chain ID: ${expectedChainId}). Error: ${error}`)
      }
    }
    
    // Wait for network change to complete
    console.log('⏳ Waiting for network change to complete...')
    await new Promise(resolve => setTimeout(resolve, 2000)) // Wait 2 seconds for network change
    
    // Create a new provider and verify the network
    const newBrowserProvider = new ethers.BrowserProvider(window.ethereum)
    const newNetwork = await newBrowserProvider.getNetwork()
    console.log('🌐 New network chainId:', newNetwork.chainId.toString())
    
    if (newNetwork.chainId !== BigInt(expectedChainId || 0)) {
      throw new Error(`Failed to switch to ${params.chainKey} network. Please add the network manually in MetaMask.`)
    }
    
    // Update the signer for the rest of the function
    newSigner = await newBrowserProvider.getSigner()
    console.log('✅ Successfully switched to correct network')
  }

  const amountWei = ethers.parseUnits(params.amountUsdc, 6)
  console.log('💰 Amount in wei:', amountWei.toString())

  // Use read provider for balance/allowance checks, signer for transactions
  const usdcRead = new ethers.Contract(usdcAddress, USDC_ABI, readProvider)
  
  // Use the new signer if we switched networks, otherwise use the original signer
  const finalSigner = newSigner || signer
  const usdc = new ethers.Contract(usdcAddress, USDC_ABI, finalSigner)
  const tokenMessenger = new ethers.Contract(tokenMessengerAddress, TOKEN_MESSENGER_ABI, finalSigner)

  // Check balance using read provider
  console.log('🔍 Checking USDC balance...')
  console.log('   RPC URL:', rpcUrl)
  console.log('   USDC Address:', usdcAddress)
  console.log('   Wallet Address:', walletAddress)
  let balance: bigint
  try {
    balance = await usdcRead.balanceOf(walletAddress)
    console.log('   Balance:', ethers.formatUnits(balance, 6), 'USDC')
  } catch (error) {
    console.error('   Balance check failed:', error)
    throw error
  }
  if (balance < amountWei) {
    throw new Error(`Insufficient USDC balance: have ${ethers.formatUnits(balance, 6)}, need ${params.amountUsdc}`)
  }

  // Check allowance using read provider
  console.log('🔍 Checking USDC allowance...')
  const allowance = await usdcRead.allowance(walletAddress, tokenMessengerAddress)
  console.log('   Allowance:', ethers.formatUnits(allowance, 6), 'USDC')
  
  if (allowance < amountWei) {
    console.log('⚠️  Insufficient allowance, approving large amount for future transactions...')
    try {
      // Approve a large amount (1M USDC) to avoid repeated approval prompts
      // This matches production DeFi app behavior for better UX
      const largeApprovalAmount = ethers.parseUnits("1000000", 6) // 1M USDC
      const approveTx = await usdc.approve(tokenMessengerAddress, largeApprovalAmount)
      console.log('   Approve tx hash:', approveTx.hash)
      console.log('   Approving amount:', ethers.formatUnits(largeApprovalAmount, 6), 'USDC')
      const approveReceipt = await approveTx.wait()
      console.log('   ✅ Approval confirmed in block:', approveReceipt.blockNumber)
    } catch (err: any) {
      console.error('❌ Approval failed:', err)
      throw new Error(`Approval failed: ${err.message}`)
    }
  } else {
    console.log('✅ Sufficient allowance')
  }

  // Execute depositForBurn
  console.log('🚀 Executing depositForBurn...')
  console.log('   Parameters:')
  console.log('     - amount:', amountWei.toString())
  console.log('     - destinationDomain:', destinationDomain)
  console.log('     - mintRecipient:', params.forwardingAddressBytes32)
  console.log('     - burnToken:', usdcAddress)

  try {
    const depositTx = await tokenMessenger.depositForBurn(
      amountWei,
      destinationDomain,
      params.forwardingAddressBytes32,
      usdcAddress
    )
    console.log('📋 Transaction submitted:', depositTx.hash)

    const receipt = await depositTx.wait()
    console.log('✅ Transaction confirmed in block:', receipt.blockNumber)

    let nonce: string | undefined
    try {
      const iface = new ethers.Interface(TOKEN_MESSENGER_ABI)
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log)
          if (parsed && parsed.name === 'DepositForBurn') {
            nonce = parsed.args?.nonce?.toString()
            console.log('   Nonce found:', nonce)
            break
          }
        } catch {}
      }
    } catch {}

    return { txHash: depositTx.hash, nonce }
  } catch (err: any) {
    console.error('❌ depositForBurn failed:', err)
    throw new Error(`depositForBurn failed: ${err.message}`)
  }
}

// Backward compatibility export
export const depositForBurnSepolia = (params: Omit<DepositForBurnParams, 'chainKey'>) => 
  depositForBurn({ ...params, chainKey: 'sepolia' })


