import React from 'react'

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
export type SpinnerVariant = 'primary' | 'secondary' | 'accent' | 'muted'

export type SpinnerProps = {
  size?: SpinnerSize
  variant?: SpinnerVariant
  className?: string
}

const sizeClasses: Record<SpinnerSize, string> = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
  xl: 'h-12 w-12',
}

const variantClasses: Record<SpinnerVariant, string> = {
  primary: 'text-[#e7bc59]',
  secondary: 'text-foreground-secondary',
  accent: 'text-accent-yellow',
  muted: 'text-muted-fg',
}

export const Spinner: React.FC<SpinnerProps> = ({ 
  size = 'md', 
  variant = 'primary', 
  className = '' 
}) => {
  return (
    <div 
      className={`
        animate-spin rounded-full border-4 border-current border-t-transparent
        ${sizeClasses[size]}
        ${variantClasses[variant]}
        ${className}
      `}
      role="status"
      aria-label="Loading"
    >
      <span className="sr-only">Loading...</span>
    </div>
  )
}

export default Spinner
