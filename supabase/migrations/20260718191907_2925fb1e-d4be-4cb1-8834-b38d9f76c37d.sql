-- 1. Widen ai_lessons.kind to include 'glossary'
ALTER TABLE public.ai_lessons DROP CONSTRAINT IF EXISTS ai_lessons_kind_check;
ALTER TABLE public.ai_lessons
  ADD CONSTRAINT ai_lessons_kind_check
  CHECK (kind = ANY (ARRAY['parse_pattern'::text,'qa'::text,'suggestion_rule'::text,'signal_fix'::text,'glossary'::text]));

-- 2. Migrate assistant_glossary -> ai_lessons (kind=glossary, company scope, approved).
--    Skip if a lesson with same company/kind/title already exists.
INSERT INTO public.ai_lessons (kind, scope, company_id, title, example_input_redacted, rule_text, status)
SELECT 'glossary', 'company', g.company_id, g.term, g.term, g.meaning, 'approved'
FROM public.assistant_glossary g
WHERE NOT EXISTS (
  SELECT 1 FROM public.ai_lessons l
  WHERE l.company_id = g.company_id
    AND l.kind = 'glossary'
    AND lower(l.title) = lower(g.term)
);

-- 3. Migrate assistant_learned_preferences.notes -> ai_lessons (kind=suggestion_rule).
--    One row per company; replace prior "AI learned bias" seed.
DELETE FROM public.ai_lessons
  WHERE kind = 'suggestion_rule' AND title = 'AI learned bias';

INSERT INTO public.ai_lessons (kind, scope, company_id, title, example_input_redacted, rule_text, status)
SELECT 'suggestion_rule', 'company', p.company_id, 'AI learned bias', '(silent-learning summary)', p.notes, 'approved'
FROM public.assistant_learned_preferences p
WHERE p.notes IS NOT NULL AND length(trim(p.notes)) > 0;