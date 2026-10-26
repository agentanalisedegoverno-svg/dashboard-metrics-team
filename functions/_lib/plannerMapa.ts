/** O mapa Radar -> Planner (planos, buckets, rótulos, progresso, checklist) é UM arquivo só: config/planner-mapa.json. */
import mapaJson from '../../config/planner-mapa.json' with { type: 'json' }
import type { MapaPlanner } from './planner.ts'

export const mapaPlanner = mapaJson as unknown as MapaPlanner
