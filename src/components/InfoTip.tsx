import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/** Ícone "i" com explicação curta — abre ao clicar, fecha fora/Esc. */
export function InfoTip({ children }: { children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="O que é este número?"
        onClick={(e) => e.stopPropagation()}
        className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line bg-surface-2 text-[10px] font-bold italic text-muted data-[state=open]:border-gold data-[state=open]:bg-gold-soft data-[state=open]:text-gold focus-visible:outline-2 focus-visible:outline-gold"
      >
        i
      </PopoverTrigger>
      <PopoverContent
        align="end"
        onClick={(e) => e.stopPropagation()}
        className="w-[min(220px,60vw)] rounded-lg px-3 py-2.5 text-[11.5px] font-normal normal-case leading-normal tracking-normal text-ink-soft"
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
