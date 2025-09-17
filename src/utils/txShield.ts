import BigNumber from 'bignumber.js'
import type { Sdk, TxMsgValue, WrapperTxMsgValue, BondMsgValue } from '@namada/sdk-multicore'
// @ts-ignore
import MaspBuildWorker from '../workers/MaspBuildWorker?worker'

export type GasConfig = {
  gasToken: string
  gasLimit: BigNumber
  gasPriceInMinDenom: BigNumber
}

export type ChainSettings = {
  chainId: string
  nativeTokenAddress: string
}

export type ShieldingParams = {
  sdk: Sdk
  transparent: string
  shielded: string
  tokenAddress: string
  amountInBase: BigNumber
  gas: GasConfig
  chain: ChainSettings
  publicKey?: string
  onPhase?: (phase: 'building' | 'signing' | 'submitting' | 'submitted') => void
}

export type EncodedTxData<T> = {
  type: string;
  txs: (TxMsgValue & {
    innerTxHashes: string[];
    memos: (number[] | null)[];
  })[];
  wrapperTxProps: WrapperTxMsgValue;
  meta?: {
    props: T[];
  };
};

export type TransactionPair<T> = {
  encodedTxData: EncodedTxData<T>;
  signedTxs: Uint8Array[];
};

export async function buildShieldingBatch(
  sdk: Sdk,
  accountPublicKey: string,
  fromTransparent: string,
  toShielded: string,
  tokenAddress: string,
  amountInBase: BigNumber,
  gas: GasConfig,
  chain: ChainSettings,
  memo?: string,
): Promise<EncodedTxData<any>>{
  // Run build in worker to avoid Atomics.wait on main thread
  const worker: Worker = new MaspBuildWorker()

  // init
  await new Promise<void>((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      const { type, error } = ev.data || {}
      if (type === 'init-done') { worker.removeEventListener('message', onMsg as EventListener); resolve() }
      if (type === 'error') { worker.removeEventListener('message', onMsg as EventListener); reject(new Error(error || 'Worker init failed')) }
    }
    worker.addEventListener('message', onMsg as EventListener)
    // @ts-ignore access
    worker.postMessage({ type: 'init', payload: { rpcUrl: (sdk as any).url, token: (sdk as any).nativeToken } })
  })

  const encodedTxData = await new Promise<any>((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      const { type, payload, error } = ev.data || {}
      if (type === 'build-shielding-done') { worker.removeEventListener('message', onMsg as EventListener); resolve(payload) }
      if (type === 'error') { worker.removeEventListener('message', onMsg as EventListener); reject(new Error(error || 'Build failed')) }
    }
    worker.addEventListener('message', onMsg as EventListener)
    worker.postMessage({ type: 'build-shielding', payload: {
      account: {
        address: fromTransparent,
        publicKey: accountPublicKey,
      },
      gasConfig: {
        gasToken: gas.gasToken,
        gasLimit: gas.gasLimit.toString(),
        gasPriceInMinDenom: gas.gasPriceInMinDenom.toString(),
      },
      chain,
      fromTransparent,
      toShielded,
      tokenAddress,
      amountInBase: amountInBase.toString(),
      memo,
    } })
  })
  worker.terminate()
  
  // Debug: Check what we got from the worker
  console.log('[Debug] encodedTxData from worker:', encodedTxData)
  
  return encodedTxData
}

