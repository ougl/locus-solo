import { createDeck, GREEN_ENDPOINTS, PURPLE_POINTS, RED_BLOCKS, SHAPES, YELLOW_ROW_POINTS, ZONES } from './gameData'
import type { Card, GameState, PendingPiece, Point, ReplayEvent, ShapeId, ZoneId } from './types'

export const cellKey = (x: number, y: number) => `${x},${y}`

function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value += 0x6D2B79F5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(items: T[], seed: number) {
  const result = [...items]
  const random = seededRandom(seed)
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function ensurePlayablePending(state: GameState, pending: PendingPiece[]) {
  const playableFrom = pending.findIndex((piece, index) => {
    const color = index === 0 && state.wildMode ? 'wild' : piece.color
    const card = { id: piece.id, shape: piece.shape, color, coin: false }
    if (hasAnyLegalPlacement(state, card)) return true
    return color !== 'wild' && state.coins >= 1
      && hasAnyLegalPlacement(state, { ...card, color: 'wild' })
  })
  return playableFrom < 0 ? [] : pending.slice(playableFrom)
}

export function newGame(seed = Date.now()): GameState {
  const deck = shuffled(createDeck(), seed)
  const state: GameState = {
    seed, deck, deckIndex: 3, turn: 1, cards: [], selectedCardId: null,
    primaryDone: false, extraCardUsed: false, pending: [], coins: 1, spentCoins: 0,
    zones: { yellow: {}, purple: {}, red: {}, green: {}, blue: {} },
    rotation: 0, mirrored: false, wildMode: false, placementCount: 0,
    finished: false, message: 'Choisissez une carte, puis posez sa forme.',
    replayVersion: 1, replay: [],
  }
  state.cards = deck.slice(1, 3)
  recordReplayEvent(state, { type: 'turn', cardIds: state.cards.map((card) => card.id) })
  return state
}

export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState
}

export function recordReplayEvent(state: GameState, event: Omit<ReplayEvent, 'turn' | 'coins'>) {
  if (state.replayVersion !== 1 || !Array.isArray(state.replay)) return
  if (state.replay.length >= 480 && (event.type === 'rotate' || event.type === 'mirror')) return
  while (state.replay.length >= 499) {
    const expendable = state.replay.findIndex((item) => item.type === 'rotate' || item.type === 'mirror')
    if (expendable < 0) return
    state.replay.splice(expendable, 1)
  }
  state.replay.push({ ...event, turn: state.turn, coins: state.coins })
}

export function replayStateAt(finalState: GameState, eventIndex: number): GameState {
  const replay = finalState.replayVersion === 1 && Array.isArray(finalState.replay) ? finalState.replay : []
  if (!replay.length) return cloneState(finalState)
  const visibleEvents = replay.slice(0, Math.max(0, Math.min(eventIndex, replay.length - 1)) + 1)
  const next = cloneState(finalState)
  next.zones = { yellow: {}, purple: {}, red: {}, green: {}, blue: {} }
  next.finished = false

  for (const event of visibleEvents) {
    if (event.type !== 'place' || !event.zone || !event.placementId || !event.cells) continue
    for (const cell of event.cells) {
      if (!ZONES[event.zone].mask.has(cell)) continue
      next.zones[event.zone][cell] = {
        placementId: event.placementId,
        source: event.source ?? 'card',
      }
    }
  }

  const current = visibleEvents.at(-1)
  next.turn = current?.turn ?? 1
  next.coins = current?.coins ?? 1
  next.finished = current?.type === 'finish'
  return next
}

function isOfficialCard(card: Card, catalogue: Map<string, Card>) {
  const expected = catalogue.get(card.id)
  return expected?.color === card.color
    && expected.shape === card.shape
    && expected.coin === card.coin
}

