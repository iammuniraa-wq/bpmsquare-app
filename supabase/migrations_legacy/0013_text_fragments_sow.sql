-- Allow 'sow' (scope of work) as a text_fragment category
ALTER TABLE text_fragments DROP CONSTRAINT IF EXISTS text_fragments_category_check;
ALTER TABLE text_fragments ADD CONSTRAINT text_fragments_category_check
  CHECK (category IN ('line_item', 'notes', 'terms', 'sow'));
