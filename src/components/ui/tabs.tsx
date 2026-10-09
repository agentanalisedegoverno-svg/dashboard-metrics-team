import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export const Tabs = TabsPrimitive.Root
export const TabsContent = TabsPrimitive.Content

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('mb-6.5 mt-4.5 flex gap-1 overflow-x-auto border-b border-line pb-0.5', className)} {...props} />
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        '-mb-px cursor-pointer whitespace-nowrap border-b-2 border-transparent px-3.5 py-2.5 text-[13.5px] font-semibold text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-gold data-[state=active]:border-gold data-[state=active]:text-brand-ink max-sm:px-2.5 max-sm:text-[12.5px]',
        className,
      )}
      {...props}
    />
  )
}
