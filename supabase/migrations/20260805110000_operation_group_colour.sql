-- Operation Group visual metadata. NULL is treated as the neutral slate colour.
ALTER TABLE public.operation_groups
  ADD COLUMN IF NOT EXISTS colour text;

ALTER TABLE public.operation_groups
  ALTER COLUMN colour SET DEFAULT 'slate';

UPDATE public.operation_groups
SET colour = 'slate'
WHERE colour IS NULL;

ALTER TABLE public.operation_groups
  DROP CONSTRAINT IF EXISTS operation_groups_colour_check;

ALTER TABLE public.operation_groups
  ADD CONSTRAINT operation_groups_colour_check
  CHECK (colour IS NULL OR colour IN ('slate', 'blue', 'teal', 'amber', 'rose', 'violet'));
