import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTitle = DialogPrimitive.Title
export const DialogDescription = DialogPrimitive.Description

export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-100 bg-[rgba(10,14,24,.5)]" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-101 flex max-h-[80vh] w-[calc(100%-40px)] max-w-160 -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] bg-surface shadow-card outline-none',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label="Fechar"
          className="absolute right-3.5 top-3.5 cursor-pointer rounded p-1 text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-gold"
        >
          <X className="size-5" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
