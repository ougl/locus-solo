export type ZoneId = 'yellow' | 'purple' | 'red' | 'green' | 'blue'

export type Point = [number, number]

export type ShapeId = 'mono' | 'domino' | 'i3' | 'l3' | 'l4' | 't4' | 't5' | 's4' | 'c5' | 'z5' | 'w5' | 'f5' | 'v5'

export type BonusKind = 'coin' | 'wild' | 'yellow2' | 'purple2' | 'red2' | 'green2' | 'blue2'

export interface Card {
  id: string
  color: ZoneId | 'wild'
  shape: ShapeId
  coin: boolean
}

export interface PendingPiece {
  id: string
  shape: ShapeId
  color: ZoneId | 'wild'
  source: 'bonus' | 'coin'
  label: string
}

export interface PlacedCell {
  placementId: string
  source: 'card' | 'bonus' | 'coin'
}

export type ZoneCells = Record<string, PlacedCell>

export type ReplayEventType =
  | 'turn'
  | 'select'
  | 'rotate'
  | 'mirror'
  | 'buy-extra'
  | 'cancel-extra'
  | 'wild'
  | 'buy-cells'
  | 'discard'
  | 'place'
  | 'skip'
  | 'finish'

export interface ReplayEvent {
  type: ReplayEventType
  turn: number
  coins: number
  cardId?: string
  cardIds?: string[]
  zone?: ZoneId
  cells?: string[]
  placementId?: string
  shape?: ShapeId
  color?: ZoneId | 'wild'
  source?: PlacedCell['source']
  rotation?: number
  mirrored?: boolean
}

export interface GameState {
  seed: number
  deck: Card[]
  deckIndex: number
  turn: number
  cards: Card[]
  selectedCardId: string | null
  primaryDone: boolean
  extraCardUsed: boolean
  pending: PendingPiece[]
  coins: number
  spentCoins: number
  zones: Record<ZoneId, ZoneCells>
  rotation: number
  mirrored: boolean
  wildMode: boolean
  placementCount: number
  finished: boolean
  message: string
  replayVersion?: 1
  replay?: ReplayEvent[]
}

export interface ZoneDefinition {
  id: ZoneId
  name: string
  tagline: string
  rows: number
  cols: number
  mask: Set<string>
  anchors: Set<string>
  bonuses: Record<string, BonusKind>
}
