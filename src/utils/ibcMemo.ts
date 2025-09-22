
export type CctpMemoParams = {
  destinationDomain: number
  evmRecipientHex20: string
  evmCallerHex20?: string
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0) throw new Error('Invalid hex string length')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export function leftPadTo32Bytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length > 32) throw new Error('Value longer than 32 bytes')
  const out = new Uint8Array(32)
  out.set(bytes, 32 - bytes.length)
  return out
}

export function base64Encode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  // btoa is available in browsers; for non-browser contexts, callers should polyfill.
  return btoa(binary)
}

export function evmHex20ToBase64_32(evmHex20: string): string {
  const bytes = hexToBytes(evmHex20)
  const padded = leftPadTo32Bytes(bytes)
  return base64Encode(padded)
}

export function buildOrbiterCctpMemo(params: CctpMemoParams): string {
  const { destinationDomain, evmRecipientHex20, evmCallerHex20 } = params
  const recipientBytes = leftPadTo32Bytes(hexToBytes(evmRecipientHex20))
  const recipientB64 = base64Encode(recipientBytes)
  
  // Get destination caller from env var or use provided caller
  const envCallerHex = (import.meta.env.VITE_PAYMENT_DESTINATION_CALLER as string) || ''
  const callerHex = evmCallerHex20 && evmCallerHex20.length > 0 
    ? evmCallerHex20 
    : envCallerHex
  
  const callerB64 = callerHex && callerHex.length > 0
    ? base64Encode(leftPadTo32Bytes(hexToBytes(callerHex)))
    : ''

  const memo = {
    orbiter: {
      forwarding: {
        protocol_id: 'PROTOCOL_CCTP',
        attributes: {
          '@type': '/noble.orbiter.controller.forwarding.v1.CCTPAttributes',
          destination_domain: destinationDomain,
          mint_recipient: recipientB64,
          destination_caller: callerB64,
        },
        passthrough_payload: '' as string,
      },
    },
  }
  return JSON.stringify(memo)
}


