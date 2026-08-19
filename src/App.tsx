import { useEffect, useMemo, useState } from 'react'
import {
  Check, ChevronLeft, ChevronRight, Coins, ExternalLink, FlipHorizontal2, Heart, HelpCircle,
  Mail, Medal, Pause, Play, Redo2, RotateCw, Sparkles, Trash2, Trophy, Undo2, UserRound, X,
} from 'lucide-react'
import {
  GREEN_ENDPOINTS, nextSoloLevel, RED_BLOCKS, SHAPE_NAMES, soloLevel,
  ZONE_META, ZONES,
} from './gameData'
import {
  activePiece, advanceTurn, allowedZones, canPlace, cellKey, cellsForPlacement,
  cloneState, connectedCells, ensureOfficialDeck, ensurePlayablePending, newGame, placePiece, scores,
  recordReplayEvent, replayStateAt, skipPendingPiece, totalScore, transformedShape,
} from './gameLogic'
import { fetchSharedScores, isScoreEntry, reportFinishedGame, saveSharedScore } from './leaderboardApi'
import type { ScoreEntry } from './leaderboardApi'
import type { Card, GameState, ReplayEvent, ShapeId, ZoneId } from './types'

const STORAGE_KEY = 'locus-solo-game-v2'
const LEADERBOARD_KEY = 'locus-solo-leaderboard-v3'
const REPORTED_GAMES_KEY = 'locus-solo-reported-games-v1'
/** Adresse dédiée au projet : joignable par les ayants droit sans exposer d'identité. */
const CONTACT_EMAIL = 'ougl.dev@gmail.com'
type LeaderboardStatus = 'loading' | 'online' | 'offline'

function loadGame() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return newGame()
    const game = ensureOfficialDeck(JSON.parse(saved) as GameState)
    const savedPendingCount = game.pending?.length ?? 0
    game.pending = ensurePlayablePending(game, game.pending ?? [])
    if (savedPendingCount && !game.pending.length) {
      game.rotation = 0
      game.mirrored = false
      game.wildMode = false
      game.message = 'Le bonus impossible à placer a été ignoré. Vous pouvez poursuivre votre tour.'
    }
    return game
  } catch { return newGame() }
}

function loadLeaderboard(): ScoreEntry[] {
  try {
    localStorage.removeItem('locus-solo-leaderboard-v1')
    localStorage.removeItem('locus-solo-leaderboard-v2')
    const saved = localStorage.getItem(LEADERBOARD_KEY)
    if (!saved) return []
    const entries = JSON.parse(saved) as unknown
    return Array.isArray(entries) ? entries.filter(isScoreEntry).slice(0, 10) : []
  } catch { return [] }
}

/** Graines déjà signalées, pour ne pas recompter une partie rouverte ou rechargée. */
function loadReportedGames(): number[] {
  try {
    const saved = localStorage.getItem(REPORTED_GAMES_KEY)
    if (!saved) return []
    const seeds = JSON.parse(saved) as unknown
    return Array.isArray(seeds) ? seeds.filter((seed): seed is number => Number.isSafeInteger(seed)).slice(-50) : []
  } catch { return [] }
}

function saveLocally(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Le jeu reste utilisable sans stockage local. */ }
}

function ShapeGlyph({ shape, rotation = 0, mirrored = false }: { shape: Card['shape']; rotation?: number; mirrored?: boolean }) {
  const points = transformedShape(shape, rotation, mirrored)
  const width = Math.max(...points.map(([x]) => x)) + 1
  const height = Math.max(...points.map(([, y]) => y)) + 1
  const filled = new Set(points.map(([x, y]) => cellKey(x, y)))
  return (
    <span className="shape-glyph" style={{ gridTemplateColumns: `repeat(${width}, 0.72rem)`, gridTemplateRows: `repeat(${height}, 0.72rem)` }}>
      {Array.from({ length: width * height }, (_, i) => (
        <span key={i} className={filled.has(cellKey(i % width, Math.floor(i / width))) ? 'shape-bit filled' : 'shape-bit'} />
      ))}
    </span>
  )
}

function CardChoice({ card, selected, disabled, isExtra, canBuyExtra, rotation, mirrored, onSelect, onBuy }: {
  card: Card; selected: boolean; disabled: boolean; isExtra: boolean; canBuyExtra: boolean;
  rotation: number; mirrored: boolean;
  onSelect: () => void; onBuy: () => void
}) {
  const color = card.color === 'wild' ? '#5e7f78' : ZONE_META[card.color].color
  return (
    <button
      className={`shape-card ${selected ? 'selected' : ''} ${card.color === 'wild' ? 'wild-card' : ''}`}
      style={{ '--card-color': color } as React.CSSProperties}
      disabled={disabled && !canBuyExtra}
      onClick={isExtra ? onBuy : onSelect}
      aria-pressed={selected}
      aria-label={`Forme ${SHAPE_NAMES[card.shape]}, ${card.color === 'wild' ? 'couleur libre' : `zone ${ZONE_META[card.color].name}`}${card.coin ? ', avec une pièce' : ''}`}
    >
      <span className="card-topline">
        {card.coin && <span className="mini-coin" title="Rapporte une pièce">●</span>}
      </span>
      <span className="card-shape"><ShapeGlyph shape={card.shape} rotation={selected ? rotation : 0} mirrored={selected && mirrored} /></span>
      <span className="card-footer">{isExtra ? <><Coins size={14} /> Coûte 3 pièces</> : null}</span>
    </button>
  )
}

function redBlockFor(x: number, y: number) {
  return RED_BLOCKS.findIndex((block) => block.cells.some(([bx, by]) => bx === x && by === y))
}

type PlacementTarget = { zone: ZoneId; x: number; y: number }

