import { initSdk } from '@namada/sdk-multicore/inline'
import { type WrapperTxMsgValue, type ShieldingTransferMsgValue, type ShieldedTransferDataMsgValue, type UnshieldingTransferProps, type IbcTransferProps, type TxMsgValue, type TxProps } from '@namada/sdk-multicore'
import BigNumber from 'bignumber.js'

// Types matching Namadillo's approach
type Account = {
  address: string
  publicKey: string
  type?: string
}

type GasConfig = {
  gasToken: string
  gasLimit: string
  gasPriceInMinDenom: string
}

type ChainSettings = {
  chainId: string
  nativeTokenAddress: string
}

type EncodedTxData<T> = {
  type: string
  txs: (TxProps & {
    innerTxHashes: string[]
    memos: (number[] | null)[]
  })[]
  wrapperTxProps: WrapperTxMsgValue
  meta?: {
    props: T[]
  }
}

type InitMsg = { type: 'init', payload: { rpcUrl: string; token: string; maspIndexerUrl?: string } }
type BuildShieldingMsg = { type: 'build-shielding', payload: {
  account: Account
  gasConfig: GasConfig
  chain: ChainSettings
  fromTransparent: string
  toShielded: string
  tokenAddress: string
  amountInBase: string
  memo?: string
} }

type BuildUnshieldingMsg = { type: 'build-unshielding', payload: {
  account: Account
  gasConfig: GasConfig
  chain: ChainSettings
  fromShielded: string
  toTransparent: string
  tokenAddress: string
  amountInBase: string
  memo?: string
} }

type BuildIbcTransferMsg = { type: 'build-ibc-transfer', payload: {
  account: Account
  gasConfig: GasConfig
  chain: ChainSettings
  source: string
  receiver: string
  tokenAddress: string
  amountInBase: string
  portId?: string
  channelId: string
  timeoutHeight?: string
  timeoutSecOffset?: string
  memo?: string
  refundTarget?: string
  gasSpendingKey?: string
} }

type InMsg = InitMsg | BuildShieldingMsg | BuildUnshieldingMsg | BuildIbcTransferMsg

let sdk: any | undefined

// Helper function matching Namadillo's getTxProps
const getTxProps = (
  account: Account,
  gasConfig: GasConfig,
  chain: ChainSettings,
  memo?: string
): WrapperTxMsgValue => {
  return {
    token: gasConfig.gasToken,
    feeAmount: new BigNumber(gasConfig.gasPriceInMinDenom),
    gasLimit: new BigNumber(gasConfig.gasLimit),
    chainId: chain.chainId,
    publicKey: account.publicKey,
    memo,
  }
}

// Check if public key is revealed (simplified version)
const isPublicKeyRevealed = async (address: string): Promise<boolean> => {
  try {
    const revealed = await sdk.rpc.queryPublicKey(address)
    return Boolean(revealed)
  } catch {
    return false
  }
}

// Generic buildTx function matching Namadillo's approach exactly
const buildTx = async <T>(
  account: Account,
  gasConfig: GasConfig,
  chain: ChainSettings,
  queryProps: T[],
  txFn: (wrapperTxProps: WrapperTxMsgValue, props: T) => Promise<TxProps>,
  memo?: string,
  shouldRevealPk: boolean = true,
  maspFeePaymentProps?: (UnshieldingTransferProps & { memo: string })
): Promise<EncodedTxData<T>> => {
  const txs: TxProps[] = []
  const txProps: TxProps[] = []

  const wrapperTxProps = getTxProps(account, gasConfig, chain, memo)
  
  // Determine if RevealPK is needed:
  if (shouldRevealPk) {
    const publicKeyRevealed = await isPublicKeyRevealed(account.address)
    if (!publicKeyRevealed) {
      const revealPkTx = await sdk.tx.buildRevealPk(wrapperTxProps)
      txs.push(revealPkTx)
    }
  }

  // Optional MASP fee payment pre-step: fund wrapper fee payer from MASP
  if (maspFeePaymentProps) {
    const feeWrapperProps = getTxProps(account, gasConfig, chain, maspFeePaymentProps.memo)
    const maspFeePaymentTx = await sdk.tx.buildUnshieldingTransfer(
      feeWrapperProps,
      maspFeePaymentProps,
    )
    txs.push(maspFeePaymentTx)
  }

  for (const props of queryProps) {
    const tx = await txFn.apply(sdk.tx, [wrapperTxProps, props])
    txs.push(tx)
  }

  // Always batch for non-Ledger accounts (we don't have Ledger support here)
  txProps.push(sdk.tx.buildBatch(txs))

  return {
    txs: txProps.map(({ args, hash, bytes, signingData }) => {
      const innerTxHashes = sdk.tx.getInnerTxMeta(bytes)
      return {
        args,
        hash,
        bytes,
        signingData,
        innerTxHashes: innerTxHashes.map(([hash]: [string, any]) => hash),
        memos: innerTxHashes.map(([, memo]: [string, any]) => memo),
      }
    }),
    wrapperTxProps,
    type: txFn.name,
    meta: {
      props: queryProps,
    },
  }
}

