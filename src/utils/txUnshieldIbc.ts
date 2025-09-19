import BigNumber from 'bignumber.js'
import type { Sdk, TxMsgValue, WrapperTxMsgValue, UnshieldingTransferProps, IbcTransferProps } from '@namada/sdk-multicore'
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

export type UnshieldParams = {
  sdk: Sdk
  accountPublicKey: string
  fromShielded: string
  toTransparent: string
  tokenAddress: string
  amountInBase: BigNumber
  gas: GasConfig
  chain: ChainSettings
  memo?: string
}

export type IbcParams = {
  sdk: Sdk
  accountPublicKey: string
  ownerAddress: string
  source: string
  receiver: string
  tokenAddress: string
  amountInBase: BigNumber
  gas: GasConfig
  chain: ChainSettings
  channelId: string
  portId?: string
  timeoutHeight?: bigint
  timeoutSecOffset?: bigint
  memo?: string
  refundTarget?: string
  gasSpendingKey?: string
  // maspFeePaymentProps not used for IBC - gasSpendingKey handles fees directly from MASP
}

export type Phase =
  | 'building:unshield'
  | 'signing:unshield'
  | 'submitting:unshield'
  | 'submitted:unshield'
  | 'building:ibc'
  | 'signing:ibc'
  | 'submitting:ibc'
  | 'submitted:ibc'

function getChecksumsLowercased(sdk: Sdk): Record<string, string> {
  const raw: Record<string, string> = (sdk as any).rpc?.queryChecksums ? (getNullable((sdk as any).rpc.queryChecksums) as any) : {}
  return Object.fromEntries(Object.entries(raw || {}).map(([k, v]) => [k, String(v).toLowerCase()]))
}

async function queryChecksums(sdk: Sdk): Promise<Record<string, string>> {
  const rpc: any = (sdk as any).rpc
  const raw = (await rpc?.queryChecksums?.()) || {}
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v).toLowerCase()]))
}

export async function buildUnshieldBatch(params: UnshieldParams): Promise<EncodedTxData<UnshieldingTransferProps>> {
  const worker: Worker = new MaspBuildWorker()
  await new Promise<void>((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      const { type, error } = ev.data || {}
      if (type === 'init-done') { worker.removeEventListener('message', onMsg as EventListener); resolve() }
      if (type === 'error') { worker.removeEventListener('message', onMsg as EventListener); reject(new Error(error || 'Worker init failed')) }
    }
    worker.addEventListener('message', onMsg as EventListener)
    // @ts-ignore access
    worker.postMessage({ type: 'init', payload: { rpcUrl: (params.sdk as any).url, token: (params.sdk as any).nativeToken } })
  })

  const result = await new Promise<any>((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      const { type, payload, error } = ev.data || {}
      if (type === 'build-unshielding-done') { worker.removeEventListener('message', onMsg as EventListener); resolve(payload) }
      if (type === 'error') { worker.removeEventListener('message', onMsg as EventListener); reject(new Error(error || 'Build unshielding failed')) }
    }
    worker.addEventListener('message', onMsg as EventListener)
    worker.postMessage({ type: 'build-unshielding', payload: {
      account: {
        address: params.toTransparent,
        publicKey: params.accountPublicKey,
      },
      gasConfig: {
        gasToken: params.gas.gasToken,
        gasLimit: params.gas.gasLimit.toString(),
        gasPriceInMinDenom: params.gas.gasPriceInMinDenom.toString(),
      },
      chain: params.chain,
      fromShielded: params.fromShielded,
      toTransparent: params.toTransparent,
      tokenAddress: params.tokenAddress,
      amountInBase: params.amountInBase.toString(),
      memo: params.memo,
    } })
  })
  worker.terminate()
  return result
}

export async function buildIbcBatch(params: IbcParams): Promise<EncodedTxData<IbcTransferProps>> {
  const worker: Worker = new MaspBuildWorker()
  await new Promise<void>((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      const { type, error } = ev.data || {}
      if (type === 'init-done') { worker.removeEventListener('message', onMsg as EventListener); resolve() }
      if (type === 'error') { worker.removeEventListener('message', onMsg as EventListener); reject(new Error(error || 'Worker init failed')) }
    }
    worker.addEventListener('message', onMsg as EventListener)
    // @ts-ignore access
    worker.postMessage({ type: 'init', payload: { rpcUrl: (params.sdk as any).url, token: (params.sdk as any).nativeToken } })
  })

  const result = await new Promise<any>((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      const { type, payload, error } = ev.data || {}
      if (type === 'build-ibc-transfer-done') { worker.removeEventListener('message', onMsg as EventListener); resolve(payload) }
      if (type === 'error') { worker.removeEventListener('message', onMsg as EventListener); reject(new Error(error || 'Build ibc failed')) }
    }
    worker.addEventListener('message', onMsg as EventListener)
    worker.postMessage({ type: 'build-ibc-transfer', payload: {
      account: {
        address: params.ownerAddress,
        publicKey: params.accountPublicKey,
      },
      gasConfig: {
        gasToken: params.gas.gasToken,
        gasLimit: params.gas.gasLimit.toString(),
        gasPriceInMinDenom: params.gas.gasPriceInMinDenom.toString(),
      },
      chain: params.chain,
      source: params.source,
      receiver: params.receiver,
      tokenAddress: params.tokenAddress,
      amountInBase: params.amountInBase.toString(),
      portId: params.portId,
      channelId: params.channelId,
      timeoutHeight: params.timeoutHeight?.toString(),
      timeoutSecOffset: params.timeoutSecOffset?.toString(),
      memo: params.memo,
      refundTarget: params.refundTarget,
      gasSpendingKey: params.gasSpendingKey,
      // maspFeePaymentProps not used for IBC - gasSpendingKey handles fees directly
    } })
  })
  worker.terminate()
  return result
}

