import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
  {
    variants: {
      variant: {
        filter: 'border border-line bg-surface-2 text-ink px-3 py-[7px] hover:bg-line-soft',
        dashed: 'border border-dashed border-line text-muted px-3 py-[7px] hover:text-ink hover:border-muted',
        ghost: 'text-muted hover:text-ink p-1',
      },
    },
    defaultVariants: { variant: 'filter' },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant }), className)} {...props} />
))
Button.displayName = 'Button'
