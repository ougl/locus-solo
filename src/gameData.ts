import type { BonusKind, Card, Point, ShapeId, ZoneDefinition, ZoneId } from './types'

export const ZONE_META: Record<ZoneId, { name: string; color: string; ink: string }> = {
  yellow: { name: 'Solaire', color: '#f4c95d', ink: '#6d4d00' },
  purple: { name: 'Constellation', color: '#a88bd4', ink: '#44305f' },
  red: { name: 'Quartiers', color: '#ef857d', ink: '#6a2522' },
  green: { name: 'Sentiers', color: '#78bd92', ink: '#214e33' },
  blue: { name: 'Ascension', color: '#72acd6', ink: '#173e5c' },
}

export const SHAPES: Record<ShapeId, Point[]> = {
  mono: [[0, 0]],
  domino: [[0, 0], [1, 0]],
  i3: [[0, 0], [1, 0], [2, 0]],
  l3: [[0, 0], [0, 1], [1, 1]],
  l4: [[0, 0], [0, 1], [0, 2], [1, 2]],
  t4: [[0, 0], [1, 0], [2, 0], [1, 1]],
  t5: [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]],
  s4: [[1, 0], [2, 0], [0, 1], [1, 1]],
  c5: [[0, 0], [1, 0], [0, 1], [0, 2], [1, 2]],
  z5: [[1, 0], [2, 0], [1, 1], [0, 2], [1, 2]],
  w5: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]],
  f5: [[1, 0], [1, 1], [2, 1], [0, 2], [1, 2]],
  v5: [[2, 0], [2, 1], [0, 2], [1, 2], [2, 2]],
}

export const SHAPE_NAMES: Record<ShapeId, string> = {
  mono: 'point', domino: 'duo', i3: 'ligne 3', l3: 'angle 3', l4: 'angle 4',
  t4: 'T de 4', t5: 'T de 5', s4: 'N de 4', c5: 'U de 5', z5: 'Z de 5',
  w5: 'W de 5', f5: 'F de 5', v5: 'V de 5',
}

const key = (x: number, y: number) => `${x},${y}`
const rectangle = (cols: number, rows: number) =>
  new Set(Array.from({ length: cols * rows }, (_, i) => key(i % cols, Math.floor(i / cols))))

const fromPoints = (points: Point[]) => new Set(points.map(([x, y]) => key(x, y)))

const redBlocks = [
  { cells: [[0,0],[1,0],[2,0],[0,1],[1,1],[1,2],[2,2]] as Point[], points: 12 },
  { cells: [[5,0],[6,0],[5,1],[6,1],[5,2],[6,2],[7,2]] as Point[], points: 12 },
  { cells: [[2,4],[0,5],[1,5],[2,5],[1,6],[2,6],[1,7],[2,7]] as Point[], points: 14 },
  { cells: [[5,4],[7,4],[5,5],[6,5],[7,5],[5,6],[6,6],[7,6],[5,7]] as Point[], points: 16 },
]
const redMask = fromPoints(redBlocks.flatMap((block) => block.cells))

const greenPoints: Point[] = [
  [3,0],[4,0],
  [0,1],[1,1],[4,1],[6,1],
  [1,2],[4,2],[5,2],[6,2],
  [0,3],[1,3],[2,3],[3,3],[4,3],
  [0,4],[3,4],
  [0,5],[3,5],[4,5],[5,5],
  [2,6],[3,6],[5,6],[6,6],
  [0,7],[1,7],[2,7],[6,7],
  [2,8],[3,8],
]
const greenMask = fromPoints(greenPoints)

function bonuses(entries: Array<[number, number, BonusKind]>) {
  return Object.fromEntries(entries.map(([x, y, value]) => [key(x, y), value]))
}

