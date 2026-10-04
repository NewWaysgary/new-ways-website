-- Stage 3: gallery thumbnails, and whether a YouTube video may be played inside the site.
ALTER TABLE gallery_photos ADD COLUMN thumb_key TEXT NOT NULL DEFAULT '';
ALTER TABLE teaching_videos ADD COLUMN embed_ok INTEGER NOT NULL DEFAULT 1;
ALTER TABLE live_stream ADD COLUMN embed_ok INTEGER NOT NULL DEFAULT 1;