/** Met à niveau les parties créées avec une ancienne composition du paquet. */
export function ensureOfficialDeck(state: GameState): GameState {
  const reference = createDeck()
  const catalogue = new Map(reference.map((card) => [card.id, card]))
  const deckIsOfficial = state.deck.length === reference.length
    && new Set(state.deck.map((card) => card.id)).size === reference.length
    && state.deck.every((card) => isOfficialCard(card, catalogue))
  const visibleCardsAreOfficial = state.cards.every((card) => isOfficialCard(card, catalogue))
  if (deckIsOfficial && visibleCardsAreOfficial) return state

  const next = cloneState(state)
  const oldDeck = state.deck ?? []
  const officialDeck = shuffled(reference, state.seed)
  const visibleSlots = [Math.max(0, state.deckIndex - 2), Math.max(0, state.deckIndex - 1)]
  const selectedIndex = state.cards.findIndex((card) => card.id === state.selectedCardId)

  next.cards = state.cards.flatMap((card, index) => {
    const oldSlot = oldDeck.findIndex((deckCard) =>
      deckCard.id === card.id || card.id.startsWith(`${deckCard.id}-playable-`),
    )
    const fallbackSlot = visibleSlots[Math.min(index, visibleSlots.length - 1)]
    const replacement = officialDeck[oldSlot >= 0 ? oldSlot : fallbackSlot]
    return replacement ? [{ ...replacement }] : []
  })
  next.deck = officialDeck
  next.deckIndex = Math.min(next.deckIndex, officialDeck.length)
  next.selectedCardId = selectedIndex >= 0 ? next.cards[selectedIndex]?.id ?? null : null
  next.rotation = 0
  next.mirrored = false
  if (!next.finished) {
    next.message = 'Ancienne sauvegarde mise à jour : le paquet officiel sans carré est maintenant utilisé.'
  }
  return next
}

function normalize(points: Point[]): Point[] {
  const minX = Math.min(...points.map(([x]) => x))
  const minY = Math.min(...points.map(([, y]) => y))
  return points.map(([x, y]) => [x - minX, y - minY] as Point).sort(([ax, ay], [bx, by]) => ay - by || ax - bx)
}

export function transformedShape(shape: ShapeId, rotation: number, mirrored: boolean): Point[] {
  let points = SHAPES[shape].map(([x, y]) => [mirrored ? -x : x, y] as Point)
  for (let i = 0; i < rotation % 4; i++) points = points.map(([x, y]) => [-y, x])
  return normalize(points)
}

function shapePivot(points: Point[]): Point {
  const centerX = points.reduce((sum, [x]) => sum + x, 0) / points.length
  const centerY = points.reduce((sum, [, y]) => sum + y, 0) / points.length
  return [...points].sort(([ax, ay], [bx, by]) =>
    ((ax - centerX) ** 2 + (ay - centerY) ** 2) - ((bx - centerX) ** 2 + (by - centerY) ** 2),
  )[0]
}

export function activePiece(state: GameState): PendingPiece | Card | null {
  if (state.pending.length) return state.pending[0]
  return state.cards.find((card) => card.id === state.selectedCardId) ?? null
}

export function allowedZones(state: GameState): ZoneId[] {
  const piece = activePiece(state)
  if (!piece) return []
  const color = state.wildMode ? 'wild' : piece.color
  return color === 'wild' ? ['yellow', 'purple', 'red', 'green', 'blue'] : [color]
}

export function cellsForPlacement(state: GameState, x: number, y: number): Point[] {
  const piece = activePiece(state)
  if (!piece) return []
  const points = transformedShape(piece.shape, state.rotation, state.mirrored)
  const [pivotX, pivotY] = shapePivot(points)
  return points.map(([dx, dy]) => [x + dx - pivotX, y + dy - pivotY])
}

export function canPlace(state: GameState, zoneId: ZoneId, cells: Point[]) {
  if (!activePiece(state) || !allowedZones(state).includes(zoneId)) return false
  const zone = ZONES[zoneId]
  const occupied = state.zones[zoneId]
  if (!cells.length || cells.some(([x, y]) => !zone.mask.has(cellKey(x, y)) || occupied[cellKey(x, y)])) return false
  if (zoneId === 'red') return true
  const touchesOccupied = cells.some(([x, y]) =>
    [[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dy]) => occupied[cellKey(x + dx, y + dy)]),
  )
  const zoneIsEmpty = Object.keys(occupied).length === 0
  if (zoneId === 'purple') return zoneIsEmpty || touchesOccupied
  if (zoneId === 'yellow' || zoneId === 'blue') {
    return zoneIsEmpty
      ? cells.some(([x, y]) => zone.anchors.has(cellKey(x, y)))
      : touchesOccupied
  }
  return cells.some(([x, y]) => {
    if (zone.anchors.has(cellKey(x, y))) return true
    return [[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dy]) => occupied[cellKey(x + dx, y + dy)])
  })
}

