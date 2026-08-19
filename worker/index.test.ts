import { describe, expect, it } from 'vitest'
import { advanceTurn, newGame } from '../src/gameLogic'
import { cleanName, isPlausibleFinalState } from './index'

describe('API du classement partagé', () => {
  it('nettoie et limite les noms reçus', () => {
    expect(cleanName('  Alice   du   Cosmos  ')).toBe('Alice du Cosmos')
    expect(cleanName('1234567890123456789012345')).toHaveLength(20)
    expect(cleanName(null)).toBe('')
  })

  it('accepte uniquement une partie terminée avec le bon identifiant', () => {
    let game = newGame(123)
    expect(isPlausibleFinalState(game, 123)).toBe(false)

    for (let index = 0; index < 16; index++) game = advanceTurn(game)
    expect(isPlausibleFinalState(game, 123)).toBe(true)
    expect(isPlausibleFinalState(game, 456)).toBe(false)
  })
})