function ZoneBoard({ zoneId, state, target, setTarget, onCellClick }: {
  zoneId: ZoneId; state: GameState;
  target: PlacementTarget | null;
  setTarget: (value: PlacementTarget) => void;
  onCellClick: (zone: ZoneId, x: number, y: number, requiresConfirmation: boolean) => void;
}) {
  const zone = ZONES[zoneId]
  const piece = activePiece(state)
  const enabled = allowedZones(state).includes(zoneId)
  const hoverCells = target?.zone === zoneId ? cellsForPlacement(state, target.x, target.y) : []
  const preview = new Set(hoverCells.map(([x, y]) => cellKey(x, y)))
  const validPreview = enabled && canPlace(state, zoneId, hoverCells)
  const zoneScore = scores(state)[zoneId]
  const completedYellowRows = Array.from({ length: ZONES.yellow.rows }, (_, y) =>
    Array.from({ length: ZONES.yellow.cols }, (_, x) => !!state.zones.yellow[cellKey(x, y)]).every(Boolean))
  const completedRedBlocks = RED_BLOCKS.map((block) =>
    block.cells.every(([x, y]) => !!state.zones.red[cellKey(x, y)]))
  const connectedGreen = connectedCells(state, 'green', cellKey(3, 4))
  const greenMarkerCells = ['0,1', '3,0', '6,1', '0,5', '0,7', '3,8', '6,7']

  return (
    <section className={`zone zone-${zoneId} ${enabled ? 'zone-enabled' : ''} ${(piece?.color === 'wild' || state.wildMode) ? 'wild-placement' : ''}`} aria-label={`Zone ${zone.name}`}>
      <div className="zone-stage">
        <div className="zone-grid-wrap">
          <div className="zone-grid" style={{ gridTemplateColumns: `repeat(${zone.cols}, 1fr)` }}>
          {Array.from({ length: zone.rows * zone.cols }, (_, i) => {
          const x = i % zone.cols
          const y = Math.floor(i / zone.cols)
          const id = cellKey(x, y)
          const inMask = zone.mask.has(id)
          const placed = state.zones[zoneId][id]
          const bonus = zone.bonuses[id]
          const isPreview = preview.has(id)
          const classes = [
            'zone-cell', !inMask && 'outside', placed && 'occupied', zone.anchors.has(id) && 'anchor',
            isPreview && (validPreview ? 'preview-valid' : 'preview-invalid'),
            target?.zone === zoneId && target.x === x && target.y === y && 'preview-origin',
            zoneId === 'green' && GREEN_ENDPOINTS.has(id) && 'endpoint',
          ].filter(Boolean).join(' ')
          const block = zoneId === 'red' ? redBlockFor(x, y) : -1
            return (
              <button
              key={id}
              className={classes}
              style={block >= 0 ? { '--block': block } as React.CSSProperties : undefined}
              disabled={!inMask || !piece || !enabled}
              onPointerEnter={(event) => event.pointerType === 'mouse' && setTarget({ zone: zoneId, x, y })}
              onPointerDown={(event) => { event.currentTarget.dataset.pointerType = event.pointerType }}
              onFocus={() => setTarget({ zone: zoneId, x, y })}
              onClick={(event) => {
                const pointerType = event.currentTarget.dataset.pointerType
                  || (event.nativeEvent as PointerEvent).pointerType
                delete event.currentTarget.dataset.pointerType
                const requiresConfirmation = pointerType
                  ? pointerType !== 'mouse'
                  : window.matchMedia('(pointer: coarse)').matches
                onCellClick(zoneId, x, y, requiresConfirmation)
              }}
              aria-label={`Case ${x + 1}, ${y + 1} de ${zone.name}${bonus ? `, ${bonus === 'coin' ? 'bonus pièce' : bonus === 'wild' ? 'bonus case libre' : 'bonus domino coloré'}` : ''}`}
              title={bonus ? bonus === 'coin' ? 'Bonus : gagnez 1 pièce' : bonus === 'wild' ? 'Bonus : placez 1 case libre de couleur' : `Bonus : placez un domino ${bonus.slice(0, -1)}` : undefined}
            >
              {!placed && bonus === 'coin' && <span className="cell-symbol coin-symbol">●</span>}
              {!placed && bonus === 'wild' && <span className="cell-symbol wild-symbol">✦</span>}
              {!placed && bonus?.endsWith('2') && <span className={`cell-symbol domino-symbol bonus-${bonus}`}>▰</span>}
              </button>
            )
          })}
          </div>
          {zoneId === 'yellow' && <div className="yellow-values">{[12, 12, 12, 10, 10, 8].map((value, index) => <span key={index} className={`score-marker ${completedYellowRows[index] ? 'validated' : ''}`}>{value}</span>)}</div>}
          {zoneId === 'blue' && <div className="blue-levels">{[50, 40, 32, 24, 16, 8].map((value) => <span key={value} className={`score-marker ${zoneScore >= value ? 'validated' : ''}`}>{value}</span>)}</div>}
          {zoneId === 'red' && <div className="red-values" aria-hidden="true">{[12, 12, 14, 16].map((value, index) => <span key={index} className={`score-marker ${completedRedBlocks[index] ? 'validated' : ''}`}>{value}</span>)}</div>}
          {zoneId === 'green' && <div className="green-values" aria-hidden="true">{greenMarkerCells.map((cell) => <span key={cell} className={`score-marker ${connectedGreen.has(cell) ? 'validated' : ''}`}>8</span>)}</div>}
        </div>
      </div>
      {zoneId === 'purple' && <div className="purple-scale">{[12, 18, 24, 30, 36, 42, 48].map((value, index) => <span key={value} title={`${index + 2} balises`} className={`score-marker ${zoneScore >= value ? 'validated' : ''}`}>{value}</span>)}</div>}
    </section>
  )
}

function ScoreSummary({ state }: { state: GameState }) {
  const zoneScores = scores(state)
  const lowest = Math.min(...Object.values(zoneScores))
  return (
    <div className="score-summary">
      <div className="final-orbit"><span>Score</span><strong>{totalScore(state)}</strong><small>points</small></div>
      <div className="score-lines">
        {(Object.keys(zoneScores) as ZoneId[]).map((zone) => (
          <div key={zone}><i style={{ background: ZONE_META[zone].color }} /><span>{ZONE_META[zone].name}</span><strong>{zoneScores[zone]}</strong></div>
        ))}
        <div className="minimum-bonus"><i>+</i><span>Minimum × 2</span><strong>+{lowest * 2}</strong><em>zone comptée 3 fois au total</em></div>
      </div>
    </div>
  )
}