export function placePiece(state: GameState, zoneId: ZoneId, x: number, y: number): GameState | null {
  const cells = cellsForPlacement(state, x, y)
  if (!canPlace(state, zoneId, cells)) return null
  const next = cloneState(state)
  const piece = activePiece(state)!
  const placementId = `p${next.placementCount + 1}`
  const placementSource = 'source' in piece ? piece.source : 'card'
  next.placementCount += 1
  cells.forEach(([cx, cy]) => {
    next.zones[zoneId][cellKey(cx, cy)] = {
      placementId,
      source: placementSource,
    }
  })

  const earned: PendingPiece[] = []
  cells.forEach(([cx, cy]) => {
    const bonus = ZONES[zoneId].bonuses[cellKey(cx, cy)]
    if (bonus === 'coin') next.coins += 1
    if (bonus === 'wild') earned.push({ id: `b-${placementId}-${cx}-${cy}`, shape: 'mono', color: 'wild', source: 'bonus', label: 'Case bonus' })
    if (bonus?.endsWith('2')) {
      const color = bonus.slice(0, -1) as ZoneId
      const names: Record<ZoneId, string> = { yellow: 'jaune', purple: 'violet', red: 'rouge', green: 'vert', blue: 'bleu' }
      earned.push({ id: `b-${placementId}-${cx}-${cy}`, shape: 'domino', color, source: 'bonus', label: `Domino ${names[color]}` })
    }
  })

  if ('source' in piece) {
    next.pending.shift()
  } else {
    if (piece.coin) next.coins += 1
    next.cards = next.cards.filter((card) => card.id !== piece.id)
    next.selectedCardId = null
    if (!next.primaryDone) next.primaryDone = true
  }
  next.pending.push(...earned)
  next.wildMode = false
  const pendingBeforeValidation = next.pending.length
  next.pending = ensurePlayablePending(next, next.pending)
  const skippedImpossibleBonus = next.pending.length < pendingBeforeValidation
  next.rotation = 0
  next.mirrored = false
  next.message = next.pending.length
    ? `Bonus obtenu : ${next.pending[0].label}. Placez-le maintenant.`
    : skippedImpossibleBonus
      ? 'Bonus obtenu, mais aucune pose n’était possible : il a été ignoré.'
    : next.primaryDone && next.cards.length
      ? 'Forme posée. Jouez la seconde carte pour 3 pièces ou terminez le tour.'
      : 'Forme posée. Vous pouvez terminer le tour.'
  recordReplayEvent(next, {
    type: 'place',
    zone: zoneId,
    cells: cells.map(([cx, cy]) => cellKey(cx, cy)),
    placementId,
    shape: piece.shape,
    color: state.wildMode ? 'wild' : piece.color,
    source: placementSource,
    rotation: state.rotation,
    mirrored: state.mirrored,
    cardId: piece.id,
  })
  return next
}

export function skipPendingPiece(state: GameState): GameState {
  if (!state.pending.length) return state
  const next = cloneState(state)
  const skipped = next.pending[0]
  next.pending.shift()
  next.rotation = 0
  next.mirrored = false
  next.wildMode = false
  next.message = next.pending.length
    ? `Bonus suivant : ${next.pending[0].label}. Placez-le ou ignorez-le.`
    : 'Bonus ignoré. Vous pouvez poursuivre votre tour.'
  recordReplayEvent(next, {
    type: 'skip', cardId: skipped.id, shape: skipped.shape, color: skipped.color, source: skipped.source,
  })
  return next
}

export function advanceTurn(state: GameState): GameState {
  const next = cloneState(state)
  if (next.deckIndex >= next.deck.length) {
    next.finished = true
    next.cards = []
    next.selectedCardId = null
    next.message = 'Partie terminée ! Voici votre score.'
    recordReplayEvent(next, { type: 'finish' })
    return next
  }
  const start = next.deckIndex
  next.deckIndex = Math.min(start + 3, next.deck.length)
  next.turn += 1
  next.selectedCardId = null
  next.primaryDone = false
  next.extraCardUsed = false
  next.pending = []
  next.rotation = 0
  next.mirrored = false
  next.wildMode = false
  next.cards = next.deck.slice(start + 1, start + 3)
  next.message = 'Une carte a été écartée. Choisissez parmi les deux révélées.'
  recordReplayEvent(next, { type: 'turn', cardIds: next.cards.map((card) => card.id) })
  return next
}

