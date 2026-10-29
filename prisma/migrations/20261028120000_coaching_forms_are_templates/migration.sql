-- The coaching form becomes a template an admin writes: one row per form, holding its sections,
-- questions and data panels as JSON. A session copies the form it was started with onto its own
-- row, so editing or deleting a template never changes a session already begun. Every session
-- that exists receives the form every session had until now, as the column's default, so one
-- renderer draws old sessions and new; the same form is seeded as the default template.
--
-- The default on `coaching_sessions.layout` is for the previous release, which never writes the
-- column: a draft it starts while both releases are answering still has a form. It is written in
-- the database's own canonical JSON text so that `migrate diff` reads it back unchanged, and it
-- is dropped in the release after no instance of the previous one is answering.
--
-- The temperature keeps its column. The record's session list, the Fellows screen's Coaching tab,
-- the CSV export and Themes read it, so a form asks it through one item bound to the column rather
-- than through an answer.

-- CreateTable
CREATE TABLE "coaching_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "layout" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coaching_templates_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "coaching_sessions" ADD COLUMN     "layout" JSONB NOT NULL DEFAULT '{"version": 1, "sections": [{"id": "before", "items": [{"id": "topics", "kind": "TOPICS", "caption": "Theirs to keep or remove.", "heading": "Discussion items"}, {"id": "preparation", "kind": "LONG_TEXT", "prompt": "Pre-session notes", "shared": false, "caption": "Observations, trends, and questions you want to be sure to raise.", "overview": false}], "title": "Before the session"}, {"id": "check-in", "items": [{"id": "temperature", "kind": "TEMPERATURE", "prompt": "Temperature check", "caption": "On a scale from 1 to 10, how are you feeling at the moment?"}, {"id": "on-your-mind", "kind": "LONG_TEXT", "prompt": "What has been on your mind lately?", "shared": false, "caption": "In their words, roughly.", "heading": "On their mind", "overview": true}, {"id": "excited", "kind": "LONG_TEXT", "prompt": "What are you most excited to work on at the moment?", "shared": false, "caption": "In their words, roughly.", "heading": "Excited about", "overview": true}, {"id": "challenging", "kind": "LONG_TEXT", "prompt": "Has anything been proving particularly challenging recently?", "shared": false, "caption": "In their words, roughly.", "heading": "Challenging", "overview": true}, {"id": "progress", "kind": "LONG_TEXT", "prompt": "Where have you made progress over the past few weeks / where have you felt most successful?", "shared": false, "caption": "In their words, roughly.", "heading": "Progress", "overview": true}, {"id": "support", "kind": "LONG_TEXT", "prompt": "What kind of support or accountability would feel helpful?", "shared": false, "caption": "In their words, roughly.", "heading": "Support wanted", "overview": true}, {"id": "additional-notes", "kind": "LONG_TEXT", "prompt": "Additional notes", "shared": false, "caption": "Anything else from this conversation worth writing down.", "overview": false}], "title": "Fellow check-in"}, {"id": "goals", "items": [{"id": "goal-progress", "kind": "LONG_TEXT", "prompt": "What progress have you made toward the goal you set during your last coaching session?", "shared": false, "caption": "In their words, roughly.", "overview": false}, {"id": "goal-evidence", "kind": "LONG_TEXT", "prompt": "What evidence, artifact, or example shows that progress?", "shared": false, "caption": "In their words, roughly.", "overview": false}, {"id": "goal-adjustment", "kind": "LONG_TEXT", "prompt": "What helped or got in the way, and what would you adjust moving forward?", "shared": false, "caption": "In their words, roughly.", "overview": false}, {"id": "goals-panel", "kind": "GOALS", "caption": "Theirs to edit.", "heading": "Goals"}], "title": "Goal setting"}]}';

-- Hand-written from here down. `migrate diff` cannot see any of it, so it survives rather than
-- being proposed for removal on the next migration.

-- The form every session was run through until now, seeded once per database as the default
-- template under the same id everywhere. The layout is the same text as the column default above.
INSERT INTO public."coaching_templates" ("id", "name", "is_default", "layout", "created_at", "updated_at")
VALUES (
  'c0ac4100-f0a1-4e6e-8d2b-7a3f5e9c1b20',
  'Coaching session',
  true,
  '{"version": 1, "sections": [{"id": "before", "items": [{"id": "topics", "kind": "TOPICS", "caption": "Theirs to keep or remove.", "heading": "Discussion items"}, {"id": "preparation", "kind": "LONG_TEXT", "prompt": "Pre-session notes", "shared": false, "caption": "Observations, trends, and questions you want to be sure to raise.", "overview": false}], "title": "Before the session"}, {"id": "check-in", "items": [{"id": "temperature", "kind": "TEMPERATURE", "prompt": "Temperature check", "caption": "On a scale from 1 to 10, how are you feeling at the moment?"}, {"id": "on-your-mind", "kind": "LONG_TEXT", "prompt": "What has been on your mind lately?", "shared": false, "caption": "In their words, roughly.", "heading": "On their mind", "overview": true}, {"id": "excited", "kind": "LONG_TEXT", "prompt": "What are you most excited to work on at the moment?", "shared": false, "caption": "In their words, roughly.", "heading": "Excited about", "overview": true}, {"id": "challenging", "kind": "LONG_TEXT", "prompt": "Has anything been proving particularly challenging recently?", "shared": false, "caption": "In their words, roughly.", "heading": "Challenging", "overview": true}, {"id": "progress", "kind": "LONG_TEXT", "prompt": "Where have you made progress over the past few weeks / where have you felt most successful?", "shared": false, "caption": "In their words, roughly.", "heading": "Progress", "overview": true}, {"id": "support", "kind": "LONG_TEXT", "prompt": "What kind of support or accountability would feel helpful?", "shared": false, "caption": "In their words, roughly.", "heading": "Support wanted", "overview": true}, {"id": "additional-notes", "kind": "LONG_TEXT", "prompt": "Additional notes", "shared": false, "caption": "Anything else from this conversation worth writing down.", "overview": false}], "title": "Fellow check-in"}, {"id": "goals", "items": [{"id": "goal-progress", "kind": "LONG_TEXT", "prompt": "What progress have you made toward the goal you set during your last coaching session?", "shared": false, "caption": "In their words, roughly.", "overview": false}, {"id": "goal-evidence", "kind": "LONG_TEXT", "prompt": "What evidence, artifact, or example shows that progress?", "shared": false, "caption": "In their words, roughly.", "overview": false}, {"id": "goal-adjustment", "kind": "LONG_TEXT", "prompt": "What helped or got in the way, and what would you adjust moving forward?", "shared": false, "caption": "In their words, roughly.", "overview": false}, {"id": "goals-panel", "kind": "GOALS", "caption": "Theirs to edit.", "heading": "Goals"}], "title": "Goal setting"}]}',
  now(),
  now()
);

-- A form needs a name, held by the database as well as by zod, because a script does not run the
-- application's code.
ALTER TABLE public."coaching_templates"
  ADD CONSTRAINT coaching_templates_name_length
  CHECK (char_length("name") BETWEEN 1 AND 120);

-- Reached only through the application's own connection, like every other table here. A form is
-- written by an admin and read by every instructor through procedures that check exactly that.
REVOKE ALL ON TABLE public."coaching_templates" FROM anon, authenticated;
ALTER TABLE public."coaching_templates" ENABLE ROW LEVEL SECURITY;
