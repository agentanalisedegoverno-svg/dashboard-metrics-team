import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Maximize2, X } from 'lucide-react'
import { useState, type MouseEvent, type ReactNode } from 'react'
import { Card } from './Primitives'

/** Quanto o gráfico cresce na janela ampliada (o usuário não precisa dar zoom). */
const escala = () => (typeof window === 'undefined' ? 1 : window.innerWidth >= 1024 ? 1.6 : window.innerWidth >= 640 ? 1.4 : 1.3)

/**
 * Card de gráfico: ao clicar em qualquer ponto do gráfico, abre uma janela com ele ampliado e um X para voltar.
 * Controles dentro do gráfico (ex.: linha que abre as oportunidades) continuam funcionando do jeito de sempre.
 */
export function CardGrafico({ titulo, className, children }: { titulo: string; className?: string; children: ReactNode }) {
  const [aberto, setAberto] = useState(false)
  const [zoom, setZoom] = useState(1)
  const abrir = () => {
    setZoom(escala())
    setAberto(true)
  }
  const aoClicar = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea, [data-sem-ampliar]')) return
    abrir()
  }
  return (
    <>
      <Card className={className}>
        <div className="-mt-2 mb-1 flex justify-end">
          <button
            type="button"
            onClick={abrir}
            aria-label={`Ampliar gráfico: ${titulo}`}
            title="Ampliar"
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-gold"
          >
            <Maximize2 className="size-4" aria-hidden />
          </button>
        </div>
        {/* O clique no gráfico em si também amplia; o botão acima serve ao teclado e a leitores de tela. */}
        <div onClick={aoClicar} className="cursor-zoom-in">
          {children}
        </div>
      </Card>
      <DialogPrimitive.Root open={aberto} onOpenChange={setAberto}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-110 bg-black/55" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed top-1/2 left-1/2 z-111 flex max-h-[92vh] w-[min(1180px,96vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[14px] border border-line bg-surface shadow-card outline-none"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
              <DialogPrimitive.Title className="font-serif text-lg font-semibold text-ink">{titulo}</DialogPrimitive.Title>
              <DialogPrimitive.Close
                aria-label="Fechar gráfico"
                className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-gold"
              >
                <X className="size-5" aria-hidden />
              </DialogPrimitive.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-5">
              {/* Só leitura: as linhas que abrem listas não são acionáveis aqui, para não empilhar janelas. */}
              <div style={{ zoom }} className="pointer-events-none">
                {children}
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  )
}
