import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer size-4 shrink-0 rounded-[4px] border border-line bg-surface data-[state=checked]:bg-gold data-[state=checked]:border-gold data-[state=indeterminate]:bg-gold data-[state=indeterminate]:border-gold focus-visible:outline-2 focus-visible:outline-gold cursor-pointer',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-[#1a1204]">
        {props.checked === 'indeterminate' ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
