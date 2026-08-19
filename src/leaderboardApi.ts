import type { GameState, ZoneId } from './types'

export interface ScoreEntry {
  seed: number
  score: number
  playedAt: string
  breakdown: Record<ZoneId, number>
  playerName: string
  finalState: GameState
}

interface ScoresResponse {
  scores: ScoreEntry[]
  gamesFinished: number
}

export interface SharedScores {
  scores: ScoreEntry[]
  gamesFinished: number | null
}

const zoneIds: ZoneId[] = ['yellow', 'purple', 'red', 'green', 'blue']

export function isScoreEntry(value: unknown): value is ScoreEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<ScoreEntry>
  return Number.isSafeInteger(entry.seed)
    && typeof entry.score === 'number'
    && Number.isFinite(entry.score)
    && typeof entry.playedAt === 'string'
    && typeof entry.playerName === 'string'
    && !!entry.finalState
    && typeof entry.finalState === 'object'
    && !!entry.breakdown
    && typeof entry.breakdown === 'object'
    && zoneIds.every((zone) => typeof entry.breakdown?.[zone] === 'number')
}

async function readScores(response: Response): Promise<SharedScores> {
  if (!response.ok) throw new Error(`Le serveur de scores a répondu ${response.status}.`)
  const data = await response.json() as Partial<ScoresResponse>
  if (!Array.isArray(data.scores)) throw new Error('Réponse du classement invalide.')
  return {
    scores: data.scores.filter(isScoreEntry).slice(0, 10),
    gamesFinished: typeof data.gamesFinished === 'number' && Number.isFinite(data.gamesFinished)
      ? data.gamesFinished
      : null,
  }
}

export async function fetchSharedScores(signal?: AbortSignal) {
  return readScores(await fetch('/api/scores', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal,
  }))
}

export async function saveSharedScore(playerName: string, finalState: GameState) {
  return readScores(await fetch('/api/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ playerName, seed: finalState.seed, finalState }),
  }))
}

/** Compte la partie terminée, que le joueur enregistre son score ou non. */
export async function reportFinishedGame(finalState: GameState) {
  const response = await fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ seed: finalState.seed, finalState }),
  })
  if (!response.ok) throw new Error(`Le serveur a répondu ${response.status}.`)
  const data = await response.json() as { gamesFinished?: unknown }
  return typeof data.gamesFinished === 'number' && Number.isFinite(data.gamesFinished)
    ? data.gamesFinished
    : null
}