function FinalResult({ state, leaderboard, leaderboardStatus, onSaveScore, onReplay }: {
  state: GameState; leaderboard: ScoreEntry[];
  leaderboardStatus: LeaderboardStatus;
  onSaveScore: (name: string) => Promise<void>; onReplay: () => void
}) {
  const score = totalScore(state)
  const level = soloLevel(score)
  const next = nextSoloLevel(score)
  const [candidateName, setCandidateName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const currentEntry = leaderboard.find((entry) => entry.seed === state.seed)
  const position = currentEntry
    ? leaderboard.findIndex((entry) => entry.seed === state.seed) + 1
    : leaderboard.filter((entry) => entry.score > score).length + 1
  const qualifies = leaderboardStatus === 'online'
    && !currentEntry
    && (leaderboard.length < 10 || position <= 10)
  const best = leaderboard[0]?.score ?? score

  return (
    <section className="end-screen" aria-labelledby="final-title">
      <div className="star-field" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} />)}</div>
      <header className="result-hero">
        <div className="trophy-orbit"><Trophy /></div>
        <p className="eyebrow">Résultat solo</p>
        <div className="rank-stars" aria-label={`${level.stars} étoiles sur 5`}>
          {Array.from({ length: 5 }, (_, index) => <span key={index} className={index < level.stars ? 'filled' : ''}>★</span>)}
        </div>
        <h1 id="final-title">{level.title}</h1>
        <p>{level.message}</p>
        {qualifies && <form className="leaderboard-entry" onSubmit={async (event) => {
          event.preventDefault()
          if (!candidateName.trim() || saving) return
          setSaving(true)
          setSaveError('')
          try {
            await onSaveScore(candidateName.trim())
          } catch {
            setSaveError('Impossible d’enregistrer le score. Vérifiez votre connexion puis réessayez.')
          } finally {
            setSaving(false)
          }
        }}>
          <div><UserRound /><span><strong>Vous entrez dans le Top 10 !</strong><small>Ajoutez votre nom au classement.</small></span></div>
          <label><span>Nom du joueur</span><input autoFocus value={candidateName} onChange={(event) => setCandidateName(event.target.value)} maxLength={20} placeholder="Votre nom" aria-label="Nom du joueur dans le classement" /></label>
          <button className="primary-button" disabled={!candidateName.trim() || saving} type="submit">{saving ? 'Envoi…' : 'Enregistrer'}</button>
          {saveError && <p className="leaderboard-error" role="alert">{saveError}</p>}
        </form>}
        {!currentEntry && leaderboardStatus === 'loading' && <p className="leaderboard-connection">Connexion au classement partagé…</p>}
        {!currentEntry && leaderboardStatus === 'offline' && <p className="leaderboard-connection error">Classement partagé momentanément indisponible.</p>}
        {next ? <div className="next-rank"><span>Prochain niveau</span><strong>{next.min - score} points</strong><small>pour atteindre « {next.title} »</small></div> : <div className="next-rank max-rank"><span>Niveau maximal atteint</span><strong>Record cosmique</strong></div>}
      </header>

      <div className="result-grid">
        <article className="score-card"><ScoreSummary state={state} /></article>
        <article className="leaderboard-card">
          <header><div><p className="eyebrow">Classement partagé</p><h2>Meilleures parties</h2></div><Medal /></header>
          <div className="personal-stats">
            <span><small>Classement</small><strong>#{position || '—'}</strong></span>
            <span><small>Record</small><strong>{best}</strong></span>
            <span><small>Scores</small><strong>{leaderboard.length}</strong></span>
          </div>
          <ol className="leaderboard-list">
            {leaderboard.slice(0, 10).map((entry, index) => (
              <li key={entry.seed} className={entry.seed === state.seed ? 'current-entry' : ''}>
                <b>{index + 1}</b>
                <div><strong>{entry.playerName || 'Joueur'}</strong><small>{soloLevel(entry.score).title} · {new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(entry.playedAt))}</small></div>
                <em>{entry.score}</em>
              </li>
            ))}
          </ol>
        </article>
      </div>
      <button className="primary-button replay-button" onClick={onReplay}><Redo2 /> Rejouer</button>
    </section>
  )
}

function SnapshotBoard({ state, highlightPlacementId, highlightZone }: { state: GameState; highlightPlacementId?: string; highlightZone?: ZoneId }) {
  return <div className="snapshot-board" aria-label={state.finished ? 'Grille finale' : `Grille au tour ${state.turn}`}>
    {(Object.keys(ZONES) as ZoneId[]).map((zoneId) => {
      const zone = ZONES[zoneId]
      return <div key={zoneId} className={`snapshot-zone snapshot-zone-${zoneId} ${zoneId === highlightZone ? 'replay-target' : ''}`.trim()} style={{ '--snapshot-color': ZONE_META[zoneId].color } as React.CSSProperties}>
        <div className="snapshot-grid" style={{ gridTemplateColumns: `repeat(${zone.cols}, 1fr)` }}>
          {Array.from({ length: zone.rows * zone.cols }, (_, index) => {
            const id = cellKey(index % zone.cols, Math.floor(index / zone.cols))
            if (!zone.mask.has(id)) return <i key={id} className="outside" />
            const placed = state.zones[zoneId][id]
            return <i key={id} className={`${placed ? 'filled' : ''} ${highlightPlacementId && placed?.placementId === highlightPlacementId ? 'replay-latest' : ''}`.trim()} />
          })}
        </div>
      </div>
    })}
  </div>
}

function replayShapeName(shape?: ShapeId, color?: ZoneId | 'wild') {
  return `${shape ? SHAPE_NAMES[shape] : 'forme'}${color === 'wild' ? ' multicolore' : ''}`
}

/** Phrase complète décrivant la frame, dans le même ton que les messages du jeu. */
function replayFrameCopy(event: ReplayEvent, events: ReplayEvent[], eventIndex: number, state: GameState) {
  const eyebrow = `Tour ${event.turn} / 16`
  const zoneName = event.zone ? ZONE_META[event.zone].name : ''
  if (event.type === 'turn') return { eyebrow, title: 'La partie commence : deux formes sont révélées.' }
  if (event.type === 'discard') return { eyebrow, title: 'La forme est défaussée : +2 pièces.' }
  if (event.type !== 'place') return { eyebrow, title: 'Choix effectué.' }
  const shapeName = replayShapeName(event.shape, event.color)
  if (event.source === 'coin') return { eyebrow, title: `Une case libre achetée est posée dans ${zoneName}.` }
  if (event.source === 'bonus') return { eyebrow, title: `Bonus gagné : « ${shapeName} » est posé dans ${zoneName}.` }
  const card = event.cardId ? state.deck.find((item) => item.id === event.cardId) : undefined
  const isExtra = events.slice(0, eventIndex).some((item) =>
    item.type === 'buy-extra' && item.cardId === event.cardId && item.turn === event.turn)
  const freedColor = card && card.color !== 'wild' && event.color === 'wild'
  const prefix = isExtra ? 'Seconde carte achetée : la' : 'La'
  const suffix = freedColor ? ' (couleur libérée pour 1 pièce)' : ''
  return { eyebrow, title: `${prefix} forme « ${shapeName} » est posée dans ${zoneName}${suffix}.` }
}

