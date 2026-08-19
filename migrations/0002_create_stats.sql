CREATE TABLE IF NOT EXISTS stats (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- La graine identifie la partie : une même partie ne peut être comptée qu'une fois.
CREATE TABLE IF NOT EXISTS finished_games (
  seed INTEGER PRIMARY KEY,
  finished_at TEXT NOT NULL
);

INSERT INTO finished_games (seed, finished_at)
SELECT seed, played_at FROM scores
WHERE seed NOT IN (SELECT seed FROM finished_games);

INSERT INTO stats (key, value)
SELECT 'games_finished', (SELECT COUNT(*) FROM finished_games)
WHERE NOT EXISTS (SELECT 1 FROM stats WHERE key = 'games_finished');
