CREATE TABLE IF NOT EXISTS scores (
  seed INTEGER PRIMARY KEY,
  player_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  played_at TEXT NOT NULL,
  breakdown TEXT NOT NULL,
  final_state TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS scores_ranking
  ON scores (score DESC, played_at ASC);