export function hasAnyLegalPlacement(state: GameState, card: Card) {
  const probe = cloneState(state)
  probe.selectedCardId = card.id
  if (!probe.cards.some((item) => item.id === card.id)) probe.cards.push(card)
  probe.pending = []
  probe.wildMode = false
  for (const mirrored of [false, true]) {
    for (let rotation = 0; rotation < 4; rotation++) {
      probe.mirrored = mirrored
      probe.rotation = rotation
      for (const zoneId of allowedZones(probe)) {
        const zone = ZONES[zoneId]
        for (let y = 0; y < zone.rows; y++) {
          for (let x = 0; x < zone.cols; x++) {
            const cells = cellsForPlacement(probe, x, y)
            if (canPlace(probe, zoneId, cells)) return true
          }
        }
      }
    }
  }
  return false
}

const occupiedSet = (state: GameState, zone: ZoneId) => new Set(Object.keys(state.zones[zone]))

function component(start: string, occupied: Set<string>) {
  if (!occupied.has(start)) return new Set<string>()
  const found = new Set([start])
  const queue = [start]
  while (queue.length) {
    const current = queue.shift()!
    const [x, y] = current.split(',').map(Number)
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const neighbor = cellKey(x + dx, y + dy)
      if (occupied.has(neighbor) && !found.has(neighbor)) { found.add(neighbor); queue.push(neighbor) }
    }
  }
  return found
}

export function connectedCells(state: GameState, zone: ZoneId, start: string) {
  return component(start, occupiedSet(state, zone))
}

export function scores(state: GameState): Record<ZoneId, number> {
  const yellow = occupiedSet(state, 'yellow')
  const yellowScore = YELLOW_ROW_POINTS.reduce((sum, value, row) =>
    Array.from({ length: ZONES.yellow.cols }, (_, x) => cellKey(x, row)).every((cell) => yellow.has(cell)) ? sum + value : sum, 0)

  const purple = occupiedSet(state, 'purple')
  let mostAnchors = 0
  const visited = new Set<string>()
  for (const cell of purple) {
    if (visited.has(cell)) continue
    const group = component(cell, purple)
    group.forEach((item) => visited.add(item))
    mostAnchors = Math.max(mostAnchors, [...ZONES.purple.anchors].filter((anchor) => group.has(anchor)).length)
  }
  const purpleScore = PURPLE_POINTS[Math.min(mostAnchors, PURPLE_POINTS.length - 1)]

  const red = occupiedSet(state, 'red')
  const redScore = RED_BLOCKS.reduce((sum, block) =>
    block.cells.every(([x, y]) => red.has(cellKey(x, y))) ? sum + block.points : sum, 0)

  const green = occupiedSet(state, 'green')
  const greenConnected = component(cellKey(3, 4), green)
  const greenScore = [...GREEN_ENDPOINTS].filter((endpoint) => greenConnected.has(endpoint)).length * 8

  const blue = occupiedSet(state, 'blue')
  const minRow = blue.size ? Math.min(...[...blue].map((cell) => Number(cell.split(',')[1]))) : 22
  const blueScore = minRow <= 0 ? 50 : minRow <= 3 ? 40 : minRow <= 6 ? 32 : minRow <= 9 ? 24 : minRow <= 13 ? 16 : minRow <= 17 ? 8 : 0

  return { yellow: yellowScore, purple: purpleScore, red: redScore, green: greenScore, blue: blueScore }
}

export function totalScore(state: GameState) {
  const values = Object.values(scores(state))
  return values.reduce((sum, score) => sum + score, 0) + (2 * Math.min(...values))
}

const MAX_ZONE_SCORES = [
  YELLOW_ROW_POINTS.reduce((sum, score) => sum + score, 0),
  Math.max(...PURPLE_POINTS),
  RED_BLOCKS.reduce((sum, block) => sum + block.points, 0),
  GREEN_ENDPOINTS.size * 8,
  50,
]

export const MAX_TOTAL_SCORE = MAX_ZONE_SCORES.reduce((sum, score) => sum + score, 0)
  + (2 * Math.min(...MAX_ZONE_SCORES))
