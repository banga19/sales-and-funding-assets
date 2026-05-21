-- 006_add_image_urls_to_content_pieces.sql
-- Adds image_urls column to content_pieces table for AI-generated images

ALTER TABLE content_pieces
ADD COLUMN IF NOT EXISTS image_urls JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN content_pieces.image_urls IS 'Array of URLs for AI-generated images (product photos, infographics)';
