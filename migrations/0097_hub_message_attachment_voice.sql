-- Voice-note metadata (duration, waveform) for Hub room voice messages: JSON text, NULL for every other attachment.
ALTER TABLE decave_messages ADD COLUMN attachment_voice TEXT;
