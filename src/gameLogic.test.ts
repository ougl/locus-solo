import { describe, expect, it } from 'vitest'
import { CARD_COLORS, CARD_SHAPES, createDeck, GREEN_ENDPOINTS, nextSoloLevel, RED_BLOCKS, SHAPES, soloLevel, WILD_CARD_SHAPES, ZONES } from './gameData'
import { advanceTurn, canPlace, cellKey, cellsForPlacement, ensureOfficialDeck, ensurePlayablePending, hasAnyLegalPlacement, newGame, placePiece, replayStateAt, scores, skipPendingPiece, totalScore, transformedShape } from './gameLogic'
import type { Card } from './types'

describe('moteur solo', () => {
  it('journalise les poses et reconstruit la grille étape par étape', () => {
    const game = newGame(44)
    expect(game.replayVersion).toBe(1)
    expect(game.replay).toEqual([{ type: 'turn', turn: 1, coins: 1, cardIds: game.cards.map((card) => card.id) }])

    game.pending = [{ id: 'replay-piece', shape: 'mono', color: 'red', source: 'bonus', label: 'test' }]
    const placed = placePiece(game, 'red', 0, 0)!
    expect(placed.replay?.at(-1)).toMatchObject({
      type: 'place', turn: 1, zone: 'red', cells: ['0,0'], shape: 'mono', source: 'bonus',
    })
    expect(replayStateAt(placed, 0).zones.red['0,0']).toBeUndefined()
    expect(replayStateAt(placed, placed.replay!.length - 1).zones.red['0,0']).toMatchObject({ source: 'bonus' })
  })

  it('applique les neuf paliers de la carte de score solo', () => {
    expect(soloLevel(99).title).toBe('La galaxie ne t’a pas souri')
    expect(soloLevel(101).title).toBe('Encore un peu de pratique')
    expect(soloLevel(180).title).toBe('Joli score')
    expect(soloLevel(181).title).toBe('Au-dessus de la moyenne')
    expect(soloLevel(251).title).toBe('Hors de ce monde')
    expect(nextSoloLevel(220)?.min).toBe(221)
  })

  it('crée 48 cartes et exactement 16 tours', () => {
    let game = newGame(42)
    expect(game.deck).toHaveLength(48)
    expect(game.cards).toHaveLength(2)
    for (let turn = 1; turn < 16; turn++) game = advanceTurn({ ...game, primaryDone: true })
    expect(game.turn).toBe(16)
    expect(game.deckIndex).toBe(48)
    game = advanceTurn({ ...game, primaryDone: true })
    expect(game.finished).toBe(true)
  })

  it('compose les 48 cartes, dont les quatre paires multicolores, sans aucun carré', () => {
    const deck = createDeck()
    expect(CARD_COLORS).toEqual(['yellow', 'purple', 'red', 'green', 'blue', 'wild'])
    expect(CARD_SHAPES).toEqual(['c5', 't5', 'z5', 'w5', 'f5', 'v5', 'i3', 'l3'])
    for (const color of CARD_COLORS.filter((color) => color !== 'wild')) {
      const cards = deck.filter((card) => card.color === color)
      expect(cards.map((card) => card.shape)).toEqual(CARD_SHAPES)
      expect(cards.filter((card) => card.coin).map((card) => card.shape)).toEqual(['i3', 'l3'])
    }
    const wildCards = deck.filter((card) => card.color === 'wild')
    expect(WILD_CARD_SHAPES).toEqual(['t4', 't4', 'l4', 'l4', 's4', 's4', 'domino', 'domino'])
    expect(wildCards.map((card) => card.shape)).toEqual(WILD_CARD_SHAPES)
    expect(wildCards.filter((card) => card.coin).map((card) => card.shape)).toEqual(['domino', 'domino'])
    expect(CARD_SHAPES.slice(0, 6).map((shape) => SHAPES[shape].length)).toEqual([5, 5, 5, 5, 5, 5])
    expect(SHAPES.z5).toEqual([[1, 0], [2, 0], [1, 1], [0, 2], [1, 2]])
    expect(SHAPES.f5).toEqual([[1, 0], [1, 1], [2, 1], [0, 2], [1, 2]])
    expect(SHAPES.v5).toEqual([[2, 0], [2, 1], [0, 2], [1, 2], [2, 2]])
    expect(deck.filter((card) => card.color !== 'wild' && card.shape === 't5')).toHaveLength(5)
    expect(deck.filter((card) => card.color === 'wild' && card.shape === 't4')).toHaveLength(2)
    expect(deck.some((card) => card.color !== 'wild' && ['s4', 'l4'].includes(card.shape))).toBe(false)
    expect(new Set(deck.map((card) => card.id)).size).toBe(48)
    expect(deck.filter((card) => card.coin)).toHaveLength(12)
    expect(deck.some((card) => String(card.shape) === 'o4')).toBe(false)
  })

  it('migre une ancienne sauvegarde sans effacer la partie', () => {
    const game = newGame(73)
    game.deck[1] = { id: 'yellow-o4', color: 'yellow', shape: 'o4', coin: false } as unknown as Card
    game.cards = [game.deck[1], game.deck[2]]
    game.selectedCardId = game.deck[1].id
    game.zones.yellow['0,5'] = { placementId: 'saved', source: 'card' }
    game.coins = 7

    const migrated = ensureOfficialDeck(game)

    expect(migrated.deck).toHaveLength(48)
    expect(migrated.deck.some((card) => String(card.shape) === 'o4')).toBe(false)
    expect(migrated.cards.some((card) => String(card.shape) === 'o4')).toBe(false)
    expect(migrated.selectedCardId).toBe(migrated.cards[0].id)
    expect(migrated.zones.yellow['0,5']).toEqual({ placementId: 'saved', source: 'card' })
    expect(migrated.coins).toBe(7)
  })

  it('restaure la bonne carte après un ancien remplacement automatique', () => {
    const game = newGame(74)
    const remaining = game.deck[2]
    game.primaryDone = true
    game.cards = [{ ...remaining, id: `${remaining.id}-playable-1-0` }]

    const migrated = ensureOfficialDeck(game)

    expect(migrated.cards).toEqual([remaining])
    expect(migrated.primaryDone).toBe(true)
  })

  it('ne contient aucune combinaison forme/couleur impossible sur une grille vide', () => {
    const game = newGame(42)
    const impossible = createDeck().filter((card) => !hasAnyLegalPlacement(game, card)).map((card) => card.id)
    expect(impossible).toEqual([])
  })

  it('ne retire jamais une carte distribuée selon l’état des grilles', () => {
    const game = newGame(43)
    const secondCard: Card = { id: 'yellow-c5', color: 'yellow', shape: 'c5', coin: false }
    game.cards = [
      { id: 'first', color: 'red', shape: 'i3', coin: false },
      secondCard,
    ]
    game.selectedCardId = 'first'
    for (const cell of ZONES.yellow.mask) game.zones.yellow[cell] = { placementId: 'full', source: 'card' }

    const placed = placePiece(game, 'red', 1, 0)

    expect(placed?.cards).toEqual([secondCard])
  })

  it('normalise toutes les rotations dans des coordonnées positives', () => {
    for (let rotation = 0; rotation < 4; rotation++) {
      const points = transformedShape('l4', rotation, true)
      expect(Math.min(...points.map(([x]) => x))).toBe(0)
      expect(Math.min(...points.map(([, y]) => y))).toBe(0)
      expect(new Set(points.map(([x, y]) => cellKey(x, y))).size).toBe(4)
    }
  })

  it('fait pivoter la forme autour de la case réellement touchée', () => {
    const game = newGame(12)
    game.pending = [{ id: 'pivot', shape: 'c5', color: 'wild', source: 'bonus', label: 'test' }]
    for (let rotation = 0; rotation < 4; rotation++) {
      game.rotation = rotation
      expect(cellsForPlacement(game, 4, 4)).toContainEqual([4, 4])
    }
  })

  it('impose la ligne de départ puis la contiguïté dans les zones jaune et bleue', () => {
    const game = newGame(3)
    game.pending = [{ id: 'yellow-test', shape: 'mono', color: 'yellow', source: 'bonus', label: 'test' }]
    expect(canPlace(game, 'yellow', [[0, 5]])).toBe(true)
    expect(canPlace(game, 'yellow', [[0, 0]])).toBe(false)
    game.zones.yellow['0,5'] = { placementId: 'first-yellow', source: 'bonus' }
    expect(canPlace(game, 'yellow', [[0, 4]])).toBe(true)
    expect(canPlace(game, 'yellow', [[5, 5]])).toBe(false)

    game.pending = [{ id: 'blue-test', shape: 'mono', color: 'blue', source: 'bonus', label: 'test' }]
    expect(canPlace(game, 'blue', [[0, 21]])).toBe(true)
    expect(canPlace(game, 'blue', [[0, 0]])).toBe(false)
    game.zones.blue['0,21'] = { placementId: 'first-blue', source: 'bonus' }
    expect(canPlace(game, 'blue', [[0, 20]])).toBe(true)
    expect(canPlace(game, 'blue', [[2, 21]])).toBe(false)
    expect(ZONES.blue.anchors.has('0,21')).toBe(true)
  })

  it('rend les formes violettes contiguës après une première pose libre', () => {
    const game = newGame(31)
    game.pending = [{ id: 'purple-test', shape: 'mono', color: 'purple', source: 'bonus', label: 'test' }]
    expect(canPlace(game, 'purple', [[2, 2]])).toBe(true)

    game.zones.purple['2,2'] = { placementId: 'first', source: 'bonus' }
    expect(canPlace(game, 'purple', [[3, 2]])).toBe(true)
    expect(canPlace(game, 'purple', [[6, 6]])).toBe(false)
    expect(ZONES.purple.anchors.has('6,6')).toBe(true)
  })

  it('reprend exactement les masques rouge et vert de la feuille', () => {
    expect(RED_BLOCKS.map((block) => block.cells.length)).toEqual([7, 7, 8, 9])
    expect(ZONES.green.mask.size).toBe(31)
    expect(GREEN_ENDPOINTS.size).toBe(7)
    expect(ZONES.green.mask.has('5,2')).toBe(true)
    expect(ZONES.green.mask.has('0,2')).toBe(false)
    expect(ZONES.green.mask.has('4,4')).toBe(false)
    expect(ZONES.green.mask.has('4,8')).toBe(false)
  })

  it('ne place aucun bonus sur une balise épaisse de la zone violette', () => {
    const purpleBonuses = Object.keys(ZONES.purple.bonuses)
    expect(purpleBonuses.filter((cell) => ZONES.purple.anchors.has(cell))).toEqual([])
    expect(ZONES.purple.bonuses['5,4']).toBe('wild')
    expect(ZONES.purple.bonuses['5,3']).toBeUndefined()
  })

  it('place le bonus multicolore bleu dans la colonne centrale', () => {
    expect(ZONES.blue.bonuses['1,7']).toBe('wild')
    expect(ZONES.blue.bonuses['0,7']).toBeUndefined()
  })

  it('écarte un bonus réellement impossible sans bloquer la partie', () => {
    const game = newGame(51)
    for (const cell of ZONES.blue.mask) game.zones.blue[cell] = { placementId: 'full', source: 'card' }
    const bonus = { id: 'blocked-blue', shape: 'domino' as const, color: 'blue' as const, source: 'bonus' as const, label: 'Domino bleu' }
    game.coins = 1
    expect(ensurePlayablePending(game, [bonus])).toEqual([bonus])
    game.coins = 0
    expect(ensurePlayablePending(game, [bonus])).toEqual([])

    const laterBonus = { ...bonus, id: 'later-bonus', color: 'red' as const }
    expect(ensurePlayablePending(game, [bonus, laterBonus])).toEqual([laterBonus])

    game.pending = [bonus]
    game.coins = 4
    const skipped = skipPendingPiece(game)
    expect(skipped.pending).toEqual([])
    expect(skipped.coins).toBe(4)
  })

  it('calcule les cinq familles de score', () => {
    const game = newGame(8)
    for (let x = 0; x < 6; x++) game.zones.yellow[cellKey(x, 5)] = { placementId: 'y', source: 'card' }
    for (let x = 0; x < 7; x++) game.zones.purple[cellKey(x, 0)] = { placementId: 'p', source: 'card' }
    const result = scores(game)
    expect(result.yellow).toBe(8)
    expect(result.purple).toBe(12)
    expect(result.red).toBe(0)
    expect(result.green).toBe(0)
    expect(result.blue).toBe(0)
  })

  it('ajoute deux fois une seule zone de score minimal au total', () => {
    const game = newGame(9)
    for (let x = 0; x < 6; x++) game.zones.yellow[cellKey(x, 5)] = { placementId: 'y', source: 'card' }
    for (let x = 0; x < 7; x++) game.zones.purple[cellKey(x, 0)] = { placementId: 'p', source: 'card' }
    for (const [x, y] of RED_BLOCKS[0].cells) game.zones.red[cellKey(x, y)] = { placementId: 'r', source: 'card' }
    for (const [x, y] of [[3,4],[3,3],[4,3],[4,2],[4,1],[4,0],[3,0]]) {
      game.zones.green[cellKey(x, y)] = { placementId: 'g', source: 'card' }
    }
    game.zones.blue[cellKey(1, 17)] = { placementId: 'b', source: 'card' }

    expect(scores(game)).toEqual({ yellow: 8, purple: 12, red: 12, green: 8, blue: 8 })
    expect(totalScore(game)).toBe(64)
  })
})