function SnapshotBreakdown({ breakdown }: { breakdown: Record<ZoneId, number> }) {
  return <div className="snapshot-breakdown">{(Object.keys(breakdown) as ZoneId[]).map((zone) => (
    <span key={zone} style={{ '--detail-color': ZONE_META[zone].color } as React.CSSProperties}><i />{breakdown[zone]}</span>
  ))}</div>
}

function ReplayViewer({ entry }: { entry: ScoreEntry }) {
  const events = entry.finalState.replayVersion === 1 && Array.isArray(entry.finalState.replay)
    ? entry.finalState.replay
    : []
  const hasReplay = events.length > 1 && events.some((event) => event.type === 'finish')
  const frameIndexes = useMemo(() => {
    const firstTurn = events.findIndex((event) => event.type === 'turn')
    const meaningful = events.flatMap((event, index) => ['place', 'discard', 'finish'].includes(event.type) ? [index] : [])
    return [...new Set([firstTurn, ...meaningful].filter((index) => index >= 0))]
  }, [events])
  const lastFrame = Math.max(0, frameIndexes.length - 1)
  const [frameIndex, setFrameIndex] = useState(lastFrame)
  const [playing, setPlaying] = useState(false)
  const eventIndex = frameIndexes[frameIndex] ?? 0
  const currentEvent = events[eventIndex]
  const replayState = useMemo(
    () => hasReplay ? replayStateAt(entry.finalState, eventIndex) : entry.finalState,
    [entry.finalState, eventIndex, hasReplay],
  )

  useEffect(() => {
    if (!playing) return
    if (frameIndex >= lastFrame) {
      setPlaying(false)
      return
    }
    const timer = window.setTimeout(() => setFrameIndex((current) => Math.min(current + 1, lastFrame)), 1200)
    return () => window.clearTimeout(timer)
  }, [frameIndex, lastFrame, playing])

  if (!hasReplay) return <>
    <SnapshotBreakdown breakdown={entry.breakdown} />
    <SnapshotBoard state={entry.finalState} />
    <div className="replay-legacy"><Play /><span><strong>Replay indisponible</strong><small>Cette partie a été enregistrée avant l’ajout de l’historique.</small></span></div>
  </>

  const copy = currentEvent
    ? replayFrameCopy(currentEvent, events, eventIndex, entry.finalState)
    : { eyebrow: 'Replay', title: 'Début de partie.' }
  const turnEvent = events.slice(0, eventIndex + 1).reverse().find((event) => event.type === 'turn')
  const revealedCards = turnEvent?.cardIds
    ?.map((id) => entry.finalState.deck.find((card) => card.id === id))
    .filter((card): card is Card => !!card) ?? []
  const isBonusPlacement = currentEvent?.type === 'place' && currentEvent.source !== 'card'
  const isFinish = currentEvent?.type === 'finish'

  return <div className="replay-viewer">
    <div className="replay-story" aria-live="polite">
      <p className="eyebrow">{copy.eyebrow}</p>
      <h3>{copy.title}</h3>
    </div>
    <div className="replay-hand" aria-label={isBonusPlacement ? 'Pièce bonus à placer' : 'Formes du tour'}>
      {isFinish ? (
        <div className="replay-hand-done"><Trophy /> {totalScore(replayState)} points</div>
      ) : isBonusPlacement && currentEvent.shape ? (
        <div
          className={`replay-card chosen ${currentEvent.color === 'wild' || !currentEvent.color ? 'wild-card' : ''}`.trim()}
          style={{ '--card-color': !currentEvent.color || currentEvent.color === 'wild' ? '#72569a' : ZONE_META[currentEvent.color].color } as React.CSSProperties}
        >
          <ShapeGlyph shape={currentEvent.shape} />
          <span className="replay-card-state">{currentEvent.source === 'coin' ? 'Case libre' : 'Bonus'}</span>
        </div>
      ) : revealedCards.map((card) => {
        const chosen = currentEvent?.cardId === card.id && (currentEvent.type === 'place' || currentEvent.type === 'discard')
        const discarded = chosen && currentEvent.type === 'discard'
        const idle = currentEvent?.type === 'turn'
        return <div
          key={card.id}
          className={`replay-card ${chosen ? 'chosen' : ''} ${discarded ? 'discarded' : ''} ${!chosen && !idle ? 'dimmed' : ''} ${card.color === 'wild' ? 'wild-card' : ''}`.trim().replace(/\s+/g, ' ')}
          style={{ '--card-color': card.color === 'wild' ? '#72569a' : ZONE_META[card.color].color } as React.CSSProperties}
          aria-label={`${SHAPE_NAMES[card.shape]}${discarded ? ', défaussée' : chosen ? ', posée' : ''}`}
        >
          {card.coin && <span className="replay-card-coin" title="Rapporte une pièce">●</span>}
          <ShapeGlyph shape={card.shape} />
          <span className="replay-card-state">{discarded ? 'Défaussée' : chosen ? 'Posée' : ' '}</span>
        </div>
      })}
    </div>
    <div className="replay-live-stats">
      <span><Coins /> <strong>{replayState.coins}</strong></span>
      <span>Score <strong>{totalScore(replayState)}</strong></span>
    </div>
    <SnapshotBreakdown breakdown={scores(replayState)} />
    <SnapshotBoard
      state={replayState}
      highlightPlacementId={currentEvent?.type === 'place' ? currentEvent.placementId : undefined}
      highlightZone={currentEvent?.type === 'place' ? currentEvent.zone : undefined}
    />
    <div className="replay-controls">
      <div className="replay-buttons">
        <button onClick={() => { setPlaying(false); setFrameIndex((current) => Math.max(0, current - 1)) }} disabled={frameIndex === 0} aria-label="Étape précédente"><ChevronLeft /></button>
        <button className="replay-play" onClick={() => {
          if (playing) { setPlaying(false); return }
          if (frameIndex >= lastFrame) setFrameIndex(0)
          setPlaying(true)
        }} aria-label={playing ? 'Mettre le replay en pause' : 'Lire le replay'}>
          {playing ? <Pause /> : <Play />}<span>{playing ? 'Pause' : frameIndex >= lastFrame ? 'Revoir' : 'Lire'}</span>
        </button>
        <button onClick={() => { setPlaying(false); setFrameIndex((current) => Math.min(lastFrame, current + 1)) }} disabled={frameIndex === lastFrame} aria-label="Étape suivante"><ChevronRight /></button>
      </div>
      <input
        type="range" min={0} max={lastFrame} value={frameIndex}
        onChange={(event) => { setPlaying(false); setFrameIndex(Number(event.target.value)) }}
        aria-label="Progression du replay"
      />
      <span className="replay-step">Étape {frameIndex + 1} / {frameIndexes.length}</span>
    </div>
  </div>
}

