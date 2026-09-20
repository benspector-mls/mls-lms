-- The competency list moves out of code and into three tables an admin authors: the sections, the
-- competencies under them, and the indicators and pitfalls under those. One list for the whole
-- application rather than one per program — a program is one run of a fellowship, and a list owned
-- by a run would be copied into the next one and drift — with each competency naming the
-- disciplines it is offered to, so the two fellowships share everything but their technical
-- section.
--
-- Goals are untouched. A goal holds its entry's id and a copy of the wording, so every goal
-- written against the list in code keeps reading exactly as it did; its id now names no row, which
-- is the same state an entry deleted by an admin leaves behind, and the editor already renders
-- from the copies in both cases.

-- CreateEnum
CREATE TYPE "Discipline" AS ENUM ('SOFTWARE_ENGINEERING', 'DATA_ANALYTICS');

-- AlterTable
ALTER TABLE "programs" ADD COLUMN     "discipline" "Discipline" NOT NULL DEFAULT 'SOFTWARE_ENGINEERING';

-- CreateTable
CREATE TABLE "competency_groups" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competency_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competencies" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "blurb" TEXT NOT NULL,
    "disciplines" "Discipline"[],
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competency_entries" (
    "id" UUID NOT NULL,
    "competency_id" UUID NOT NULL,
    "kind" "CompetencyEntryKind" NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competency_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "competencies_group_id_position_idx" ON "competencies"("group_id", "position");

-- CreateIndex
CREATE INDEX "competency_entries_competency_id_position_idx" ON "competency_entries"("competency_id", "position");

-- AddForeignKey
ALTER TABLE "competencies" ADD CONSTRAINT "competencies_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "competency_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_entries" ADD CONSTRAINT "competency_entries_competency_id_fkey" FOREIGN KEY ("competency_id") REFERENCES "competencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written from here down. `migrate diff` cannot see any of it, so it survives rather than
-- being proposed for removal on the next migration.

-- Reached only through the application's own connection, like every other table here. Nothing on
-- these three is private — it is the list everybody picks from — but the write side is admins
-- only, and a client role that could edit it could rewrite what a fellow is offered.
REVOKE ALL ON TABLE public."competency_groups" FROM anon, authenticated;
ALTER TABLE public."competency_groups" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."competencies" FROM anon, authenticated;
ALTER TABLE public."competencies" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."competency_entries" FROM anon, authenticated;
ALTER TABLE public."competency_entries" ENABLE ROW LEVEL SECURITY;

-- The school's list as it stood in `lib/competencies.ts`, which is where it lived until this
-- migration. Seeded here rather than behind a button because it is seeded exactly once per
-- database and `db:deploy` already runs exactly once per database. The ids are written out rather
-- than generated so that every database names the same competency the same way.
--
-- The two sections about how a person works and learns are offered to both fellowships; the
-- Software Engineering section to one. "Data Analytics" is seeded empty: it is where that
-- fellowship's technical competencies go, and until an admin writes them its fellows are offered
-- the shared sections alone.
-- The sections.
INSERT INTO "competency_groups" ("id", "name", "position") VALUES
  ('6c66b6c1-86b6-4c75-81f5-7e987dea8683', 'Durable Skills', 0),
  ('65520e05-9e23-4241-bc57-b37f8cf7c3e6', 'Leadership & Development', 1),
  ('a0600e72-89b1-4681-a915-f0ddc57e0bd1', 'Software Engineering', 2),
  ('e0a6465b-0743-4c69-a9ea-2620ed4132d7', 'Data Analytics', 3);

