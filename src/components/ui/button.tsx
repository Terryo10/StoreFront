import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-[18px] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-teal text-on-teal hover:bg-teal-hover',
        secondary: 'border border-rule-strong bg-surface text-ink hover:bg-sunk',
        quiet: 'text-ink hover:bg-sunk',
        danger: 'bg-st-rejected text-white hover:opacity-90',
        'danger-outline': 'border border-st-rejected text-st-rejected hover:bg-st-rejected-bg',
      },
      size: {
        md: 'min-h-11 px-4 text-[15px]',
        sm: 'min-h-9 px-3 text-sm',
        lg: 'min-h-14 px-6 text-base',
        icon: 'size-11 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, type, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button'
  return <Comp ref={ref} type={asChild ? undefined : (type ?? 'button')} className={cn(buttonVariants({ variant, size }), className)} {...props} />
})
Button.displayName = 'Button'
