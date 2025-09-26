export type PhaseKind = 'orbiter' | 'send' | 'shield'

const ORBITER_PHASE_MAP: Record<string, string> = {
  'building:ibc': 'Building IBC transfer (Orbiter)',
  'signing:ibc': 'Approve IBC in Keychain',
  'submitting:ibc': 'Submitting IBC transfer...',
  'submitted:ibc': 'IBC submitted',
}

export function getPhaseMessage(kind: PhaseKind, phase: string): string | undefined {
  switch (kind) {
    case 'orbiter':
      return ORBITER_PHASE_MAP[phase]
    case 'send':
      return SEND_PHASE_MAP[phase]
    default:
      return undefined
  }
}

const SEND_PHASE_MAP: Record<string, string> = {
  'building:ibc': 'Building IBC transfer',
  'signing:ibc': 'Approve IBC in Keychain',
  'submitting:ibc': 'Submitting IBC transfer...',
}