export const ZONES: Record<ZoneId, ZoneDefinition> = {
  yellow: {
    id: 'yellow', name: 'Solaire', tagline: 'Complétez des lignes', rows: 6, cols: 6,
    mask: rectangle(6, 6), anchors: fromPoints([[0,5],[1,5],[2,5],[3,5],[4,5],[5,5]]),
    bonuses: bonuses([[2,0,'purple2'],[5,0,'coin'],[0,1,'wild'],[4,2,'blue2'],[1,3,'green2'],[5,4,'red2'],[3,5,'coin']]),
  },
  purple: {
    id: 'purple', name: 'Constellation', tagline: 'Reliez les balises', rows: 7, cols: 7,
    mask: rectangle(7, 7), anchors: fromPoints([[0,0],[6,0],[3,1],[1,3],[5,3],[3,5],[0,6],[6,6]]),
    bonuses: bonuses([[5,0,'coin'],[1,1,'yellow2'],[6,1,'red2'],[3,2,'blue2'],[5,4,'wild'],[0,4,'green2'],[3,6,'coin']]),
  },
  red: {
    id: 'red', name: 'Quartiers', tagline: 'Terminez les quatre îlots', rows: 8, cols: 8,
    mask: redMask, anchors: new Set(),
    bonuses: bonuses([[0,1,'yellow2'],[5,0,'coin'],[7,2,'wild'],[0,5,'purple2'],[2,7,'coin'],[5,4,'blue2'],[7,6,'green2']]),
  },
  green: {
    id: 'green', name: 'Sentiers', tagline: 'Reliez le centre aux huit sorties', rows: 9, cols: 7,
    mask: greenMask, anchors: new Set([key(3, 4)]),
    bonuses: bonuses([[1,2,'red2'],[6,2,'yellow2'],[4,3,'coin'],[0,4,'wild'],[5,5,'purple2'],[3,6,'coin'],[1,7,'blue2']]),
  },
  blue: {
    id: 'blue', name: 'Ascension', tagline: 'Grimpez les 22 rangées', rows: 22, cols: 3,
    mask: rectangle(3, 22), anchors: fromPoints([[0,21],[1,21],[2,21]]),
    bonuses: bonuses([[0,1,'red2'],[2,4,'purple2'],[1,7,'wild'],[0,10,'coin'],[2,12,'green2'],[0,15,'yellow2'],[1,19,'coin']]),
  },
}

export const CARD_COLORS: Array<ZoneId | 'wild'> = ['yellow', 'purple', 'red', 'green', 'blue', 'wild']
export const CARD_SHAPES: ShapeId[] = ['c5', 't5', 'z5', 'w5', 'f5', 'v5', 'i3', 'l3']
export const WILD_CARD_SHAPES: ShapeId[] = ['t4', 't4', 'l4', 'l4', 's4', 's4', 'domino', 'domino']
const COIN_CARD_SHAPES = new Set<ShapeId>(['i3', 'l3'])

/** Paquet de 48 cartes : 8 formes par zone et 8 multicolores en quatre paires. */
export function createDeck(): Card[] {
  const zoneCards = CARD_COLORS
    .filter((color): color is ZoneId => color !== 'wild')
    .flatMap((color) => CARD_SHAPES.map((shape) => ({
      id: `${color}-${shape}`,
      color,
      shape,
      coin: COIN_CARD_SHAPES.has(shape),
    })))

  const wildCards = WILD_CARD_SHAPES.map((shape, index) => ({
    id: `wild-${shape}-${(index % 2) + 1}`,
    color: 'wild' as const,
    shape,
    coin: shape === 'domino',
  }))

  return [...zoneCards, ...wildCards]
}

export const YELLOW_ROW_POINTS = [12, 12, 12, 10, 10, 8]
export const PURPLE_POINTS = [0, 0, 12, 18, 24, 30, 36, 42, 48]
export const RED_BLOCKS = redBlocks

export const GREEN_ENDPOINTS = fromPoints([[3,0],[0,1],[6,1],[0,5],[0,7],[3,8],[6,7]])

export interface SoloLevel {
  min: number
  max?: number
  title: string
  message: string
  stars: number
}

/** Barème de la carte de score solo, traduit en français. */
export const SOLO_LEVELS: SoloLevel[] = [
  { min: 251, title: 'Hors de ce monde', message: 'Tu ne viens clairement pas de cette planète.', stars: 5 },
  { min: 241, max: 250, title: 'Exploit cosmique', message: 'Quelle performance !', stars: 5 },
  { min: 221, max: 240, title: 'Score magnifique', message: 'Une partie presque parfaite.', stars: 4 },
  { min: 201, max: 220, title: 'Chapeau bas', message: 'Voilà une constellation remarquable.', stars: 4 },
  { min: 181, max: 200, title: 'Au-dessus de la moyenne', message: 'Tu maîtrises vraiment les formes.', stars: 3 },
  { min: 141, max: 180, title: 'Joli score', message: 'Une belle traversée de la grille.', stars: 3 },
  { min: 121, max: 140, title: 'Tu peux faire mieux', message: 'Le prochain palier est à portée de main.', stars: 2 },
  { min: 101, max: 120, title: 'Encore un peu de pratique', message: 'Chaque partie révèle de nouveaux chemins.', stars: 2 },
  { min: 0, max: 100, title: 'La galaxie ne t’a pas souri', message: 'Repars à la conquête des formes.', stars: 1 },
]

export function soloLevel(score: number) {
  return SOLO_LEVELS.find((level) => score >= level.min) ?? SOLO_LEVELS.at(-1)!
}

export function nextSoloLevel(score: number) {
  return [...SOLO_LEVELS].reverse().find((level) => level.min > score)
}
