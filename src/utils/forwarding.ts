import { bech32 } from 'bech32'

export function encodeBech32ToBytes32(nobleBech32Address: string): string {
  const decoded = bech32.decode(nobleBech32Address)
  const raw = bech32.fromWords(decoded.words)
  const bytes = new Uint8Array(raw)
  const padded = new Uint8Array(32)
  padded.set(bytes, 32 - bytes.length)
  return '0x' + Array.from(padded).map((b) => b.toString(16).padStart(2, '0')).join('')
}


