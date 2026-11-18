-- Clear two degenerate photo captions stuck in a repetition loop (#98).
--
-- BS-0144 ("vic vic vic ...") and BS-0145 ("casio casio casio ...") were
-- captioned by an ai-service process still running code from before the
-- repeat-loop cleanup (7102587). clean_caption() returns None for both, so the
-- stored caption becomes null. search_text is generated and updates itself.
--
-- Idempotent: the pattern only matches the looping text, so a row that was
-- already cleared or re-captioned is left alone. Text embeddings are rebuilt
-- separately with ai-service/backfill_two_tower_embeddings.py --ref-code.

update public.items
set ai_caption = null
where ref_code in ('BS-0144', 'BS-0145')
  and ai_caption ~ '^(vic|casio)( \1)+ ?$';
