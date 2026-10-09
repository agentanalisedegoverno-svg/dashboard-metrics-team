import { create } from 'zustand'
import type { Row } from '@/domain/types'

type State = {
  open: boolean
  title: string
  rows: readonly Row[]
  show: (title: string, rows: readonly Row[]) => void
  close: () => void
}

export const useDrill = create<State>((set) => ({
  open: false,
  title: '',
  rows: [],
  show: (title, rows) => set({ open: true, title, rows }),
  close: () => set({ open: false }),
}))
