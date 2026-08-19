import { MAX_TOTAL_SCORE, scores, totalScore } from '../src/gameLogic'
import type { GameState, ReplayEvent, ReplayEventType, ZoneId } from '../src/types'

interface Env {
  ASSETS: Fetcher
  DB: D1Database
}

interface ScoreRow {
  seed: number
  player_name: string
  score: number
  played_at: string
  breakdown: string
  final_state: string
}

interface ScoreSubmission {
  playerName?: unknown
  seed?: unknown
  finalState?: unknown
}

const jsonHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders })
}

export function cleanName(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 20)
}

function isZoneCells(value: unknown) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const replayEventTypes = new Set<ReplayEventType>([
  'turn', 'select', 'rotate', 'mirror', 'buy-extra', 'cancel-extra', 'wild',
  'buy-cells', 'discard', 'place', 'skip', 'finish',
])

function isPlausibleReplayEvent(value: unknown): value is ReplayEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<ReplayEvent>
  if (!event.type || !replayEventTypes.has(event.type)) return false
  if (!Number.isInteger(event.turn) || event.turn! < 1 || event.turn! > 16) return false
  if (!Number.isInteger(event.coins) || event.coins! < 0 || event.coins! > 100) return false
  if (event.cardId !== undefined && (typeof event.cardId !== 'string' || event.cardId.length > 80)) return false
  if (event.cardIds !== undefined && (!Array.isArray(event.cardIds) || event.cardIds.length > 2 || event.cardIds.some((id) => typeof id !== 'string' || id.length > 80))) return false
  if (event.cells !== undefined && (!Array.isArray(event.cells) || event.cells.length > 5 || event.cells.some((cell) => typeof cell !== 'string' || !/^\d{1,2},\d{1,2}$/.test(cell)))) return false
  if (event.zone !== undefined && !['yellow', 'purple', 'red', 'green', 'blue'].includes(event.zone)) return false
  if (event.placementId !== undefined && (typeof event.placementId !== 'string' || event.placementId.length > 20)) return false
  return true
}

function hasPlausibleReplay(state: Partial<GameState>) {
  if (state.replayVersion === undefined && state.replay === undefined) return true
  return state.replayVersion === 1
    && Array.isArray(state.replay)
    && state.replay.length >= 2
    && state.replay.length <= 500
    && state.replay.every(isPlausibleReplayEvent)
    && state.replay.at(-1)?.type === 'finish'
}

export function isPlausibleFinalState(value: unknown, seed: number): value is GameState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<GameState>
  const zones = state.zones as Partial<Record<ZoneId, unknown>> | undefined
  return state.seed === seed
    && state.finished === true
    && Number.isSafeInteger(state.turn)
    && state.turn === 16
    && !!zones
    && isZoneCells(zones.yellow)
    && isZoneCells(zones.purple)
    && isZoneCells(zones.red)
    && isZoneCells(zones.green)
    && isZoneCells(zones.blue)
    && hasPlausibleReplay(state)
}

function rowToEntry(row: ScoreRow) {
  return {
    seed: row.seed,
    playerName: row.player_name,
    score: row.score,
    playedAt: row.played_at,
    breakdown: JSON.parse(row.breakdown) as Record<ZoneId, number>,
    finalState: JSON.parse(row.final_state) as GameState,
  }
}

async function gamesFinished(db: D1Database) {
  const row = await db.prepare(`SELECT value FROM stats WHERE key = 'games_finished'`).first<{ value: number }>()
  return row?.value ?? 0
}

/**
 * Une partie terminée est comptée même si le joueur n'entre pas au classement.
 * La graine sert de clé : un renvoi de la même partie n'incrémente rien.
 */
async function countFinishedGame(db: D1Database, seed: number) {
  const inserted = await db
    .prepare(`INSERT INTO finished_games (seed, finished_at) VALUES (?, ?) ON CONFLICT(seed) DO NOTHING`)
    .bind(seed, new Date().toISOString())
    .run()
  if (inserted.meta.changes > 0) {
    await db.prepare(`
      INSERT INTO stats (key, value) VALUES ('games_finished', 1)
      ON CONFLICT(key) DO UPDATE SET value = value + 1
    `).run()
  }
  return gamesFinished(db)
}

async function topScores(db: D1Database) {
  const result = await db.prepare(`
    SELECT seed, player_name, score, played_at, breakdown, final_state
    FROM scores
    ORDER BY score DESC, played_at ASC
    LIMIT 10
  `).all<ScoreRow>()
  return result.results.map(rowToEntry)
}

async function submitScore(request: Request, env: Env) {
  const contentLength = Number(request.headers.get('Content-Length') ?? 0)
  if (contentLength > 120_000) return json({ error: 'Données trop volumineuses.' }, 413)

  let submission: ScoreSubmission
  try {
    submission = await request.json() as ScoreSubmission
  } catch {
    return json({ error: 'Données invalides.' }, 400)
  }

  const playerName = cleanName(submission.playerName)
  const seed = Number(submission.seed)
  if (!playerName || !Number.isSafeInteger(seed) || !isPlausibleFinalState(submission.finalState, seed)) {
    return json({ error: 'Score invalide.' }, 400)
  }

  let score: number
  let breakdown: Record<ZoneId, number>
  try {
    score = totalScore(submission.finalState)
    breakdown = scores(submission.finalState)
  } catch {
    return json({ error: 'Grille finale invalide.' }, 400)
  }
  if (!Number.isInteger(score) || score < 0 || score > MAX_TOTAL_SCORE) return json({ error: 'Score hors limites.' }, 400)

  const playedAt = new Date().toISOString()
  const finalState = JSON.stringify(submission.finalState)
  if (finalState.length > 100_000) return json({ error: 'Grille finale trop volumineuse.' }, 413)

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO scores (seed, player_name, score, played_at, breakdown, final_state)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(seed) DO NOTHING
    `).bind(seed, playerName, score, playedAt, JSON.stringify(breakdown), finalState),
    env.DB.prepare(`
      DELETE FROM scores
      WHERE seed NOT IN (
        SELECT seed FROM scores ORDER BY score DESC, played_at ASC LIMIT 100
      )
    `),
  ])

  const gamesCount = await countFinishedGame(env.DB, seed)
  return json({ scores: await topScores(env.DB), gamesFinished: gamesCount }, 201)
}

async function reportFinishedGame(request: Request, env: Env) {
  const contentLength = Number(request.headers.get('Content-Length') ?? 0)
  if (contentLength > 120_000) return json({ error: 'Données trop volumineuses.' }, 413)

  let submission: ScoreSubmission
  try {
    submission = await request.json() as ScoreSubmission
  } catch {
    return json({ error: 'Données invalides.' }, 400)
  }

  const seed = Number(submission.seed)
  if (!Number.isSafeInteger(seed) || !isPlausibleFinalState(submission.finalState, seed)) {
    return json({ error: 'Partie invalide.' }, 400)
  }

  return json({ gamesFinished: await countFinishedGame(env.DB, seed) }, 201)
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/scores') {
      if (request.method === 'GET') {
        const [scoreList, gamesCount] = await Promise.all([topScores(env.DB), gamesFinished(env.DB)])
        return json({ scores: scoreList, gamesFinished: gamesCount })
      }
      if (request.method === 'POST') return submitScore(request, env)
      return json({ error: 'Méthode non autorisée.' }, 405)
    }
    if (url.pathname === '/api/games') {
      if (request.method === 'GET') return json({ gamesFinished: await gamesFinished(env.DB) })
      if (request.method === 'POST') return reportFinishedGame(request, env)
      return json({ error: 'Méthode non autorisée.' }, 405)
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