-- The competencies, and which fellowships each is offered to.
INSERT INTO "competencies" ("id", "group_id", "name", "blurb", "disciplines", "position") VALUES
  ('99ec5a55-3adb-466c-8943-1f863bc60707', '6c66b6c1-86b6-4c75-81f5-7e987dea8683', 'Growth Mindset', 'Deriving satisfaction from growth and proactively seeking feedback and assistance to continuously improve and evolve.', ARRAY['SOFTWARE_ENGINEERING','DATA_ANALYTICS']::"Discipline"[], 0),
  ('f8f0f7ee-ad2e-4f5a-8751-b64167322bc4', '6c66b6c1-86b6-4c75-81f5-7e987dea8683', 'Time & Task Management', 'Prioritizing workloads effectively to consistently meet deadlines and deliver reliable results.', ARRAY['SOFTWARE_ENGINEERING','DATA_ANALYTICS']::"Discipline"[], 1),
  ('fd4df6b2-2d99-45c7-94c7-ad9678137da6', '6c66b6c1-86b6-4c75-81f5-7e987dea8683', 'Learning & Retaining Information', 'Effectively learning new skills and retaining that knowledge. Taking ownership of one''s educational journey through disciplined study and self-management.', ARRAY['SOFTWARE_ENGINEERING','DATA_ANALYTICS']::"Discipline"[], 2),
  ('caa0ea61-d64a-4e24-b936-c4268a4004a5', '6c66b6c1-86b6-4c75-81f5-7e987dea8683', 'Timely and Transparent Communication', 'Managing professional obligations through timely, transparent updates regarding status and responsibilities.', ARRAY['SOFTWARE_ENGINEERING','DATA_ANALYTICS']::"Discipline"[], 3),
  ('2f6cb8a9-a6d0-4b6c-aaeb-d86c30819b17', '6c66b6c1-86b6-4c75-81f5-7e987dea8683', 'Presence & Participation', 'Demonstrating reliability and commitment through high attendance and participation rates.', ARRAY['SOFTWARE_ENGINEERING','DATA_ANALYTICS']::"Discipline"[], 4),
  ('e96b0ba2-ce93-4f53-b6f4-8d6300ca4cd6', '6c66b6c1-86b6-4c75-81f5-7e987dea8683', 'Collaboration', 'Working harmoniously within a team to achieve shared objectives through mutual support.', ARRAY['SOFTWARE_ENGINEERING','DATA_ANALYTICS']::"Discipline"[], 5),
  ('9c341432-c3d9-45f1-951c-0e513cea432e', '6c66b6c1-86b6-4c75-81f5-7e987dea8683', 'Leadership', 'Motivating others and managing project lifecycles by leveraging team strengths and maintaining a positive, goal-oriented attitude.', ARRAY['SOFTWARE_ENGINEERING','DATA_ANALYTICS']::"Discipline"[], 6),
  ('dc21b9d2-bcc0-43bd-aa1c-ab9455c25a99', '6c66b6c1-86b6-4c75-81f5-7e987dea8683', 'Ethical Technology Use', 'Leveraging digital tools responsibly and efficiently to solve problems and enhance productivity.', ARRAY['SOFTWARE_ENGINEERING','DATA_ANALYTICS']::"Discipline"[], 7),
  ('b36a9dd4-0885-4d0a-af8d-6cc7a09a84dd', '65520e05-9e23-4241-bc57-b37f8cf7c3e6', 'Critical Thinking', 'Analyzing information objectively to make reasoned judgments and innovative decisions.', ARRAY['SOFTWARE_ENGINEERING','DATA_ANALYTICS']::"Discipline"[], 0),
  ('0a2666f3-0f1d-4b71-8026-a68222427738', '65520e05-9e23-4241-bc57-b37f8cf7c3e6', 'Career & Self-Development', 'Proactively seeking opportunities for personal growth and long-term professional advancement.', ARRAY['SOFTWARE_ENGINEERING','DATA_ANALYTICS']::"Discipline"[], 1),
  ('533b83bb-432a-4121-b545-13f3182ff281', '65520e05-9e23-4241-bc57-b37f8cf7c3e6', 'Equity & Inclusion Lens', 'Integrating diverse perspectives and fostering an environment where all identities are respected and valued.', ARRAY['SOFTWARE_ENGINEERING','DATA_ANALYTICS']::"Discipline"[], 2),
  ('95210331-3a3d-4edd-9b4b-14f06fa18b39', '65520e05-9e23-4241-bc57-b37f8cf7c3e6', 'Storytelling', 'Crafting clear, compelling narratives in writing and speech to effectively communicate complex ideas.', ARRAY['SOFTWARE_ENGINEERING','DATA_ANALYTICS']::"Discipline"[], 3),
  ('d6007f4f-8f64-403c-962f-6c2894a21a4a', '65520e05-9e23-4241-bc57-b37f8cf7c3e6', 'Curiosity', 'Maintaining an active desire to learn, explore new concepts, and challenge the status quo.', ARRAY['SOFTWARE_ENGINEERING','DATA_ANALYTICS']::"Discipline"[], 4),
  ('49d198e0-6209-4582-8b75-9708a969d7bc', 'a0600e72-89b1-4681-a915-f0ddc57e0bd1', 'Technical Communication', 'Clearly articulating the “what, how, and why” of technical decisions and product development to diverse audiences, from stakeholders to teammates.', ARRAY['SOFTWARE_ENGINEERING']::"Discipline"[], 0),
  ('73ed3650-d36c-4a8d-a127-4d9afec78113', 'a0600e72-89b1-4681-a915-f0ddc57e0bd1', 'Mental Models', 'Creating simplified abstractions of complex systems to focus on essential concepts, enabling faster learning and better problem-solving.', ARRAY['SOFTWARE_ENGINEERING']::"Discipline"[], 1),
  ('897c4218-e4a0-404e-8d65-4f61bfd7cda4', 'a0600e72-89b1-4681-a915-f0ddc57e0bd1', 'Systems Thinking', 'Analyzing how individual components and dependencies interact within a larger framework to design reliable, scalable, and maintainable software.', ARRAY['SOFTWARE_ENGINEERING']::"Discipline"[], 2),
  ('a5ce8fbb-4a48-4f7a-b8c2-a329878cad9a', 'a0600e72-89b1-4681-a915-f0ddc57e0bd1', 'Methodical Debugging', 'Applying a structured, methodical approach to identify root causes and implement comprehensive fixes rather than relying on guesswork.', ARRAY['SOFTWARE_ENGINEERING']::"Discipline"[], 3),
  ('d2a633d4-11bd-4a9d-8678-47273c4998f4', 'a0600e72-89b1-4681-a915-f0ddc57e0bd1', 'Detail Orientation', 'Taking professional pride in producing clean, well-documented code and error-free materials that adhere to industry best practices and team standards.', ARRAY['SOFTWARE_ENGINEERING']::"Discipline"[], 4);

