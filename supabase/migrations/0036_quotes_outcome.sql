-- Quote outcome (Won/Lost/Open) is tracked independently from the pipeline
-- status -- a quote can be marked Lost while still sitting in a non-terminal
-- status (e.g. the customer went quiet while the quote was "Sent"), so this
-- can't just be derived from status. The API layer auto-syncs this column to
-- match whenever the pipeline status itself reaches a terminal state, but
-- allows an independent manual override before that.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'open'
  CHECK (outcome IN ('open', 'won', 'lost'));
