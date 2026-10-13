-- Per-room styling. accent: '#rrggbb' or NULL to use the Hub accent.
-- background_key: R2 key of the room's own chat background
-- (hub-media/<hub>/room-background/<room>/<uuid>), or NULL to use the Hub's.
ALTER TABLE decave_rooms ADD COLUMN accent TEXT;
ALTER TABLE decave_rooms ADD COLUMN background_key TEXT;