-- The indicators and pitfalls, indicators first within each competency.
INSERT INTO "competency_entries" ("id", "competency_id", "kind", "text", "position") VALUES
  ('b14e9080-7309-4bc3-b8ad-e935bd8b1f8b', '99ec5a55-3adb-466c-8943-1f863bc60707', 'INDICATOR', 'Views challenges as opportunities to learn rather than obstacles.', 0),
  ('c106cb00-9a2c-4baa-bf67-7a86ba81fa76', '99ec5a55-3adb-466c-8943-1f863bc60707', 'INDICATOR', 'Takes initiative to learn new skills and derives satisfaction from progress.', 1),
  ('1c36ccce-78d4-468e-8ba2-438a432076a1', '99ec5a55-3adb-466c-8943-1f863bc60707', 'INDICATOR', 'Actively seeks feedback on work and incorporates it into future efforts.', 2),
  ('cc395cc5-21f3-4de6-adcd-9f71bc98bc1a', '99ec5a55-3adb-466c-8943-1f863bc60707', 'INDICATOR', 'Asks for help when stuck rather than struggling in silence.', 3),
  ('84869e95-8f1f-44bf-97d1-ab678f231e85', '99ec5a55-3adb-466c-8943-1f863bc60707', 'INDICATOR', 'Responds positively to constructive criticism.', 4),
  ('9eeed16f-89da-4787-b72f-8cdca2cdee90', '99ec5a55-3adb-466c-8943-1f863bc60707', 'INDICATOR', 'Reflects on mistakes to understand root causes and prevent recurrence (self-awareness).', 5),
  ('bca2f5ca-7b73-4a28-922d-eaafdf6cb531', '99ec5a55-3adb-466c-8943-1f863bc60707', 'INDICATOR', 'Celebrates progress and small wins along the learning journey.', 6),
  ('64cebb4c-c10d-431d-a167-b67eea3bffc1', '99ec5a55-3adb-466c-8943-1f863bc60707', 'PITFALL', 'Becoming defensive when receiving feedback.', 7),
  ('13e12378-c1c1-4620-b8b0-75c6d142a820', '99ec5a55-3adb-466c-8943-1f863bc60707', 'PITFALL', 'Avoiding challenges.', 8),
  ('1fa798f1-5fad-4d84-a8ca-18049041132c', '99ec5a55-3adb-466c-8943-1f863bc60707', 'PITFALL', 'Giving up quickly when faced with difficulty.', 9),
  ('5108de29-511d-4bc6-848e-a968443fdbf2', '99ec5a55-3adb-466c-8943-1f863bc60707', 'PITFALL', 'Viewing abilities as fixed rather than developable.', 10),
  ('6dcc9606-8ec9-4b40-897a-4d8e9830073f', 'f8f0f7ee-ad2e-4f5a-8751-b64167322bc4', 'INDICATOR', 'Breaks large projects into manageable tasks with realistic timelines.', 0),
  ('78444b81-7291-4ae7-b840-e8925dc788de', 'f8f0f7ee-ad2e-4f5a-8751-b64167322bc4', 'INDICATOR', 'Prioritizes tasks based on urgency and importance.', 1),
  ('313e431b-aae1-4ed9-be2f-e140323a8e45', 'f8f0f7ee-ad2e-4f5a-8751-b64167322bc4', 'INDICATOR', 'Consistently meets deadlines for assignments and projects.', 2),
  ('17c62d4d-6a31-47fe-8d13-c62737597b58', 'f8f0f7ee-ad2e-4f5a-8751-b64167322bc4', 'INDICATOR', 'Balances multiple responsibilities without compromising quality.', 3),
  ('98e41281-822a-4899-85aa-9e2b8f9ae160', 'f8f0f7ee-ad2e-4f5a-8751-b64167322bc4', 'INDICATOR', 'Allocates sufficient time for planning, execution, and review.', 4),
  ('40f6e4dd-166d-436a-9d64-c0fc0da2bded', 'f8f0f7ee-ad2e-4f5a-8751-b64167322bc4', 'INDICATOR', 'Uses tools and systems to track tasks and deadlines.', 5),
  ('14654bd5-f3a2-4969-8f9d-2069153079bc', 'f8f0f7ee-ad2e-4f5a-8751-b64167322bc4', 'PITFALL', 'Consistently missing deadlines.', 6),
  ('ed89cf84-ba0c-497b-b05b-08e18714eb3c', 'f8f0f7ee-ad2e-4f5a-8751-b64167322bc4', 'PITFALL', 'Last-minute rushing.', 7),
  ('308ee719-7a77-40a0-9990-e63ac91d44c0', 'f8f0f7ee-ad2e-4f5a-8751-b64167322bc4', 'PITFALL', 'Difficulty prioritizing.', 8),
  ('97430934-c064-4df5-8b37-dab6d91a1124', 'f8f0f7ee-ad2e-4f5a-8751-b64167322bc4', 'PITFALL', 'Taking on too much without realistic planning.', 9),
  ('9870b0cc-0d1d-4e49-a9df-bb8679931060', 'fd4df6b2-2d99-45c7-94c7-ad9678137da6', 'INDICATOR', 'Applies concepts learned in previous sessions to new problems.', 0),
  ('a0f28756-2529-4f67-a3b0-d991b26e8984', 'fd4df6b2-2d99-45c7-94c7-ad9678137da6', 'INDICATOR', 'Creates personal notes, summaries, or study materials to reinforce learning.', 1),
  ('4c7769aa-857c-4e34-b182-72cc2f98df2b', 'fd4df6b2-2d99-45c7-94c7-ad9678137da6', 'INDICATOR', 'Reviews and practices material regularly rather than cramming.', 2),
  ('33f98062-f6a6-4630-b162-ad9d8b81fe16', 'fd4df6b2-2d99-45c7-94c7-ad9678137da6', 'INDICATOR', 'Can recall and explain previously covered concepts when needed.', 3),
  ('670f969e-91be-431b-a68b-ec44dabcfd64', 'fd4df6b2-2d99-45c7-94c7-ad9678137da6', 'INDICATOR', 'Identifies personal learning strategies that work best for them.', 4),
  ('41d0b19e-2c22-4a4c-a0e6-14c24ae3112a', 'fd4df6b2-2d99-45c7-94c7-ad9678137da6', 'INDICATOR', 'Seeks out additional resources to deepen understanding.', 5),
  ('a0e220bd-8d6b-4366-ac1a-ba53ccc997b6', 'fd4df6b2-2d99-45c7-94c7-ad9678137da6', 'PITFALL', 'Repeatedly asking the same questions.', 6),
  ('5322e751-f9f2-4ef6-b76a-81b418ade948', 'fd4df6b2-2d99-45c7-94c7-ad9678137da6', 'PITFALL', 'Struggling to apply previously learned concepts.', 7),
  ('d51ce494-5497-4bb3-bb70-a7b914e8ca5c', 'fd4df6b2-2d99-45c7-94c7-ad9678137da6', 'PITFALL', 'Lack of study routine.', 8),
  ('d3ce2784-a57b-457a-946f-83e5d139b76b', 'fd4df6b2-2d99-45c7-94c7-ad9678137da6', 'PITFALL', 'Relying solely on in-class time for learning.', 9),
  ('7ab71473-ba25-461e-a8a4-3cdac3fcc7b7', 'caa0ea61-d64a-4e24-b936-c4268a4004a5', 'INDICATOR', 'Responds to messages and emails within expected timeframes.', 0),
  ('bf5f42e9-9011-43cf-8656-80ecccd82376', 'caa0ea61-d64a-4e24-b936-c4268a4004a5', 'INDICATOR', 'Proactively communicates when facing challenges or delays.', 1),
  ('7f7236ee-589b-4ba6-ac8a-a51180328981', 'caa0ea61-d64a-4e24-b936-c4268a4004a5', 'INDICATOR', 'Provides clear updates on progress and blockers.', 2),
  ('6e6aedd5-2046-4983-9378-02854be5aa66', 'caa0ea61-d64a-4e24-b936-c4268a4004a5', 'INDICATOR', 'Uses appropriate communication channels for different types of updates.', 3),
  ('ff02e550-8101-4f4c-97cf-4c1a7383cfbb', 'caa0ea61-d64a-4e24-b936-c4268a4004a5', 'INDICATOR', 'Follows through on commitments or communicates when adjustments are needed.', 4),
  ('4548d3f0-2b05-46d0-b58e-88e67274c015', 'caa0ea61-d64a-4e24-b936-c4268a4004a5', 'PITFALL', 'Going silent when facing difficulties.', 5),
  ('5a4401b6-c919-4440-87fc-5fcd6467ad85', 'caa0ea61-d64a-4e24-b936-c4268a4004a5', 'PITFALL', 'Missing deadlines without prior communication.', 6),
  ('d78297ae-5ecd-4399-983d-53931710f0dd', 'caa0ea61-d64a-4e24-b936-c4268a4004a5', 'PITFALL', 'Providing vague or incomplete updates.', 7),
  ('154bcc35-5e08-4ab3-b1d8-4797e19d9d3e', '2f6cb8a9-a6d0-4b6c-aaeb-d86c30819b17', 'INDICATOR', 'Consistently attends all scheduled sessions and arrives on time.', 0),
  ('0ab599b1-bddc-4bc4-8cb6-bce5b3626274', '2f6cb8a9-a6d0-4b6c-aaeb-d86c30819b17', 'INDICATOR', 'Actively participates in discussions and activities.', 1),
  ('069f33fb-3bee-4a4a-839b-9480986d7bfa', '2f6cb8a9-a6d0-4b6c-aaeb-d86c30819b17', 'INDICATOR', 'Communicates proactively when absence is unavoidable.', 2),
  ('63390707-69f4-49fd-9945-115ffd905149', '2f6cb8a9-a6d0-4b6c-aaeb-d86c30819b17', 'INDICATOR', 'Engages fully during sessions rather than appearing distracted.', 3),
  ('227b547f-8988-4515-a965-bbfcb6eb6e73', '2f6cb8a9-a6d0-4b6c-aaeb-d86c30819b17', 'PITFALL', 'Frequent absences or tardiness.', 4),
  ('5b65ae44-2532-412a-8319-606a873b671e', '2f6cb8a9-a6d0-4b6c-aaeb-d86c30819b17', 'PITFALL', 'Passive presence without engagement.', 5),
  ('a65d35bc-e33c-4284-b0fd-8ef337456e28', '2f6cb8a9-a6d0-4b6c-aaeb-d86c30819b17', 'PITFALL', 'Unexplained absences.', 6),
  ('9a3d33c0-c219-4365-99e9-7d1c4d18f21b', 'e96b0ba2-ce93-4f53-b6f4-8d6300ca4cd6', 'INDICATOR', 'Contributes meaningfully to group discussions and projects.', 0),
  ('492d95a4-eb89-495a-b6ae-0c0a5d69e1eb', 'e96b0ba2-ce93-4f53-b6f4-8d6300ca4cd6', 'INDICATOR', 'Listens actively to teammates'' ideas and perspectives.', 1),
  ('4313b3ff-fd17-42fa-91d8-c7ebc51f4581', 'e96b0ba2-ce93-4f53-b6f4-8d6300ca4cd6', 'INDICATOR', 'Offers help to peers who are struggling.', 2),
  ('5546ab0a-3e33-4c02-81a6-c214a7cdd36e', 'e96b0ba2-ce93-4f53-b6f4-8d6300ca4cd6', 'INDICATOR', 'Handles disagreements constructively and professionally.', 3),
  ('1d4e65c0-9a33-4f95-8172-75a2dbaa9929', 'e96b0ba2-ce93-4f53-b6f4-8d6300ca4cd6', 'INDICATOR', 'Shares credit for successes and takes shared responsibility for challenges.', 4),
  ('d534854f-eb37-44e3-a0bb-d855ae434591', 'e96b0ba2-ce93-4f53-b6f4-8d6300ca4cd6', 'INDICATOR', 'Adapts communication and work style to complement team dynamics.', 5),
  ('9297869f-3ea3-4937-8cde-b5237ddeb336', 'e96b0ba2-ce93-4f53-b6f4-8d6300ca4cd6', 'PITFALL', 'Dominating group work or being passive.', 6),
  ('a7916faf-1853-4b03-90c2-0ed2d9c3e85d', 'e96b0ba2-ce93-4f53-b6f4-8d6300ca4cd6', 'PITFALL', 'Difficulty compromising.', 7),
  ('d7031b69-3889-46d7-a3c9-8a8eea68b3d2', 'e96b0ba2-ce93-4f53-b6f4-8d6300ca4cd6', 'PITFALL', 'Not pulling one''s weight.', 8),
  ('1d343d89-b461-4dca-846c-eed5c8657859', 'e96b0ba2-ce93-4f53-b6f4-8d6300ca4cd6', 'PITFALL', 'Creating interpersonal conflicts.', 9),
  ('3c54ab73-649e-4c98-b60c-26bb6b80879f', '9c341432-c3d9-45f1-951c-0e513cea432e', 'INDICATOR', 'Takes initiative to organize team efforts and delegate tasks.', 0),
  ('ce39aa5a-de68-40f0-9bc3-e2c2ef7b24dc', '9c341432-c3d9-45f1-951c-0e513cea432e', 'INDICATOR', 'Recognizes and leverages individual team members'' strengths.', 1),
  ('1f212806-3a53-44a9-9d78-63e71ad45c22', '9c341432-c3d9-45f1-951c-0e513cea432e', 'INDICATOR', 'Maintains positive energy and momentum even when facing setbacks.', 2),
  ('2eafecfc-5e25-4409-adb0-e318d99c036e', '9c341432-c3d9-45f1-951c-0e513cea432e', 'INDICATOR', 'Facilitates decision-making and keeps projects moving forward.', 3),
  ('6faeeba0-6800-4d4e-a231-9b04556b240c', '9c341432-c3d9-45f1-951c-0e513cea432e', 'INDICATOR', 'Provides encouragement and support to teammates.', 4),
  ('0d4abefd-ac02-4c21-817a-5dd9c3a20708', '9c341432-c3d9-45f1-951c-0e513cea432e', 'INDICATOR', 'Models professionalism and work ethic for others.', 5),
  ('effacd9c-7e6f-4aa6-a3ac-d3462836b6fa', '9c341432-c3d9-45f1-951c-0e513cea432e', 'INDICATOR', 'Demonstrates ownership and responsibility over one''s own outcomes.', 6),
  ('790ff9db-600e-4783-9fbf-57fc6d7844e1', '9c341432-c3d9-45f1-951c-0e513cea432e', 'INDICATOR', 'Holds self and others accountable in a supportive manner.', 7),
  ('88a87bd2-dd66-4579-8276-7efa3574ad79', '9c341432-c3d9-45f1-951c-0e513cea432e', 'PITFALL', 'Micromanaging teammates.', 8),
  ('c669da12-786c-4480-94fb-966f698cbd49', '9c341432-c3d9-45f1-951c-0e513cea432e', 'PITFALL', 'Failing to delegate.', 9),
  ('7fed4853-10f8-45de-b83b-762febfdf75e', '9c341432-c3d9-45f1-951c-0e513cea432e', 'PITFALL', 'Negative attitude that affects team morale.', 10),
  ('0b1a84cb-28b5-4d03-b0a3-f46847bcff88', '9c341432-c3d9-45f1-951c-0e513cea432e', 'PITFALL', 'Avoiding accountability or playing the victim.', 11),
  ('9efb9083-65c6-4919-bb58-97bd03501945', 'dc21b9d2-bcc0-43bd-aa1c-ab9455c25a99', 'INDICATOR', 'Uses AI and other tools to enhance learning rather than bypass it.', 0),
  ('6985317d-c8cc-45eb-85d8-270145b7d656', 'dc21b9d2-bcc0-43bd-aa1c-ab9455c25a99', 'INDICATOR', 'Applies an appropriate level of skepticism over what AI produces and takes the necessary steps to validate it.', 1),
  ('e90f0ade-b14a-4b0c-972d-47cb6265eaa8', 'dc21b9d2-bcc0-43bd-aa1c-ab9455c25a99', 'INDICATOR', 'Properly attributes sources and respects intellectual property.', 2),
  ('ed33b16b-35f8-416e-be63-32c6ff5ffe44', 'dc21b9d2-bcc0-43bd-aa1c-ab9455c25a99', 'INDICATOR', 'Understands when and how to use various tools appropriately.', 3),
  ('a613fe2d-37f8-4eed-85ea-c30eee93d92b', 'dc21b9d2-bcc0-43bd-aa1c-ab9455c25a99', 'INDICATOR', 'Can explain and defend their own work, regardless of tools used.', 4),
  ('b9bdfac3-175a-4806-8bea-ae162e5a0a4f', 'dc21b9d2-bcc0-43bd-aa1c-ab9455c25a99', 'INDICATOR', 'Considers privacy, security, and ethical implications of technology choices.', 5),
  ('9aa554f1-830c-4e65-b093-94d221c7ab68', 'dc21b9d2-bcc0-43bd-aa1c-ab9455c25a99', 'INDICATOR', 'Balances tool usage with developing fundamental skills.', 6),
  ('789e5db3-c76d-4f28-81db-357c65d0ee75', 'dc21b9d2-bcc0-43bd-aa1c-ab9455c25a99', 'PITFALL', 'Over-reliance on AI without understanding underlying concepts.', 7),
  ('4120c66b-d6ab-4f51-964b-5c9c66e57497', 'dc21b9d2-bcc0-43bd-aa1c-ab9455c25a99', 'PITFALL', 'Plagiarism.', 8),
  ('16fb3993-1027-4024-92f7-e88c68213602', 'dc21b9d2-bcc0-43bd-aa1c-ab9455c25a99', 'PITFALL', 'Using tools to shortcut learning.', 9),
  ('6be0698f-3dc4-4d9b-834d-c1ecea68c97d', 'dc21b9d2-bcc0-43bd-aa1c-ab9455c25a99', 'PITFALL', 'Inability to work without specific tools.', 10),
  ('5401e170-cbcd-405d-b22c-eefdc83297c2', 'b36a9dd4-0885-4d0a-af8d-6cc7a09a84dd', 'INDICATOR', 'Make decisions and solve problems using sound, inclusive reasoning and judgment.', 0),
  ('558b1327-0eb9-493b-8193-c3854c9cac82', 'b36a9dd4-0885-4d0a-af8d-6cc7a09a84dd', 'INDICATOR', 'Gather and analyze information from a diverse set of sources and individuals to fully understand a problem.', 1),
  ('b1857ab4-f645-4b15-bebc-afc230a1a637', 'b36a9dd4-0885-4d0a-af8d-6cc7a09a84dd', 'INDICATOR', 'Accurately summarize and interpret data with an awareness of personal biases that may impact outcomes.', 2),
  ('68b86b8d-a366-4700-bfca-8d380f70c4a0', 'b36a9dd4-0885-4d0a-af8d-6cc7a09a84dd', 'INDICATOR', 'Effectively communicate actions and rationale, recognizing the diverse perspectives and lived experiences of stakeholders.', 3),
  ('de0ada20-a957-4590-83ae-4dc98cd8453a', 'b36a9dd4-0885-4d0a-af8d-6cc7a09a84dd', 'PITFALL', 'Jumping to conclusions without gathering sufficient information.', 4),
  ('cc4bf791-ad90-4bb7-bc03-f9bf7685236e', 'b36a9dd4-0885-4d0a-af8d-6cc7a09a84dd', 'PITFALL', 'Ignoring contradictory evidence.', 5),
  ('13426e0b-63b8-4f7c-ad03-2f4196f4252a', 'b36a9dd4-0885-4d0a-af8d-6cc7a09a84dd', 'PITFALL', 'Failing to consider how personal biases affect interpretation.', 6),
  ('f91107fb-8d66-40c2-a083-38ea8eeb1558', 'b36a9dd4-0885-4d0a-af8d-6cc7a09a84dd', 'PITFALL', 'Making decisions without considering impact on different stakeholders.', 7),
  ('aafe0b6a-aa4b-4df4-a8e0-1f2a094b8a56', '0a2666f3-0f1d-4b71-8026-a68222427738', 'INDICATOR', 'Shows an awareness of own strengths and areas for development.', 0),
  ('cc0570f4-0d5d-4f8f-938a-6179a2d7dc57', '0a2666f3-0f1d-4b71-8026-a68222427738', 'INDICATOR', 'Identify areas for continual growth while pursuing and applying feedback.', 1),
  ('58821ab4-79df-4501-9fe6-ec7e42d78421', '0a2666f3-0f1d-4b71-8026-a68222427738', 'INDICATOR', 'Develop plans and goals for one''s future career.', 2),
  ('a3e1125e-08a4-4c39-8c23-27d884bb4ab2', '0a2666f3-0f1d-4b71-8026-a68222427738', 'INDICATOR', 'Display curiosity; seek out opportunities to learn.', 3),
  ('8b8a8473-b841-4dad-b9b0-8ce3edb4edc1', '0a2666f3-0f1d-4b71-8026-a68222427738', 'INDICATOR', 'Establish, maintain, and/or leverage relationships with people who can help one professionally.', 4),
  ('6c00a710-c2b1-4441-b8f3-f82322c62d01', '0a2666f3-0f1d-4b71-8026-a68222427738', 'PITFALL', 'Waiting for opportunities to come rather than seeking them out.', 5),
  ('5e142231-7f28-4a74-a5f3-47b91d18d85a', '0a2666f3-0f1d-4b71-8026-a68222427738', 'PITFALL', 'Failing to reflect on strengths and growth areas.', 6),
  ('ab071469-6bee-4876-8abb-3b4194955ddf', '0a2666f3-0f1d-4b71-8026-a68222427738', 'PITFALL', 'Setting vague career goals without actionable steps.', 7),
  ('6c8cce8c-dd4d-4d75-a4d4-f54ae89afadc', '0a2666f3-0f1d-4b71-8026-a68222427738', 'PITFALL', 'Not building or maintaining professional relationships.', 8),
  ('3207d65e-c636-443a-90a5-2507ebbe738b', '0a2666f3-0f1d-4b71-8026-a68222427738', 'PITFALL', 'Ignoring feedback about development areas.', 9),
  ('8b0e34c7-1dfc-4b85-b2b0-7c51d00f11c0', '533b83bb-432a-4121-b545-13f3182ff281', 'INDICATOR', 'Solicit and use feedback from multiple cultural perspectives to make inclusive and equity-minded decisions.', 0),
  ('872c4551-85ec-4427-bfc1-fd8f1dda8633', '533b83bb-432a-4121-b545-13f3182ff281', 'INDICATOR', 'Actively contribute to inclusive and equitable practices that influence individual and systemic change.', 1),
  ('625066e1-51a6-4238-b1f9-9d30ba584a3b', '533b83bb-432a-4121-b545-13f3182ff281', 'INDICATOR', 'Advocate for inclusion, equitable practices, justice, and empowerment for historically marginalized communities.', 2),
  ('f3ceeaea-56c6-4d75-afe3-55c6a78c13b1', '533b83bb-432a-4121-b545-13f3182ff281', 'INDICATOR', 'Keep an open mind to diverse ideas and new ways of thinking.', 3),
  ('1714c85a-b3be-41d7-a9a8-a19c052ca1b3', '533b83bb-432a-4121-b545-13f3182ff281', 'PITFALL', 'Assuming one perspective represents all.', 4),
  ('3ef9c1ff-e504-49ec-a54e-704b5c2c4782', '533b83bb-432a-4121-b545-13f3182ff281', 'PITFALL', 'Perpetuating exclusive practices without questioning them.', 5),
  ('df503cb6-81ae-4dbe-be25-00b1782088b3', '533b83bb-432a-4121-b545-13f3182ff281', 'PITFALL', 'Dismissing concerns about equity as “politics”.', 6),
  ('feb00360-47c6-4c96-be7b-b583bca4f47b', '533b83bb-432a-4121-b545-13f3182ff281', 'PITFALL', 'Making decisions without considering differential impact on marginalized groups.', 7),
  ('d4061b7f-2a3f-424d-80fb-be56be690af0', '533b83bb-432a-4121-b545-13f3182ff281', 'PITFALL', 'Remaining silent when witnessing exclusionary behavior.', 8),
  ('1917abc9-de14-438b-b658-2dcb1aed61b0', '95210331-3a3d-4edd-9b4b-14f06fa18b39', 'INDICATOR', 'Develop clear, well-organized written narratives that engage readers and convey key messages effectively.', 0),
  ('725ac62e-2f0b-4adb-ac00-4d9df38a5ab9', '95210331-3a3d-4edd-9b4b-14f06fa18b39', 'INDICATOR', 'Adapt communication style and content to suit different audiences and contexts.', 1),
  ('766e519c-6a38-4eda-ad76-e8f719393800', '95210331-3a3d-4edd-9b4b-14f06fa18b39', 'INDICATOR', 'Use concrete examples and vivid details to illustrate abstract concepts and make ideas memorable.', 2),
  ('747053d8-8ae4-4a16-a6d0-9b4a1ec20f56', '95210331-3a3d-4edd-9b4b-14f06fa18b39', 'INDICATOR', 'Structure presentations and conversations with a clear beginning, middle, and end that guides the audience through complex information.', 3),
  ('831c98ba-73b8-48a2-bd79-202335e8a3fa', '95210331-3a3d-4edd-9b4b-14f06fa18b39', 'PITFALL', 'Losing the audience with excessive technical jargon or abstract concepts.', 4),
  ('4d42beea-0082-4231-9691-9ae711406299', '95210331-3a3d-4edd-9b4b-14f06fa18b39', 'PITFALL', 'Poor organization that confuses rather than clarifies.', 5),
  ('52f80b13-b7c0-45b9-94cc-bfe22867f064', '95210331-3a3d-4edd-9b4b-14f06fa18b39', 'PITFALL', 'Failing to adapt tone or detail level for different audiences.', 6),
  ('3524fea5-e0a3-4106-bd35-1b833428f014', '95210331-3a3d-4edd-9b4b-14f06fa18b39', 'PITFALL', 'Including irrelevant details that distract from the main message.', 7),
  ('bd0c82bf-6367-4b17-9fd3-2027b949cb76', '95210331-3a3d-4edd-9b4b-14f06fa18b39', 'PITFALL', 'Rushing through explanations without checking for understanding.', 8),
  ('2987eed3-8a68-4178-ad4b-b9a05af92777', 'd6007f4f-8f64-403c-962f-6c2894a21a4a', 'INDICATOR', 'Ask thoughtful questions that go beyond surface-level understanding to explore underlying principles and connections.', 0),
  ('7eff0266-3c19-4656-83d1-ea5034f7e616', 'd6007f4f-8f64-403c-962f-6c2894a21a4a', 'INDICATOR', 'Actively seek out learning resources and opportunities beyond assigned materials to deepen knowledge.', 1),
  ('2d58c83f-0a83-40c5-9db0-39a39f7a06b2', 'd6007f4f-8f64-403c-962f-6c2894a21a4a', 'INDICATOR', 'Experiment with new approaches and technologies, even when not directly required for assignments.', 2),
  ('9468894d-6229-4cbf-92fe-b64098de6e48', 'd6007f4f-8f64-403c-962f-6c2894a21a4a', 'INDICATOR', 'Challenge assumptions and explore alternative solutions rather than accepting the first answer that works.', 3),
  ('f46f1cb9-dcb0-4b73-a4f0-2d938bb96d20', 'd6007f4f-8f64-403c-962f-6c2894a21a4a', 'PITFALL', 'Accepting information at face value without deeper inquiry.', 4),
  ('a3891f95-ce70-4fe4-9984-b28527d8fec1', 'd6007f4f-8f64-403c-962f-6c2894a21a4a', 'PITFALL', 'Only engaging with assigned materials.', 5),
  ('bafc8114-14de-46be-b6ca-fdf34ca47e3f', 'd6007f4f-8f64-403c-962f-6c2894a21a4a', 'PITFALL', 'Sticking rigidly to familiar approaches even when they''re not optimal.', 6),
  ('a96b3ffd-2fd1-47a0-995d-f772749bd68c', 'd6007f4f-8f64-403c-962f-6c2894a21a4a', 'PITFALL', 'Viewing “getting it working” as the end goal rather than understanding why it works.', 7),
  ('55444d94-c8a5-4701-893f-1169fb31a4d9', 'd6007f4f-8f64-403c-962f-6c2894a21a4a', 'PITFALL', 'Treating mistakes as failures rather than learning opportunities.', 8),
  ('994747ac-8e3b-4b2e-ad61-f2c32a5daf36', '49d198e0-6209-4582-8b75-9708a969d7bc', 'INDICATOR', 'Shares not just what they did, but how they did it and why it matters.', 0),
  ('72810dc3-feb3-42ac-a65d-ca5f3a84118e', '49d198e0-6209-4582-8b75-9708a969d7bc', 'INDICATOR', 'Articulates technical decisions and their impact on the project timeline, performance, or user experience.', 1),
  ('0f61b387-35e9-4eda-b7eb-5fcb5ef21eb9', '49d198e0-6209-4582-8b75-9708a969d7bc', 'INDICATOR', 'Uses effective analogies, diagrams, and code snippets to enhance explanations.', 2),
  ('fd2a896c-4875-4522-9928-bebeeec3b953', '49d198e0-6209-4582-8b75-9708a969d7bc', 'INDICATOR', 'Adapts communication style based on audience (technical vs. non-technical stakeholders).', 3),
  ('34a5e96d-49e1-496a-b706-e5c304516fee', '49d198e0-6209-4582-8b75-9708a969d7bc', 'INDICATOR', 'Can effectively communicate in both writing and in oral presentations.', 4),
  ('b97fecc2-c329-40d8-9f69-05c64119ded0', '49d198e0-6209-4582-8b75-9708a969d7bc', 'PITFALL', 'Struggling to explain code clearly.', 5),
  ('054faa5f-6add-4091-a192-deb0429004ed', '49d198e0-6209-4582-8b75-9708a969d7bc', 'PITFALL', 'Lack of audience awareness.', 6),
  ('cf7f2bee-951a-48f1-a2ca-a67d165dda4b', '49d198e0-6209-4582-8b75-9708a969d7bc', 'PITFALL', 'Difficulty articulating technical decisions and tradeoffs.', 7),
  ('02216f57-0597-4f47-a511-ce25b78b4dcd', '73ed3650-d36c-4a8d-a127-4d9afec78113', 'INDICATOR', 'Can illustrate a concept using an analogy or a diagram.', 0),
  ('c031ca8e-080c-452f-9750-7ed2dff35834', '73ed3650-d36c-4a8d-a127-4d9afec78113', 'INDICATOR', 'Can explain a concept clearly with simplified language.', 1),
  ('409de4c8-ffa8-4f82-a99c-7c987c3fedb3', '73ed3650-d36c-4a8d-a127-4d9afec78113', 'INDICATOR', 'Corrects misconceptions when new evidence emerges.', 2),
  ('0326cc6c-8a4f-418d-a43d-55b71b75fe2c', '73ed3650-d36c-4a8d-a127-4d9afec78113', 'INDICATOR', 'Can communicate algorithms using pseudocode.', 3),
  ('0babfa7a-7853-4dca-b53e-36ddc74bff0c', '73ed3650-d36c-4a8d-a127-4d9afec78113', 'INDICATOR', 'Can identify essential vs. extraneous details when analyzing a problem.', 4),
  ('ff88dd32-6717-4759-89f7-21455f993d45', '73ed3650-d36c-4a8d-a127-4d9afec78113', 'INDICATOR', 'Accurately applies known solutions, data structures, and algorithms to new but similar problems.', 5),
  ('23962894-a3d4-47fd-a005-e42aa27f8dcf', '73ed3650-d36c-4a8d-a127-4d9afec78113', 'INDICATOR', 'Makes informed technical decisions based on understanding of high-level tradeoffs.', 6),
  ('a04498bc-c252-4991-bff3-c7b6e28d3c59', '73ed3650-d36c-4a8d-a127-4d9afec78113', 'PITFALL', 'Memorizing syntax without understanding why.', 7),
  ('1a0134d7-867b-4a77-9201-d29867b3d20f', '73ed3650-d36c-4a8d-a127-4d9afec78113', 'PITFALL', 'Holding misconceptions.', 8),
  ('8fab67e5-6d41-4a47-8d30-e83e72ad7771', '73ed3650-d36c-4a8d-a127-4d9afec78113', 'PITFALL', 'Difficulty transferring knowledge to new situations.', 9),
  ('d3d6f593-eaa9-4371-9264-258894f64d63', '897c4218-e4a0-404e-8d65-4f61bfd7cda4', 'INDICATOR', 'Sees the big picture and how pieces connect (front-end, back-end, DB, APIs).', 0),
  ('e63600f6-050c-4181-bb17-984ac91b52a5', '897c4218-e4a0-404e-8d65-4f61bfd7cda4', 'INDICATOR', 'Anticipates ripple effects of a change.', 1),
  ('1755ba09-3f0a-4e38-9b88-71d7851ba6bb', '897c4218-e4a0-404e-8d65-4f61bfd7cda4', 'INDICATOR', 'Designs for extensibility, debug-ability, and reliability, not just “getting it to work.”', 2),
  ('93d268fc-4df1-478a-a45b-2ad51187dbca', '897c4218-e4a0-404e-8d65-4f61bfd7cda4', 'INDICATOR', 'Breaks large problems into smaller ones.', 3),
  ('ac2685d8-2eef-4905-ac08-fef07e02053f', '897c4218-e4a0-404e-8d65-4f61bfd7cda4', 'INDICATOR', 'Identifies dependencies between subtasks.', 4),
  ('4693a67e-23a5-4d60-bac5-030a3be84551', '897c4218-e4a0-404e-8d65-4f61bfd7cda4', 'PITFALL', 'Tunnel vision on one layer of the stack.', 5),
  ('6223ecdb-0d09-4eff-9d42-41608c0f33ed', '897c4218-e4a0-404e-8d65-4f61bfd7cda4', 'PITFALL', 'Failing to anticipate ripple effects.', 6),
  ('533ad8bc-ff00-45e5-8ebd-46ae1bd25f37', '897c4218-e4a0-404e-8d65-4f61bfd7cda4', 'PITFALL', 'Struggling to “zoom out.”', 7),
  ('21f921c4-7e18-4922-a245-3b03e0a80e57', 'a5ce8fbb-4a48-4f7a-b8c2-a329878cad9a', 'INDICATOR', 'Debugs with a structured approach instead of randomly trying fixes.', 0),
  ('18238070-11b4-47ca-9285-51dda2b79c20', 'a5ce8fbb-4a48-4f7a-b8c2-a329878cad9a', 'INDICATOR', 'Reads error messages and test output carefully and investigates root causes.', 1),
  ('3644afdb-721b-48ed-8e9e-8546e4c2c7ad', 'a5ce8fbb-4a48-4f7a-b8c2-a329878cad9a', 'INDICATOR', 'Tries multiple strategies when initial approach fails.', 2),
  ('a065e363-a81a-478f-ac50-b8359373918c', 'a5ce8fbb-4a48-4f7a-b8c2-a329878cad9a', 'INDICATOR', 'Seeks to understand root causes rather than applying surface-level fixes.', 3),
  ('3e8aedc9-1a47-4abd-a9e5-2919e91a09a7', 'a5ce8fbb-4a48-4f7a-b8c2-a329878cad9a', 'INDICATOR', 'Can trace through code execution to understand program behavior.', 4),
  ('1d5a9c46-8e49-4763-894e-3bb5365dcf53', 'a5ce8fbb-4a48-4f7a-b8c2-a329878cad9a', 'INDICATOR', 'Tests solutions comprehensively, ensuring edge cases are covered.', 5),
  ('eb4eac6c-f463-4fd3-b773-e5fb25291b78', 'a5ce8fbb-4a48-4f7a-b8c2-a329878cad9a', 'PITFALL', 'Frequently “guessing” at what the problem is without systematically finding the root.', 6),
  ('12c0884c-c9ba-497d-ae68-19af58112101', 'a5ce8fbb-4a48-4f7a-b8c2-a329878cad9a', 'PITFALL', 'Jumping into code without planning an approach first.', 7),
  ('a9154f0d-7e8a-4098-ad2c-c952ecb41ca6', 'a5ce8fbb-4a48-4f7a-b8c2-a329878cad9a', 'PITFALL', 'Ignoring error messages.', 8),
  ('2f55be06-4282-46ca-a976-ac1f11be5a42', 'a5ce8fbb-4a48-4f7a-b8c2-a329878cad9a', 'PITFALL', 'Not asking for help in a timely manner.', 9),
  ('a9134690-7bb8-4c70-9b20-3997f829a982', 'a5ce8fbb-4a48-4f7a-b8c2-a329878cad9a', 'PITFALL', 'Giving up too quickly when the initial approach doesn''t work.', 10),
  ('33334b39-d902-4b03-bb4d-5d9128c74bcd', 'd2a633d4-11bd-4a9d-8678-47273c4998f4', 'INDICATOR', 'Reads documentation and instructions thoroughly.', 0),
  ('ad627d79-4b12-4a13-8754-dca19d78b727', 'd2a633d4-11bd-4a9d-8678-47273c4998f4', 'INDICATOR', 'Writes clean, readable code that follows established style guides and coding conventions.', 1),
  ('1d443160-474a-4b19-a785-c03a613172e7', 'd2a633d4-11bd-4a9d-8678-47273c4998f4', 'INDICATOR', 'Creates well-structured, error-free documentation, READMEs, and presentations.', 2),
  ('f4d77b1d-565d-4aae-aedf-385c9a396cff', 'd2a633d4-11bd-4a9d-8678-47273c4998f4', 'INDICATOR', 'Double-checks work before submitting for review or presentation.', 3),
  ('acb7fbe5-6aea-4f45-8aa3-7ac252b0f528', 'd2a633d4-11bd-4a9d-8678-47273c4998f4', 'INDICATOR', 'Proactively seeks feedback and implements learnings in subsequent work.', 4),
  ('74838954-bd39-46ac-a2ad-62fa76c8805a', 'd2a633d4-11bd-4a9d-8678-47273c4998f4', 'INDICATOR', 'Follows git best practices.', 5),
  ('578ea7bb-dbd0-4b30-bfd0-4ec120ef194a', 'd2a633d4-11bd-4a9d-8678-47273c4998f4', 'PITFALL', 'Submitting code that raises numerous linting flags and doesn''t adhere to known style guides.', 6),
  ('20e5ec57-cb4c-4467-b625-9242114b6566', 'd2a633d4-11bd-4a9d-8678-47273c4998f4', 'PITFALL', 'Creating documentation, technical writing, and technical presentations that are error-filled or contain typos or technical inaccuracies.', 7),
  ('ac9d1ce6-f84e-4cae-87a1-fd0e67c1cffa', 'd2a633d4-11bd-4a9d-8678-47273c4998f4', 'PITFALL', 'Repeating the same mistakes without incorporating feedback.', 8);
