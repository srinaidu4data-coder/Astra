import { cn } from '@/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'

/** Premium pill controls — signature teal primary */
const buttonVariants = cva(
  [
    'inline-flex cursor-pointer items-center justify-center gap-2',
    'rounded-full text-[14px] font-medium tracking-[-0.01em]',
    'transition-[background,box-shadow,color,border-color,transform,opacity] duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5DD5E3]/45',
    'focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0d0f]',
    'disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-40',
    'select-none active:scale-[0.98]',
    'motion-reduce:transition-none motion-reduce:active:scale-100',
  ].join(' '),
  {
    variants: {
      variant: {
        default:
          'bg-[#20B8CD] text-[#041a1e] hover:bg-[#5DD5E3] hover:shadow-[0_4px_20px_rgba(32,184,205,0.35)]',
        secondary:
          'bg-transparent text-[#5DD5E3] border border-[#5DD5E3]/40 hover:bg-[#20B8CD]/12 hover:border-[#5DD5E3]/55',
        ghost:
          'text-white/55 hover:bg-white/[0.06] hover:text-white/90',
        success:
          'bg-[#81c995]/15 text-[#81c995] border border-[#81c995]/35 hover:bg-[#81c995]/22',
        danger:
          'bg-transparent text-[#f28b82] border border-[#f28b82]/40 hover:bg-[#f28b82]/12',
      },
      size: {
        default: 'h-10 min-h-10 px-6 max-md:min-h-11 max-md:h-11',
        sm: 'h-9 px-4 text-[13px] max-md:min-h-10 max-md:h-10',
        lg: 'h-12 px-7 text-[15px] font-semibold max-md:min-h-12 max-md:h-12',
        icon: 'h-10 w-10 max-md:h-11 max-md:w-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({
  className,
  variant,
  size,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}
