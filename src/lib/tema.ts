import { useCallback, useEffect, useState } from 'react'

export type EscolhaTema = 'sistema' | 'claro' | 'escuro'
const CHAVE = 'radar-tema'

const lerEscolha = (): EscolhaTema => {
  try {
    const v = localStorage.getItem(CHAVE)
    return v === 'claro' || v === 'escuro' ? v : 'sistema'
  } catch {
    return 'sistema'
  }
}

/** Aplica o tema no <html>: 'sistema' acompanha o sistema operacional (inclusive quando ele muda). */
export function aplicaTema(escolha: EscolhaTema) {
  const escuro = escolha === 'escuro' || (escolha === 'sistema' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.setAttribute('data-theme', escuro ? 'dark' : 'light')
}

export function useTema() {
  const [escolha, setEscolha] = useState<EscolhaTema>(lerEscolha)

  const definir = useCallback((nova: EscolhaTema) => {
    setEscolha(nova)
    try {
      if (nova === 'sistema') localStorage.removeItem(CHAVE)
      else localStorage.setItem(CHAVE, nova)
    } catch {
      /* sem armazenamento: vale só nesta sessão */
    }
    aplicaTema(nova)
  }, [])

  // Em "sistema", reage quando o sistema troca de claro para escuro.
  useEffect(() => {
    aplicaTema(escolha)
    if (escolha !== 'sistema') return
    const m = window.matchMedia('(prefers-color-scheme: dark)')
    const f = () => aplicaTema('sistema')
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [escolha])

  return { escolha, definir }
}
