ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS page_count INTEGER NOT NULL DEFAULT 0;

UPDATE sources s
SET page_count = COALESCE(
  (
    SELECT COUNT(*)::int
    FROM bot_pages bp
    WHERE bp.source_id = s.id
  ),
  0
)
WHERE s.scrape_mode = 'site'
  AND s.page_count = 0;