export async function signBatchTxs(
  sdk: Sdk,
  txs: TxMsgValue[],
  ownerAddress: string,
  checksums: Record<string, string>,
): Promise<Uint8Array[]> {
  const namada: any = (window as any).namada
  if (!namada) throw new Error('Namada Keychain not available')
  
  console.log('[Debug] signBatchTxs received txs:', txs)
  console.log('[Debug] txs type:', typeof txs, 'isArray:', Array.isArray(txs), 'length:', txs?.length)
  console.log(checksums)
  
  if (!txs || !Array.isArray(txs) || txs.length === 0) {
    throw new Error('No transactions to sign')
  }

  // Debug: deserialize the tx before passing to extension to verify commitments and wrapper props
  try {
    const first = txs?.[0]
    if (first?.bytes) {
      const details = (sdk as any).tx.deserialize(first.bytes, checksums)
      // Keep the log compact but useful
      console.group('[Debug] Pre-sign deserialize')
      console.info('Wrapper:', {
        token: details?.token,
        feeAmount: String(details?.feeAmount ?? ''),
        gasLimit: String(details?.gasLimit ?? ''),
        chainId: details?.chainId,
        expiration: details?.expiration,
        wrapperFeePayer: details?.wrapperFeePayer,
      })
      console.info('Commitments count:', details?.commitments?.length ?? 0)
      try { console.debug('Commitments:', details?.commitments) } catch {}
      console.groupEnd()
    }
  } catch (e) {
    console.warn('[Debug] tx.deserialize failed', e)
  }

  // Txs should already be enriched with innerTxHashes and memos from the worker
  type TxForSign = TxMsgValue & { innerTxHashes: string[]; memos: (number[] | null)[] }
  const txsForSigning: TxForSign[] = txs.map((tx) => {
    // If already enriched from worker, use as-is; otherwise enrich here as fallback
    if ('innerTxHashes' in tx && 'memos' in tx) {
      return tx as TxForSign
    }
    const inner = (sdk as any).tx.getInnerTxMeta(tx.bytes) as [string, number[] | null][]
    console.log("inner (fallback)", inner)
    return {
      ...tx,
      innerTxHashes: inner.map(([hash]) => hash),
      memos: inner.map(([, memo]) => memo),
    }
  })

  // Try modern signer API if present
  try {
    if (typeof namada.getSigner === 'function') {
      const signer = await namada.getSigner()
      if (!signer) throw new Error('Signer not provided')
      const signed = await signer.sign(txsForSigning, ownerAddress, checksums)
      if (signed) return signed
    }
  } catch (e) {
    console.warn('[Debug] modern signer path failed, falling back if possible', e)
  }

  // Fallback to direct sign if exposed
  if (typeof namada.sign === 'function') {
    const signed = await namada.sign({ txs: txsForSigning, signer: ownerAddress, checksums })
    if (signed) return signed
  }
  throw new Error('Signing is not supported by the Namada Keychain in this context')
}

export async function buildShieldingTxs({ sdk, transparent, shielded, tokenAddress, amountInBase, gas, chain, publicKey }: ShieldingParams): Promise<TxMsgValue[]> {
  const pk = publicKey || (await (sdk as any).rpc.queryPublicKey(transparent)) || ''
  const batchResult  = await buildShieldingBatch(sdk, pk, transparent, shielded, tokenAddress, amountInBase, gas, chain)
  return batchResult.txs
}

export async function buildSignBroadcastShielding(params: ShieldingParams): Promise<{ txs: TxMsgValue[]; signed: Uint8Array[]; response: any }> {
  // Phase: building
  try { params.onPhase?.('building') } catch {}
  const txs = await buildShieldingTxs(params)
  const rawChecksums = (await (params.sdk as any).rpc.queryChecksums?.()) || {}
  const checksums = Object.fromEntries(
    Object.entries(rawChecksums).map(([path, hash]) => [path, String(hash).toLowerCase()])
  )
  // Ensure extension is connected to the correct Namada chain before signing
  try {
    const namada: any = (window as any).namada
    const desiredChainId = params.chain?.chainId
    if (namada && typeof namada.isConnected === 'function' && typeof namada.connect === 'function' && desiredChainId) {
      const connected = await namada.isConnected(desiredChainId)
      if (!connected) {
        await namada.connect(desiredChainId)
      }
    }
  } catch (e) {
    console.warn('[Debug] Unable to pre-connect Namada extension to chain', e)
  }
  // Phase: signing
  try { params.onPhase?.('signing') } catch {}
  const signed = await signBatchTxs(params.sdk, txs, params.transparent, checksums)
  if (!signed || !Array.isArray(signed) || signed.length === 0) {
    throw new Error('Signing returned no bytes')
  }
  // Phase: submitting
  try { params.onPhase?.('submitting') } catch {}
  const response = await (params.sdk as any).rpc.broadcastTx(signed[0])
  try { params.onPhase?.('submitted') } catch {}
  return { txs, signed, response }
}