function LeaderboardModal({ leaderboard, status, onClose }: { leaderboard: ScoreEntry[]; status: LeaderboardStatus; onClose: () => void }) {
  const [selectedSeed, setSelectedSeed] = useState<number | null>(leaderboard[0]?.seed ?? null)
  const selected = leaderboard.find((entry) => entry.seed === selectedSeed) ?? leaderboard[0]
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <article className="rules-modal leaderboard-modal" role="dialog" aria-modal="true" aria-labelledby="leaderboard-title">
        <button className="close-button" onClick={onClose} aria-label="Fermer"><X /></button>
        <p className="eyebrow">Classement partagé</p>
        <h2 id="leaderboard-title">Leaderboard</h2>
        <p className={`leaderboard-network ${status}`} role="status">
          {status === 'loading' ? 'Actualisation…' : status === 'online' ? 'En ligne · commun à tous les joueurs' : 'Hors ligne · dernière copie disponible'}
        </p>
        {leaderboard.length ? <div className="leaderboard-browser">
          <section className="leaderboard-detail" aria-live="polite">
            <header><div><span>{selected?.playerName || 'Joueur'}</span><strong>{selected?.score}</strong></div><small>{selected ? soloLevel(selected.score).title : ''}</small></header>
            {selected?.finalState ? <ReplayViewer key={selected.seed} entry={selected} /> : <div className="snapshot-unavailable"><span>Grille indisponible.</span></div>}
          </section>
          <ol className="leaderboard-list standalone-leaderboard">
            {leaderboard.slice(0, 10).map((entry, index) => (
              <li key={entry.seed} className={entry.seed === selected?.seed ? 'selected-entry' : ''} role="button" tabIndex={0} onClick={() => setSelectedSeed(entry.seed)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedSeed(entry.seed) }}>
                <b>{index + 1}</b>
                <div><strong>{entry.playerName || 'Joueur'}</strong><small>{soloLevel(entry.score).title} · {new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(entry.playedAt))}</small></div>
                <em>{entry.score}</em>
              </li>
            ))}
          </ol>
        </div> : <div className="empty-leaderboard"><Medal /><strong>Aucun score pour le moment</strong><span>Terminez une partie pour inaugurer le classement.</span></div>}
      </article>
    </div>
  )
}

const ZONE_RULES: { zone: ZoneId; rule: string; markers: number[] }[] = [
  { zone: 'yellow', rule: 'Partez de la ligne épaisse puis restez contigu. Chaque ligne complétée rapporte sa valeur.', markers: [12, 12, 12, 10, 10, 8] },
  { zone: 'purple', rule: 'Première forme libre, les suivantes touchent le groupe. Reliez un maximum de balises entre elles.', markers: [12, 18, 24, 30, 36, 42, 48] },
  { zone: 'red', rule: 'Posez librement dans les secteurs. Chaque secteur entièrement rempli rapporte sa valeur.', markers: [12, 12, 14, 16] },
  { zone: 'green', rule: 'Partez du carrefour central et ramifiez-vous : 8 points par sortie reliée (7 sorties).', markers: [8] },
  { zone: 'blue', rule: 'Partez de la ligne épaisse en bas et grimpez : seule la hauteur atteinte compte.', markers: [8, 16, 24, 32, 40, 50] },
]

function Rules({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <article className="rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title">
        <button className="close-button" onClick={onClose} aria-label="Fermer"><X /></button>
        <p className="eyebrow">Comment jouer</p>
        <h2 id="rules-title">Placez, reliez, optimisez.</h2>
        <p>La partie dure 16 tours. À chaque tour, une carte du paquet est écartée face cachée et deux formes sont révélées. Les règles reprennent celles du jeu de plateau <b>Locus</b>, adaptées au solo.</p>
        <div className="rules-columns">
          <section>
            <h3><span className="rules-step">1</span> Choisissez une forme</h3>
            <div className="rules-demo-hand" aria-hidden="true">
              <div className="replay-card chosen" style={{ '--card-color': ZONE_META.red.color } as React.CSSProperties}>
                <ShapeGlyph shape="f5" />
                <span className="replay-card-state">Choisie</span>
              </div>
              <div className="replay-card wild-card" style={{ '--card-color': '#72569a' } as React.CSSProperties}>
                <span className="replay-card-coin">●</span>
                <ShapeGlyph shape="domino" />
                <span className="replay-card-state"> </span>
              </div>
            </div>
            <p>Prenez l’une des deux formes… ou défaussez-la (<Trash2 />) contre <b>2 pièces</b>. Les cartes marquées <b className="coin-symbol">●</b> rapportent 1 pièce à la pose. Les formes multicolores se posent dans la zone de votre choix.</p>
          </section>
          <section>
            <h3><span className="rules-step">2</span> Posez-la dans sa zone</h3>
            <p>La forme va dans la zone de sa couleur, entièrement sur des cases libres. Orientez-la avec <RotateCw /> <b>Tourner</b> et <FlipHorizontal2 /> <b>Retourner</b>. À la souris, cliquez sur une case valide pour poser aussitôt ; sur écran tactile, touchez une case puis confirmez avec <Check /> <b>Placer</b>.</p>
          </section>
          <section>
            <h3><span className="rules-step">3</span> Dépensez vos pièces</h3>
            <ul className="rules-coins">
              <li><span className="cost">1</span> Rendre la forme active multicolore : zone au choix</li>
              <li><span className="cost">2</span> Obtenir deux cases libres à poser où vous voulez</li>
              <li><span className="cost">3</span> Jouer aussi la seconde forme du tour</li>
            </ul>
            <p>Un achat reste annulable tant que la forme n’est pas posée.</p>
          </section>
          <section>
            <h3><span className="rules-step">4</span> Déclenchez les bonus</h3>
            <div className="bonus-legend rules-bonus" aria-hidden="true">
              <span><b className="coin-symbol">●</b> +1 pièce</span>
              <span><b className="wild-symbol legend-wild-symbol">✦</b> 1 case libre</span>
              <span><b className="domino-symbol">▰</b> 1 domino de cette couleur</span>
            </div>
            <p>Recouvrez un symbole du plateau pour gagner son bonus. Les bonus peuvent s’enchaîner.</p>
          </section>
        </div>
        <section className="rules-credit" aria-label="À propos de ce fan game">
          <Heart aria-hidden="true" />
          <div>
            <strong>Un fan game, par amour du jeu original</strong>
            <p>
              Tout le mérite revient à <b>Stan van Rooijen</b>, auteur de <b>Locus</b>, et à son éditeur
              <b> Tucker’s Fun Factory</b> (2025) : les règles, les cinq zones, le tracé des grilles et la
              position des bonus sont les leurs. Cette version solo est un hommage amateur, non officiel et
              sans but lucratif ; seule l’interface est de moi. Rien ici ne remplace la vraie boîte —
              offrez-vous-la, elle se joue jusqu’à 5 et c’est encore plus chouette autour d’une table.
            </p>
            <a href="https://www.tuckersfunfactory.nl" target="_blank" rel="noopener noreferrer">
              Découvrir le jeu original <ExternalLink aria-hidden="true" />
            </a>
            <p className="rules-credit-contact">
              <Mail aria-hidden="true" />
              Contactez-moi à cette adresse : <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </p>
          </div>
        </section>
        <section className="rules-scoring" aria-label="Le score par zone">
          <h3>Marquer des points</h3>
          {ZONE_RULES.map(({ zone, rule, markers }) => (
            <div key={zone} className="rules-zone-row" style={{ '--zone-color': ZONE_META[zone].color, '--zone-ink': ZONE_META[zone].ink } as React.CSSProperties}>
              <i />
              <strong>{ZONE_META[zone].name}</strong>
              <p>{rule}</p>
              <div className="rules-zone-markers" aria-hidden="true">
                {markers.map((value, index) => <span key={index} className="score-marker">{value}</span>)}
              </div>
            </div>
          ))}
          <p className="rules-minimum"><b>Score final</b> : la somme des cinq zones, plus <b>deux fois la plus faible</b> — elle compte trois fois, ne délaissez aucune zone.</p>
        </section>
        <button className="primary-button wide" onClick={onClose}>C’est parti</button>
      </article>
    </div>
  )
}

