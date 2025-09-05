import React from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'big-connect' | 'submit' | 'help'
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

function getVariantClasses(variant: ButtonVariant): string {
  switch (variant) {
    case 'help':
      return 'help-button'
    case 'big-connect':
      return 'big-connect-button'
    case 'submit':
      return 'submit-button'
    case 'secondary':
      return 'bg-slate-800 text-slate-100 hover:bg-slate-700 border border-slate-700'
    case 'ghost':
      return 'bg-transparent text-button-text-inactive hover:bg-button-text-inactive/10 border border-button-text-inactive'
    case 'primary':
    default:
      return 'bg-accent-yellow text-button-text-active border border-transparent'
  }
}

function getSizeClasses(size: ButtonSize): string {
  switch (size) {
    case 'xs':
      return 'h-9 px-3 text-xs'
    case 'sm':
      return 'h-9 px-3 text-sm'
    case 'lg':
      return 'h-11 px-6 text-lg'
    case 'md':
    default:
      return 'h-12 px-6 py-2 gap-3'
  }
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  leftIcon,
  rightIcon,
  className,
  children,
  ...props
}) => {
  const base = 'inline-flex items-center justify-center gap-2 rounded-2xl font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-card disabled:opacity-50 disabled:pointer-events-none'
  const classes = `${base} ${getSizeClasses(size)} ${getVariantClasses(variant)} ${className ?? ''}`

  return (
    <button className={classes} {...props}>
      {leftIcon ? <span className="shrink-0">{leftIcon}</span> : null}
      <span>{children}</span>
      {rightIcon ? <span className="shrink-0">{rightIcon}</span> : null}
    </button>
  )
}

export default Button