self.onmessage = async (event: MessageEvent<InMsg>) => {
  const msg = event.data
  try {
    if (msg.type === 'init') {
      sdk = await initSdk({ rpcUrl: msg.payload.rpcUrl, token: msg.payload.token, maspIndexerUrl: msg.payload.maspIndexerUrl || undefined })
      postMessage({ type: 'init-done' })
      return
    }
    if (msg.type === 'build-shielding') {
      if (!sdk) throw new Error('SDK not initialized')
      const { account, gasConfig, chain, fromTransparent, toShielded, tokenAddress, amountInBase, memo } = msg.payload
      
      try { 
        await sdk.masp.loadMaspParams('', chain.chainId) 
      } catch {}

      // Create shielding props following Namadillo's pattern
      const shieldingProps: ShieldingTransferMsgValue = {
        target: toShielded,
        data: [
          {
            source: fromTransparent,
            token: tokenAddress,
            amount: new BigNumber(amountInBase),
          } as ShieldedTransferDataMsgValue,
        ],
      }

      // Use the generic buildTx function exactly like Namadillo
      const encodedTxData = await buildTx<ShieldingTransferMsgValue>(
        account,
        gasConfig,
        chain,
        [shieldingProps],
        sdk.tx.buildShieldingTransfer,
        memo,
        true // shouldRevealPk
      )

      postMessage({ type: 'build-shielding-done', payload: encodedTxData })
      return
    }
    if (msg.type === 'build-unshielding') {
      if (!sdk) throw new Error('SDK not initialized')
      const { account, gasConfig, chain, fromShielded, toTransparent, tokenAddress, amountInBase, memo } = msg.payload

      try {
        await sdk.masp.loadMaspParams('', chain.chainId)
      } catch {}

      const props: UnshieldingTransferProps = {
        source: fromShielded,
        data: [
          {
            target: toTransparent,
            token: tokenAddress,
            amount: new BigNumber(amountInBase),
          },
        ],
      }

      const encodedTxData = await buildTx<UnshieldingTransferProps>(
        account,
        gasConfig,
        chain,
        [props],
        sdk.tx.buildUnshieldingTransfer,
        memo,
        false // shouldRevealPk for unshielding
      )

      postMessage({ type: 'build-unshielding-done', payload: encodedTxData })
      return
    }
    if (msg.type === 'build-ibc-transfer') {
      if (!sdk) throw new Error('SDK not initialized')
      const { account, gasConfig, chain, source, receiver, tokenAddress, amountInBase, portId, channelId, timeoutHeight, timeoutSecOffset, memo, refundTarget, gasSpendingKey } = msg.payload

      try {
        await sdk.masp.loadMaspParams('', chain.chainId)
      } catch {}

      const props: IbcTransferProps = {
        source,
        receiver,
        token: tokenAddress,
        amountInBaseDenom: new BigNumber(amountInBase),
        portId: portId || 'transfer',
        channelId,
        memo,
        refundTarget,
        gasSpendingKey,
        timeoutHeight: timeoutHeight ? BigInt(timeoutHeight) : undefined,
        timeoutSecOffset: timeoutSecOffset ? BigInt(timeoutSecOffset) : undefined,
      }

      // Debug: log sanitized inputs for IBC build
      try {
        console.info('[MaspBuildWorker] build-ibc-transfer inputs', {
          account: { address: account?.address?.slice(0, 12) + '...' },
          gasConfig: { token: gasConfig?.gasToken, gasLimit: gasConfig?.gasLimit, gasPrice: gasConfig?.gasPriceInMinDenom },
          chain,
          props: {
            source: typeof source === 'string' ? `${source.slice(0, 12)}...` : 'N/A',
            receiver,
            token: tokenAddress,
            amountInBaseDenom: String(amountInBase),
            portId: props.portId,
            channelId: props.channelId,
            memoLen: memo ? memo.length : 0,
            refundTarget: refundTarget ? refundTarget.slice(0, 12) + '...' : undefined,
            hasGasSpendingKey: Boolean(gasSpendingKey),
          },
        })
      } catch {}

      // For IBC transfers, we don't use maspFeePaymentProps - the gasSpendingKey handles fees directly from MASP
      const shouldRevealPk = !Boolean(props.gasSpendingKey) // Only reveal PK if no gasSpendingKey
      const encodedTxData = await buildTx<IbcTransferProps>(
        account,
        gasConfig,
        chain,
        [props],
        sdk.tx.buildIbcTransfer,
        memo,
        shouldRevealPk
        // No maspFeePaymentProps for IBC - gasSpendingKey handles fees directly
      )

      postMessage({ type: 'build-ibc-transfer-done', payload: encodedTxData })
      return
    }
  } catch (e: any) {
    postMessage({ type: 'error', error: e?.message ?? String(e) })
  }
}


