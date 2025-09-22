import React from 'react'

export const OutArrowIcon: React.FC<{ className?: string; title?: string }> = ({ className, title }) => (
  <span className={className} title={title}><i className="fas fa-arrow-up-right-from-square" /></span>
)

export const CopyIcon: React.FC<{ className?: string; title?: string }> = ({ className, title }) => (
  <span className={className} title={title}><i className="fas fa-copy" /></span>
)


