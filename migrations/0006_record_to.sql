-- phase: expand
-- A stream can record privately to its owner's videos instead of going out (the owner's ask, plan 2026-10-22 §3 D1):
-- record_to 'videos' files each session's recording in OpenVibe.Video (Media app media-hub) as the owner's private
-- video, starts no restream output and never mirrors to OpenVibe Live. NULL, every existing stream, is unchanged.
ALTER TABLE stream_definitions ADD COLUMN IF NOT EXISTS record_to text;