type TxForSign = TxMsgValue & { innerTxHashes: string[]; memos: (number[] | null)[] }

export async function signBatchTxs(
  sdk: Sdk,
  txs: TxMsgValue[],
  ownerAddress: string,
  checksums: Record<string, string>,
): Promise<Uint8Array[]> {
  const namada: any = (window as any).namada
  if (!namada) throw new Error('Namada Keychain not available')

  const txsForSigning: TxForSign[] = txs.map((tx) => {
    if ('innerTxHashes' in tx && 'memos' in tx) return tx as TxForSign
    const inner = (sdk as any).tx.getInnerTxMeta(tx.bytes) as [string, number[] | null][]
    return {
      ...tx,
      innerTxHashes: inner.map(([hash]) => hash),
      memos: inner.map(([, memo]) => memo),
    }
  })

  try {
    if (typeof namada.getSigner === 'function') {
      const signer = await namada.getSigner()
      if (!signer) throw new Error('Signer not provided')
      const signed = await signer.sign(txsForSigning, ownerAddress, checksums)
      if (signed) return signed
    }
  } catch {}

  if (typeof namada.sign === 'function') {
    const signed = await namada.sign({ txs: txsForSigning, signer: ownerAddress, checksums })
    if (signed) return signed
  }
  throw new Error('Signing is not supported by the Namada Keychain in this context')
}

export async function buildSignBroadcastUnshieldingIbc(
  ibc: IbcParams, // Simplified to only IBC
  onPhase?: (phase: Phase) => void,
): Promise<{ ibc: { txs: TxMsgValue[]; signed: Uint8Array[]; response: any } }>{
  console.log("ibc params", ibc)
  // Ensure extension is connected to the correct Namada chain before signing
  try {
    const namada: any = (window as any).namada
    const desiredChainId = ibc.chain?.chainId
    if (namada && typeof namada.isConnected === 'function' && typeof namada.connect === 'function' && desiredChainId) {
      const connected = await namada.isConnected(desiredChainId)
      if (!connected) {
        await namada.connect(desiredChainId)
      }
    }
  } catch (e) {
    console.warn('[Debug] Unable to pre-connect Namada extension to chain', e)
  }

  // IBC transfer
  try { onPhase?.('building:ibc') } catch {}
  console.info('[IBC] Build params', {
    ownerAddress: ibc.ownerAddress,
    accountPublicKey: ibc.accountPublicKey?.slice(0, 16) + '...',
    sourceLen: ibc.source?.length,
    receiver: ibc.receiver,
    tokenAddress: ibc.tokenAddress,
    amountInBase: ibc.amountInBase.toString(),
    gas: { token: ibc.gas.gasToken, gasLimit: ibc.gas.gasLimit.toString(), gasPrice: ibc.gas.gasPriceInMinDenom.toString() },
    chain: ibc.chain,
    channelId: ibc.channelId,
    portId: ibc.portId,
    hasMemo: Boolean(ibc.memo),
    memoLen: ibc.memo?.length,
    refundTarget: ibc.refundTarget,
    hasGasSpendingKey: Boolean(ibc.gasSpendingKey),
  })
  const ibcTxData = await buildIbcBatch(ibc)
  const checksumsIbc = await queryChecksums(ibc.sdk)
  try { onPhase?.('signing:ibc') } catch {}
  // Ensure the disposable wrapper signer is persisted so the extension can pay fees from it
  try {
    const namada: any = (window as any).namada
    const signer = await namada?.getSigner?.()
    if (signer && typeof signer.persistDisposableKeypair === 'function') {
      await signer.persistDisposableKeypair(ibc.ownerAddress)
    }
  } catch {}
  const ibcSigned = await signBatchTxs(ibc.sdk, ibcTxData.txs, ibc.ownerAddress, checksumsIbc)
  if (!ibcSigned?.length) throw new Error('IBC signing returned no bytes')
  try { onPhase?.('submitting:ibc') } catch {}
  const ibcResp = await (ibc.sdk as any).rpc.broadcastTx(ibcSigned[0])
  try { onPhase?.('submitted:ibc') } catch {}

  return {
    ibc: { txs: ibcTxData.txs, signed: ibcSigned, response: ibcResp },
  }
}

function getNullable<T>(fn: (() => T) | undefined, fallback?: T): T | undefined {
  try { return fn ? fn() : fallback } catch { return fallback }
}