export default function App() {
  const [state, setState] = useState<GameState>(loadGame)
  const [target, setTarget] = useState<PlacementTarget | null>(null)
  const [showRules, setShowRules] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [leaderboard, setLeaderboard] = useState<ScoreEntry[]>(loadLeaderboard)
  const [leaderboardStatus, setLeaderboardStatus] = useState<LeaderboardStatus>('loading')
  const [gamesFinished, setGamesFinished] = useState<number | null>(null)
  const [requiresPlacementConfirmation, setRequiresPlacementConfirmation] = useState(() => window.matchMedia('(pointer: coarse)').matches)
  const piece = activePiece(state)
  const targetIsValid = useMemo(() => target ? canPlace(state, target.zone, cellsForPlacement(state, target.x, target.y)) : false, [state, target])

  const refreshLeaderboard = async (signal?: AbortSignal) => {
    setLeaderboardStatus('loading')
    try {
      const shared = await fetchSharedScores(signal)
      setLeaderboard(shared.scores)
      if (shared.gamesFinished !== null) setGamesFinished(shared.gamesFinished)
      setLeaderboardStatus('online')
    } catch {
      if (!signal?.aborted) setLeaderboardStatus('offline')
    }
  }

  useEffect(() => { saveLocally(STORAGE_KEY, state) }, [state])
  useEffect(() => { saveLocally(LEADERBOARD_KEY, leaderboard) }, [leaderboard])

  useEffect(() => {
    if (!state.finished) return
    const reported = loadReportedGames()
    if (reported.includes(state.seed)) return
    saveLocally(REPORTED_GAMES_KEY, [...reported, state.seed].slice(-50))
    void reportFinishedGame(state).then((total) => {
      if (total !== null) setGamesFinished(total)
    }).catch(() => { /* Le compteur repassera au prochain chargement. */ })
  }, [state.finished, state.seed])
  useEffect(() => {
    const controller = new AbortController()
    void refreshLeaderboard(controller.signal)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!showRules && !showLeaderboard) return
    const previousOverflow = document.body.style.overflow
    const closeModal = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setShowRules(false)
      setShowLeaderboard(false)
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeModal)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeModal)
    }
  }, [showRules, showLeaderboard])

  useEffect(() => {
    if (!piece) { setTarget(null); return }
    setTarget((current) => {
      if (current && allowedZones(state).includes(current.zone)) return current
      for (const zoneId of allowedZones(state)) {
        const zone = ZONES[zoneId]
        for (let y = 0; y < zone.rows; y++) for (let x = 0; x < zone.cols; x++) {
          if (canPlace(state, zoneId, cellsForPlacement(state, x, y))) return { zone: zoneId, x, y }
        }
      }
      const zoneId = allowedZones(state)[0]
      if (!zoneId) return null
      const fallback = [...ZONES[zoneId].mask].find((cell) => !state.zones[zoneId][cell]) ?? [...ZONES[zoneId].mask][0]
      const [x, y] = fallback.split(',').map(Number)
      return { zone: zoneId, x, y }
    })
  }, [piece?.id, state.wildMode])

  const commit = (next: GameState) => {
    setState(next)
    setTarget(null)
  }

  const updateUi = (changes: Partial<GameState>) => setState((current) => ({ ...current, ...changes }))

  const selectCard = (id: string) => {
    if (state.primaryDone || state.pending.length) return
    const next = cloneState(state)
    next.selectedCardId = id
    next.rotation = 0
    next.mirrored = false
    next.wildMode = false
    next.message = requiresPlacementConfirmation
      ? 'Touchez une case pour voir la position complète, puis confirmez avec Placer.'
      : 'Cliquez sur une case valide pour poser la forme.'
    recordReplayEvent(next, { type: 'select', cardId: id })
    commit(next)
  }

  const buyExtra = (id: string) => {
    const card = state.cards.find((item) => item.id === id)
    if (!card || !state.primaryDone || state.coins < 3 || state.extraCardUsed || state.pending.length) return
    const next = cloneState(state)
    next.coins -= 3; next.spentCoins += 3; next.extraCardUsed = true; next.selectedCardId = id
    next.message = requiresPlacementConfirmation
      ? 'Seconde carte achetée. Touchez une position, puis confirmez avec Placer.'
      : 'Seconde carte achetée. Cliquez sur une position valide pour la poser.'
    recordReplayEvent(next, { type: 'buy-extra', cardId: id })
    commit(next)
  }

  const cancelExtra = () => {
    if (!state.extraCardUsed || !state.selectedCardId || state.pending.length) return
    const next = cloneState(state)
    next.coins += 3 + (next.wildMode ? 1 : 0)
    next.spentCoins = Math.max(0, next.spentCoins - 3 - (next.wildMode ? 1 : 0))
    next.selectedCardId = null; next.extraCardUsed = false; next.wildMode = false
    next.rotation = 0; next.mirrored = false
    next.message = 'Achat annulé et pièces remboursées. Vous pouvez terminer le tour.'
    recordReplayEvent(next, { type: 'cancel-extra', cardId: state.selectedCardId })
    commit(next)
  }

  const rotatePiece = () => {
    if (!piece) return
    const next = cloneState(state)
    next.rotation = (next.rotation + 1) % 4
    setState(next)
  }

  const mirrorPiece = () => {
    if (!piece) return
    const next = cloneState(state)
    next.mirrored = !next.mirrored
    setState(next)
  }

  const place = (zone: ZoneId, x: number, y: number) => {
    const next = placePiece(state, zone, x, y)
    if (next) commit(next)
    else updateUi({ message: 'Cette forme ne peut pas être posée ici.' })
  }

  const confirmPlacement = () => {
    if (target && targetIsValid) place(target.zone, target.x, target.y)
  }

  const chooseOrPlace = (zone: ZoneId, x: number, y: number, requiresConfirmation: boolean) => {
    setRequiresPlacementConfirmation(requiresConfirmation)
    setTarget({ zone, x, y })
    if (!requiresConfirmation) place(zone, x, y)
  }

  const discard = () => {
    if (!state.selectedCardId || state.primaryDone || state.pending.length) return
    const next = cloneState(state)
    const discardedCardId = state.selectedCardId
    next.cards = next.cards.filter((card) => card.id !== next.selectedCardId)
    next.selectedCardId = null; next.coins += 2; next.primaryDone = true
    next.rotation = 0; next.mirrored = false; next.wildMode = false
    next.message = 'Carte défaussée : vous gagnez 2 pièces.'
    recordReplayEvent(next, { type: 'discard', cardId: discardedCardId })
    commit(next)
  }

  const spendWild = () => {
    if (!piece || state.coins < 1 || state.wildMode || piece.color === 'wild') return
    const next = cloneState(state)
    next.coins -= 1; next.spentCoins += 1; next.wildMode = true
    next.message = 'Forme libérée : choisissez n’importe quelle zone.'
    recordReplayEvent(next, { type: 'wild', cardId: piece.id })
    commit(next)
  }

  const spendTwo = () => {
    if (state.coins < 2 || state.pending.length || state.selectedCardId || !state.primaryDone) return
    const next = cloneState(state)
    next.coins -= 2; next.spentCoins += 2
    next.pending.push(
      { id: `c-${Date.now()}-1`, shape: 'mono', color: 'wild', source: 'coin', label: 'Case libre 1/2' },
      { id: `c-${Date.now()}-2`, shape: 'mono', color: 'wild', source: 'coin', label: 'Case libre 2/2' },
    )
    next.message = 'Placez vos deux cases libres.'
    recordReplayEvent(next, { type: 'buy-cells' })
    commit(next)
  }

  const skipBonus = () => {
    if (!state.pending.length) return
    commit(skipPendingPiece(state))
  }

  const endTurn = () => {
    if (!state.primaryDone || state.pending.length || state.selectedCardId) return
    commit(advanceTurn(state))
  }

  const reset = () => {
    if (!state.finished && !window.confirm('Commencer une nouvelle partie ? La partie actuelle sera remplacée.')) return
    setState(newGame()); setTarget(null)
  }

  const saveScore = async (playerName: string) => {
    const cleanName = playerName.trim()
    if (!state.finished || !cleanName) throw new Error('Score incomplet.')
    const shared = await saveSharedScore(cleanName, cloneState(state))
    setLeaderboard(shared.scores)
    if (shared.gamesFinished !== null) setGamesFinished(shared.gamesFinished)
    setLeaderboardStatus('online')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">L</span><div><strong>LOCUS</strong><small>SOLO</small></div></div>
        <div className="status-pill"><span>Tour</span><strong>{state.finished ? '—' : `${state.turn}/16`}</strong></div>
        <div className="status-pill coin-pill"><Coins size={18} /><strong>{state.coins}</strong><span>pièce{state.coins !== 1 ? 's' : ''}</span></div>
        <div className="header-score"><span>Score actuel</span><strong>{totalScore(state)}</strong></div>
        <nav className="header-actions">
          <button className="named-action" onClick={() => { setShowLeaderboard(true); void refreshLeaderboard() }} title="Leaderboard" aria-label="Ouvrir le leaderboard"><Medal /><span>Leaderboard</span></button>
          <button onClick={() => setShowRules(true)} title="Règles"><HelpCircle /></button>
          <button className="named-action" onClick={reset} title="Play again" aria-label="Play again"><Redo2 /><span>Play again</span></button>
        </nav>
      </header>

      <main>
        <section className={`turn-panel ${state.finished ? 'finished-turn' : ''}`}>
          <div className="turn-copy">
            <p className="eyebrow">{state.finished ? 'Partie terminée' : state.pending.length ? 'Bonus en cours' : state.primaryDone ? 'Forme placée' : `Tour ${state.turn}`}</p>
            <h1>{state.finished ? 'Beau voyage.' : state.pending.length ? state.pending[0].label : state.primaryDone ? 'Encore un choix…' : 'Choisissez votre forme.'}</h1>
            <p className="turn-message" role="status" aria-live="polite">{state.message}</p>
          </div>

          {!state.finished && <div className="cards-area">
            {state.pending.length ? (
              <div className={`bonus-piece ${state.pending[0].color === 'wild' ? 'wild-piece' : ''}`}><Sparkles /><div><span>À placer</span><strong>{state.pending[0].label}</strong></div><ShapeGlyph shape={state.pending[0].shape} rotation={state.rotation} mirrored={state.mirrored} /></div>
            ) : state.cards.map((card) => (
              <CardChoice
                key={card.id} card={card} selected={state.selectedCardId === card.id}
                disabled={state.primaryDone || !!state.selectedCardId}
                isExtra={state.primaryDone && !state.extraCardUsed}
                canBuyExtra={state.primaryDone && !state.extraCardUsed && state.coins >= 3}
                rotation={state.rotation} mirrored={state.mirrored}
                onSelect={() => selectCard(card.id)} onBuy={() => buyExtra(card.id)}
              />
            ))}
            {piece && <div className="transform-dock" aria-label="Pièce à placer et orientation">
              <span
                className={`dock-piece-preview ${(state.wildMode || piece.color === 'wild') ? 'wild-piece' : ''}`}
                style={{ '--dock-piece-color': (state.wildMode || piece.color === 'wild') ? '#72569a' : ZONE_META[piece.color as ZoneId].color } as React.CSSProperties}
                aria-label="Aperçu de la pièce à placer"
              >
                <ShapeGlyph shape={piece.shape} rotation={state.rotation} mirrored={state.mirrored} />
              </span>
              <button onClick={rotatePiece} title="Tourner la forme" aria-label="Tourner la forme"><RotateCw /> <span>Tourner</span></button>
              <button onClick={mirrorPiece} title="Retourner la forme" aria-label="Retourner la forme"><FlipHorizontal2 /> <span>Retourner</span></button>
              {requiresPlacementConfirmation && <button className="confirm-placement" onClick={confirmPlacement} disabled={!targetIsValid} title={targetIsValid ? 'Confirmer la pose' : 'Cette position est impossible'} aria-label={targetIsValid ? 'Confirmer la pose' : 'Cette position est impossible'}><Check /> <span>{targetIsValid ? 'Placer' : 'Impossible'}</span></button>}
              {state.pending.length > 0 && <button className="skip-dock" onClick={skipBonus} title="Ignorer ce bonus" aria-label="Ignorer ce bonus"><Trash2 /> <span>Ignorer</span></button>}
            </div>}
          </div>}

          {!state.finished && <div className="piece-tools">
            <button className="coin-action" onClick={spendWild} disabled={!piece || state.coins < 1 || state.wildMode || piece.color === 'wild'}><span className="cost">1</span> Couleur libre</button>
            <button className="coin-action" onClick={spendTwo} disabled={state.coins < 2 || !!state.pending.length || !!state.selectedCardId || !state.primaryDone}><span className="cost">2</span> Deux cases</button>
            {state.pending.length
              ? <button className="discard-action" onClick={skipBonus}><Trash2 /> Ignorer ce bonus</button>
              : <button className="discard-action" onClick={discard} disabled={!state.selectedCardId || state.primaryDone}><Trash2 /> Défausser <small>+2</small></button>}
            {state.extraCardUsed && state.selectedCardId && <button className="cancel-purchase" onClick={cancelExtra}><Undo2 /> Annuler l’achat <small>+3</small></button>}
            <button className="primary-button" onClick={endTurn} disabled={!state.primaryDone || !!state.pending.length || !!state.selectedCardId}>{state.turn === 16 ? 'Voir mon résultat' : 'Tour suivant'}</button>
          </div>}
        </section>

        {state.finished ? (
          <FinalResult state={state} leaderboard={leaderboard} leaderboardStatus={leaderboardStatus} onSaveScore={saveScore} onReplay={reset} />
        ) : (
          <>
            <aside className="bonus-legend" aria-label="Légende des bonus">
              <span><b className="coin-symbol">●</b> +1 pièce</span>
              <span><b className="wild-symbol legend-wild-symbol">✦</b> 1 case libre</span>
              <span><b className="domino-symbol">▰</b> 1 domino de cette couleur</span>
            </aside>
            <section className="zones-layout" aria-label="Plateau de jeu">
              {(Object.keys(ZONES) as ZoneId[]).map((zone) => <ZoneBoard key={zone} zoneId={zone} state={state} target={target} setTarget={setTarget} onCellClick={chooseOrPlace} />)}
            </section>
          </>
        )}
      </main>

      {!state.finished && !piece && !state.pending.length && state.cards.length > 0 && (
        <div className="mobile-card-picker" aria-label={state.primaryDone ? 'Acheter la seconde carte' : 'Choisir une carte'}>
          <span className="mobile-picker-label">{state.primaryDone ? 'Seconde carte' : 'Choisir'}</span>
          {state.cards.map((card) => {
            const color = card.color === 'wild' ? '#72569a' : ZONE_META[card.color].color
            const isExtra = state.primaryDone
            return (
              <button
                key={card.id}
                className={`mobile-card-option ${card.color === 'wild' ? 'wild-card' : ''}`}
                style={{ '--card-color': color } as React.CSSProperties}
                disabled={isExtra && (state.coins < 3 || state.extraCardUsed)}
                onClick={() => isExtra ? buyExtra(card.id) : selectCard(card.id)}
                aria-label={`${isExtra ? 'Acheter' : 'Choisir'} la forme ${SHAPE_NAMES[card.shape]}${isExtra ? ' pour 3 pièces' : ''}`}
              >
                {card.coin && <span className="mobile-card-coin" aria-label="Rapporte une pièce">●</span>}
                <ShapeGlyph shape={card.shape} />
                {isExtra && <span className="mobile-card-cost"><Coins /> 3</span>}
              </button>
            )
          })}
        </div>
      )}

      <footer>
        <div className="footer-line">
          <span>Progression sauvegardée automatiquement sur cet appareil.</span>
          {gamesFinished !== null && (
            <span className="games-counter">
              <Sparkles aria-hidden="true" />
              <strong>{gamesFinished.toLocaleString('fr-FR')}</strong>
              {gamesFinished > 1 ? ' parties jouées jusqu’au bout' : ' partie jouée jusqu’au bout'}
            </span>
          )}
          <span>Classement partagé entre tous les joueurs.</span>
        </div>
        <p className="footer-credit">
          <Heart aria-hidden="true" /> Fan game non officiel, d’après <b>Locus</b>, un jeu de Stan van Rooijen édité par Tucker’s Fun Factory.
        </p>
      </footer>
      {showLeaderboard && <LeaderboardModal leaderboard={leaderboard} status={leaderboardStatus} onClose={() => setShowLeaderboard(false)} />}
      {showRules && <Rules onClose={() => setShowRules(false)} />}
    </div>
  )
}
