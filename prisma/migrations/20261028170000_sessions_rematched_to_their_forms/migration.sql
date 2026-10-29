-- A session started before it recorded its form was given the seeded form's name by the previous
-- migration's defaults, which is right wherever the fixed form was the only one — but a database
-- where forms were already being written, and sessions started from them, before that migration
-- ran now names those sessions wrongly. Such a session can still be told apart: its layout is the
-- copy it took from its form, so a session whose layout is identical to exactly one form other
-- than the seeded one was started from that form. Those rows are renamed here; a session whose
-- layout matches no form, or more than one, keeps the seeded name, because a guess would be worse
-- than a default that says what it is.
--
-- Rows written after sessions began recording their form are not touched: they already name it.

UPDATE public."coaching_sessions" AS s
SET "template_id" = m."id", "template_name" = m."name"
FROM (
  SELECT t."id", t."name", t."layout"
  FROM public."coaching_templates" AS t
  WHERE t."id" <> 'c0ac4100-f0a1-4e6e-8d2b-7a3f5e9c1b20'
    AND NOT EXISTS (
      SELECT 1 FROM public."coaching_templates" AS other
      WHERE other."layout" = t."layout" AND other."id" <> t."id"
    )
) AS m
WHERE s."template_id" = 'c0ac4100-f0a1-4e6e-8d2b-7a3f5e9c1b20'
  AND s."layout" = m."layout";
