export type AmountValidation = { isValid: boolean; error: string | null }
export type FormValidation = { isValid: boolean; amountError: string | null; addressError: string | null }

export const validateAmount = (amount: string, availableBalance: string): AmountValidation => {
  if (!amount || amount.trim() === '') {
    return { isValid: false, error: 'Please enter an amount' }
  }
  const numAmount = parseFloat(amount)
  const numAvailable = parseFloat(availableBalance)
  if (isNaN(numAmount) || numAmount <= 0) {
    return { isValid: false, error: 'Please enter a valid amount' }
  }
  if (numAmount > numAvailable) {
    return { isValid: false, error: 'Amount exceeds available balance' }
  }
  return { isValid: true, error: null }
}

export const validateForm = (amount: string, availableBalance: string, address: string): FormValidation => {
  const amountValidation = validateAmount(amount, availableBalance)
  const hasAddress = address && address.trim() !== ''
  return {
    isValid: amountValidation.isValid && hasAddress,
    amountError: amountValidation.error,
    addressError: !hasAddress ? 'Please enter a destination address' : null,
  }
}


