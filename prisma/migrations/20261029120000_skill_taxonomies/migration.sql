-- The skills taxonomies: one per discipline, each a list of groups holding skills. Every graded
-- section of an assignment is tagged with one skill by id inside `assignments.sections`, and the
-- Skills tabs read a fellow's figures from the approved rounds at request time, so nothing here
-- holds evidence and no grade is touched. Nothing points at these rows by foreign key.
--
-- The seed is the two taxonomy documents in the curriculum repository, `skills-taxonomy-swe.csv`
-- and `skills-taxonomy-da.csv`. The INSERT statements at the foot were generated from them once,
-- with each id a UUID version 5 of the discipline and the canonical id, so a database seeded from
-- a regenerated copy would name every skill the same way.

-- CreateTable
CREATE TABLE "skill_taxonomies" (
    "id" UUID NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_taxonomies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_groups" (
    "id" UUID NOT NULL,
    "taxonomy_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" UUID NOT NULL,
    "taxonomy_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "canonical_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "skill_taxonomies_discipline_key" ON "skill_taxonomies"("discipline");

-- CreateIndex
CREATE INDEX "skill_groups_taxonomy_id_position_idx" ON "skill_groups"("taxonomy_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "skill_groups_taxonomy_id_name_key" ON "skill_groups"("taxonomy_id", "name");

-- CreateIndex
CREATE INDEX "skills_group_id_position_idx" ON "skills"("group_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "skills_taxonomy_id_canonical_id_key" ON "skills"("taxonomy_id", "canonical_id");

-- AddForeignKey
ALTER TABLE "skill_groups" ADD CONSTRAINT "skill_groups_taxonomy_id_fkey" FOREIGN KEY ("taxonomy_id") REFERENCES "skill_taxonomies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_taxonomy_id_fkey" FOREIGN KEY ("taxonomy_id") REFERENCES "skill_taxonomies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "skill_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written from here down. `migrate diff` cannot see any of it, so it survives rather than
-- being proposed for removal on the next migration.

-- Reached only through the application's own connection, like the competency tables. The write
-- side is admins only, and a client role that could edit it could rename what a fellow is read on.
REVOKE ALL ON TABLE public."skill_taxonomies" FROM anon, authenticated;
ALTER TABLE public."skill_taxonomies" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."skill_groups" FROM anon, authenticated;
ALTER TABLE public."skill_groups" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."skills" FROM anon, authenticated;
ALTER TABLE public."skills" ENABLE ROW LEVEL SECURITY;

-- The two taxonomies as the documents stood on 2026-10-29: Software Engineering with nine groups
-- and fifty skills, Data Analytics with three groups and eighty-six. Seeded here rather than
-- behind a button because it is seeded exactly once per database and `db:deploy` already runs
-- exactly once per database. Admins extend and edit the lists from the Skills screen.

INSERT INTO "skill_taxonomies" ("id", "discipline", "name") VALUES
  ('136b2a1c-9303-5372-b872-e15b913cd6fb', 'SOFTWARE_ENGINEERING', 'Software Engineering'),
  ('1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'DATA_ANALYTICS', 'Data Analytics');

INSERT INTO "skill_groups" ("id", "taxonomy_id", "name", "position") VALUES
  ('bff8f6a6-c87a-5bf4-8d9f-85a3e6e11d4e', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'Technical Reasoning', 0),
  ('557c41c6-a903-563a-8997-67bb639659ed', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'Implementation', 1),
  ('a031c117-4500-58d9-9a30-a345c042e3da', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'Problem Framing and Product Judgment', 2),
  ('b0a21e82-0009-546c-befc-c0b0e2cba141', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'Architecture and Design', 3),
  ('99152e82-b3f7-5c72-ac14-11288d048fbc', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'Delegation and Context Engineering', 4),
  ('852a31de-c02a-52d2-b670-af815977da28', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'Verification and Quality Control', 5),
  ('6cd76ea0-8d14-5810-8e0c-2304741c20c8', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'Systems Operations and Constraints', 6),
  ('6b73bb71-1691-5f2a-b3d2-5cc1d4df681a', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'Handoff and Communication', 7),
  ('7dfc723a-21ca-5797-8587-89a53df9561d', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'Leadership and Development', 8),
  ('a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'Technical', 0),
  ('a2b3ab66-2e49-5116-8551-6135cb99c997', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'Professional', 1),
  ('5fc33293-c75b-5905-a831-2ce8949d7763', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'AI', 2);

INSERT INTO "skills" ("id", "taxonomy_id", "group_id", "canonical_id", "name", "definition", "position") VALUES
  ('97e761b3-0be9-5c89-93bf-32c5d47b0f46', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'bff8f6a6-c87a-5bf4-8d9f-85a3e6e11d4e', 'reading-and-predicting-code', 'Reading and Predicting Code', 'Read code you did not write, build a model of its intent from its names and structure, and predict its output or final state for a given input.', 0),
  ('78ddd6ae-2834-5067-b838-788252d911c2', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'bff8f6a6-c87a-5bf4-8d9f-85a3e6e11d4e', 'explaining-a-concept', 'Explaining a Concept', 'Explain a programming concept accurately in plain language, using its correct terminology and an example or analogy.', 1),
  ('3b6174dc-315c-5adc-ae62-3e6450bc8759', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'bff8f6a6-c87a-5bf4-8d9f-85a3e6e11d4e', 'justifying-a-design-choice', 'Justifying a Design Choice', 'Explain, in writing or aloud, why one piece of code or one sub-problem was solved one way rather than another, naming what the choice buys and what it costs, using concepts from the curriculum.', 2),
  ('26293c34-d52f-5eb4-b025-4cb0334e5a68', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'bff8f6a6-c87a-5bf4-8d9f-85a3e6e11d4e', 'algorithmic-complexity', 'Algorithmic Complexity', 'Reason about how an approach''s runtime or memory grows with input size, including the cost of each operation on a data structure, and choose between approaches on that basis.', 3),
  ('1a32b2e2-2d3b-5435-a372-b15a66cf7567', '136b2a1c-9303-5372-b872-e15b913cd6fb', '557c41c6-a903-563a-8997-67bb639659ed', 'python-programming', 'Python Programming', 'Write Python that represents data with the built-in types, expresses logic with functions, conditionals and iteration, handles input and errors, and is organized into modules.', 0),
  ('dae0cb60-7447-55c4-aaa0-71895f0c7de3', '136b2a1c-9303-5372-b872-e15b913cd6fb', '557c41c6-a903-563a-8997-67bb639659ed', 'object-oriented-programming', 'Object-Oriented Programming', 'Model data and behavior with classes, using encapsulation, inheritance and polymorphism where they fit.', 1),
  ('c231cad0-6aae-544f-bff6-b234f8f08e01', '136b2a1c-9303-5372-b872-e15b913cd6fb', '557c41c6-a903-563a-8997-67bb639659ed', 'algorithms-and-data-structures', 'Algorithms and Data Structures', 'Implement a solution to an algorithmic problem using the right data structure and a known pattern, within a stated complexity.', 2),
  ('074fb9a1-92ee-5620-80b2-40465e574dee', '136b2a1c-9303-5372-b872-e15b913cd6fb', '557c41c6-a903-563a-8997-67bb639659ed', 'markup-and-styling', 'Markup and Styling', 'Build an accessible, responsive page with HTML, CSS and a templating language.', 3),
  ('72553c89-dc20-5115-abe6-be650cd5ce81', '136b2a1c-9303-5372-b872-e15b913cd6fb', '557c41c6-a903-563a-8997-67bb639659ed', 'server-side-development', 'Server-Side Development', 'Build a server that handles requests, renders responses, consumes external APIs, and organizes its routes, models and views.', 4),
  ('14d5bbfd-f528-5331-8cb7-523cd4be0a4e', '136b2a1c-9303-5372-b872-e15b913cd6fb', '557c41c6-a903-563a-8997-67bb639659ed', 'data-persistence-and-querying', 'Data Persistence and Querying', 'Create tables, write queries with joins and aggregates, and connect an application to its database.', 5),
  ('0f2712f1-050b-59bf-bcda-35c37cb6caec', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'a031c117-4500-58d9-9a30-a345c042e3da', 'requirement-elicitation', 'Requirement Elicitation', 'Ask a stakeholder the questions that reveal the real constraints behind a request, and record the requirements that result.', 0),
  ('071f00de-7d69-538b-973e-c9e5b5d28a3f', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'a031c117-4500-58d9-9a30-a345c042e3da', 'scope-definition', 'Scope Definition', 'State what the first version must do and what it will not, separate must-have from nice-to-have, and say what "done" means before building.', 1),
  ('f57eb7b7-ec90-53d7-a324-05640bc3088e', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'a031c117-4500-58d9-9a30-a345c042e3da', 'prioritization-under-constraint', 'Prioritization Under Constraint', 'Order the work by importance, dependency and available time, and explain the order.', 2),
  ('18e47863-c690-5fc0-9c41-483e98ac4149', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'a031c117-4500-58d9-9a30-a345c042e3da', 'user-empathy', 'User Empathy', 'Describe who the software is for and what they will actually do with it, and let that description decide the design.', 3),
  ('c94650e6-08d0-5503-b302-a540cc794942', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'b0a21e82-0009-546c-befc-c0b0e2cba141', 'code-organization', 'Code Organization', 'Organize code into modules and layers that each have one responsibility, and keep each function at one level of abstraction.', 0),
  ('c8bc22e4-e929-5c90-ba36-4bd34f76d823', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'b0a21e82-0009-546c-befc-c0b0e2cba141', 'data-modeling', 'Data Modeling', 'Represent an application''s data with the shape that fits it, from a list of dictionaries in a command-line program to a normalized relational schema with its relationships, and justify the shape against the operations the application performs on it.', 1),
  ('aed35112-e6ed-512a-ab8d-1e7bb114b6c8', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'b0a21e82-0009-546c-befc-c0b0e2cba141', 'interface-design', 'Interface Design', 'Design the routes, request and response shapes and error behavior of a server so that a client can rely on them.', 2),
  ('6a32d2ea-3b2e-5ac6-b2e2-7303c26c401e', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'b0a21e82-0009-546c-befc-c0b0e2cba141', 'extensibility', 'Extensibility', 'Design so that the next change is cheap, and add a feature to an existing codebase without breaking what it already does.', 3),
  ('bbb40c6e-e839-59a6-b293-ebf613a889be', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'b0a21e82-0009-546c-befc-c0b0e2cba141', 'technology-selection', 'Technology Selection', 'Choose the tool or approach that fits this problem from the options available, and justify the choice against the alternatives.', 4),
  ('6e181193-5071-5698-a05c-37343ee76f25', '136b2a1c-9303-5372-b872-e15b913cd6fb', 'b0a21e82-0009-546c-befc-c0b0e2cba141', 'evaluating-code-quality', 'Evaluating Code Quality', 'Judge a piece of code or a proposed solution for readability, simplicity and fit for its purpose, and justify the judgment with curriculum concepts.', 5),
  ('8e45004a-4c23-574d-a74a-6c4b6042368b', '136b2a1c-9303-5372-b872-e15b913cd6fb', '99152e82-b3f7-5c72-ac14-11288d048fbc', 'spec-writing-for-models', 'Spec Writing for Models', 'Write an instruction precise enough that a model produces the intended artifact, naming the task, the constraints, the context and the expected output.', 0),
  ('d19a1be5-30b2-54c7-9e0c-33b59f7fc4e2', '136b2a1c-9303-5372-b872-e15b913cd6fb', '99152e82-b3f7-5c72-ac14-11288d048fbc', 'task-decomposition-for-delegation', 'Task Decomposition for Delegation', 'Break a piece of work into units a model can execute reliably, and say why that unit size.', 1),
  ('fbf5a40d-4ed3-5ebb-8458-e62dfc89c328', '136b2a1c-9303-5372-b872-e15b913cd6fb', '99152e82-b3f7-5c72-ac14-11288d048fbc', 'context-management', 'Context Management', 'Decide what a model receives, what persists across sessions and what is left out, and recognize when a session has degraded and needs a reset.', 2),
  ('5757ae56-eae4-521d-ae24-d3ee553ab81f', '136b2a1c-9303-5372-b872-e15b913cd6fb', '99152e82-b3f7-5c72-ac14-11288d048fbc', 'scope-containment', 'Scope Containment', 'Detect when generated output exceeds what was asked, and reject the excess rather than accept it.', 3),
  ('eb06e169-e8db-5936-a593-72a3dd2168a5', '136b2a1c-9303-5372-b872-e15b913cd6fb', '99152e82-b3f7-5c72-ac14-11288d048fbc', 'iterative-correction', 'Iterative Correction', 'Steer wrong output toward right output without restarting, and recognize when restarting or typing it yourself is cheaper.', 4),
  ('6bc10cc2-2817-5096-92d7-73b1a35c9b5b', '136b2a1c-9303-5372-b872-e15b913cd6fb', '852a31de-c02a-52d2-b670-af815977da28', 'detecting-plausible-wrong', 'Detecting Plausible-Wrong Code', 'Find the defects in generated code that is well named, well formatted and subtly incorrect, at the obvious, subtle and architectural tiers.', 0),
  ('840d0e3d-e2c0-519c-9fc0-ad02842e4493', '136b2a1c-9303-5372-b872-e15b913cd6fb', '852a31de-c02a-52d2-b670-af815977da28', 'reading-a-traceback', 'Reading a Traceback', 'Read a traceback from the bottom up to name the error type, the failing line and the call that supplied the value, and state the cause.', 1),
  ('2f768aca-5c99-5ae2-8ae3-f944a3a67226', '136b2a1c-9303-5372-b872-e15b913cd6fb', '852a31de-c02a-52d2-b670-af815977da28', 'methodical-debugging', 'Methodical Debugging', 'Reproduce a failure in code you did not write, form a hypothesis, isolate the cause with a targeted check, and repair it minimally while preserving the rest.', 2),
  ('5f571c78-9916-5250-8b95-618b5684b562', '136b2a1c-9303-5372-b872-e15b913cd6fb', '852a31de-c02a-52d2-b670-af815977da28', 'requirement-verification', 'Requirement Verification', 'Judge whether a piece of code satisfies a stated requirement, and name what is missing or extra.', 3),
  ('88139c20-815f-51fd-93d6-bb5c16a2026d', '136b2a1c-9303-5372-b872-e15b913cd6fb', '852a31de-c02a-52d2-b670-af815977da28', 'testing-strategy', 'Testing Strategy', 'Decide what to test and at what level, write tests that prove it, and say what a passing test does and does not show.', 4),
  ('15b71e57-3635-5ad2-bbcc-da70776ba1a1', '136b2a1c-9303-5372-b872-e15b913cd6fb', '852a31de-c02a-52d2-b670-af815977da28', 'edge-case-reasoning', 'Edge-Case Reasoning', 'Identify the empty, missing, oversized and malformed inputs a function or a program will receive, and handle each one.', 5),
  ('c4313d5b-c1c5-5738-880b-d32911b5d085', '136b2a1c-9303-5372-b872-e15b913cd6fb', '6cd76ea0-8d14-5810-8e0c-2304741c20c8', 'version-control', 'Version Control', 'Work from the command line to keep a readable history with small commits and clear messages, work on a branch, open and merge pull requests, and resolve a merge conflict.', 0),
  ('d545faf0-3619-562e-ab8b-a666297d02f9', '136b2a1c-9303-5372-b872-e15b913cd6fb', '6cd76ea0-8d14-5810-8e0c-2304741c20c8', 'security', 'Security', 'Implement authentication and authorization, reject hostile input, and manage secrets so that the application resists the common attacks on its stack.', 1),
  ('56736cba-df26-55b1-b362-00153ccb2b85', '136b2a1c-9303-5372-b872-e15b913cd6fb', '6cd76ea0-8d14-5810-8e0c-2304741c20c8', 'deployment-and-environments', 'Deployment and Environments', 'Run the application somewhere real and configure it correctly across development and production with environment variables.', 2),
  ('459ee183-b4f7-57d2-b628-da735a633d1b', '136b2a1c-9303-5372-b872-e15b913cd6fb', '6cd76ea0-8d14-5810-8e0c-2304741c20c8', 'scalability-reasoning', 'Scalability Reasoning', 'Identify where a system will break as load, data or users grow, and tell the actual bottleneck from the one that feels likely.', 3),
  ('d5b0a706-aa2c-55e8-8136-1d38e9b0eca5', '136b2a1c-9303-5372-b872-e15b913cd6fb', '6cd76ea0-8d14-5810-8e0c-2304741c20c8', 'cost-awareness', 'Cost Awareness', 'Estimate what a design costs to run, including service and token costs, and reduce it without losing what the feature is for.', 4),
  ('ebf6169e-9cdb-5715-a7b6-b9c6dd9080be', '136b2a1c-9303-5372-b872-e15b913cd6fb', '6b73bb71-1691-5f2a-b3d2-5cc1d4df681a', 'technical-writing', 'Technical Writing', 'Write prose that is clear, organized, free of spelling and grammar errors, and rendered as intended.', 0),
  ('0ea32768-a958-5dcb-bf12-09d9afb3f782', '136b2a1c-9303-5372-b872-e15b913cd6fb', '6b73bb71-1691-5f2a-b3d2-5cc1d4df681a', 'code-readability', 'Code Readability', 'Name, structure and comment code so that a reader can follow what it does and why, following the language''s style conventions.', 1),
  ('cd191668-8d82-55fe-9b2c-fa814b5175fd', '136b2a1c-9303-5372-b872-e15b913cd6fb', '6b73bb71-1691-5f2a-b3d2-5cc1d4df681a', 'documentation', 'Documentation', 'Write a README, setup instructions and decision notes that let someone else, or a fresh model session, set up, run and extend the project.', 2),
  ('96f395fe-51e4-56ba-8524-df3479853c39', '136b2a1c-9303-5372-b872-e15b913cd6fb', '6b73bb71-1691-5f2a-b3d2-5cc1d4df681a', 'architecture-articulation', 'Architecture Articulation', 'Explain and defend the design of an entire system, in writing or aloud, to a technical audience that has not seen it, including decisions made by a model.', 3),
  ('6c04e1a9-de15-544f-901b-4e7cd1f33571', '136b2a1c-9303-5372-b872-e15b913cd6fb', '6b73bb71-1691-5f2a-b3d2-5cc1d4df681a', 'stakeholder-presentation', 'Stakeholder Presentation', 'Present what was built, for whom and why to a non-technical audience, and translate technical constraints into their terms.', 4),
  ('2b31d98e-b7a0-59d9-8ef8-e583d9709789', '136b2a1c-9303-5372-b872-e15b913cd6fb', '6b73bb71-1691-5f2a-b3d2-5cc1d4df681a', 'interview-communication', 'Interview Communication', 'Answer a technical or behavioral interview question aloud with a clear structure and specific evidence from your own work.', 5),
  ('61f2115b-5d06-5430-aad6-31bff51a0a3f', '136b2a1c-9303-5372-b872-e15b913cd6fb', '7dfc723a-21ca-5797-8587-89a53df9561d', 'self-reflection', 'Self-Reflection', 'Connect an experience, reading, film or discussion to your own identity, values and growth, with specific evidence from your life.', 0),
  ('bd580c89-a4cb-5a87-be8f-a76ae4869e14', '136b2a1c-9303-5372-b872-e15b913cd6fb', '7dfc723a-21ca-5797-8587-89a53df9561d', 'applying-leadership-concepts', 'Applying Leadership Concepts', 'Apply a named concept from the leadership curriculum, such as social identity, intersectionality or socialization, accurately to a case or an experience.', 1),
  ('00202c66-262b-5615-ae5f-892ccddb54ae', '136b2a1c-9303-5372-b872-e15b913cd6fb', '7dfc723a-21ca-5797-8587-89a53df9561d', 'evidence-based-reasoning', 'Evidence-Based Reasoning', 'Support a claim with specific evidence and a line of reasoning the reader can follow.', 2),
  ('a20a5a9e-b4fe-56e0-a26d-5f3e1d9d8318', '136b2a1c-9303-5372-b872-e15b913cd6fb', '7dfc723a-21ca-5797-8587-89a53df9561d', 'ethical-reasoning', 'Ethical Reasoning', 'Reason about equity, power and responsibility in a workplace situation and propose a recommendation someone could act on.', 3),
  ('f215c219-b059-5679-904e-c6f34f9a14b0', '136b2a1c-9303-5372-b872-e15b913cd6fb', '7dfc723a-21ca-5797-8587-89a53df9561d', 'storytelling', 'Storytelling', 'Craft a narrative with a throughline, a structure that guides the reader, and development from one part to the next.', 4),
  ('72ade766-bdc9-506a-9fe0-fcc09db9981d', '136b2a1c-9303-5372-b872-e15b913cd6fb', '7dfc723a-21ca-5797-8587-89a53df9561d', 'writing-conventions', 'Writing Conventions', 'Write with correct grammar, spelling and punctuation in a leadership assignment.', 5),
  ('d1c32370-6ba1-5f9d-89bf-66baf4d1e7d3', '136b2a1c-9303-5372-b872-e15b913cd6fb', '7dfc723a-21ca-5797-8587-89a53df9561d', 'professional-identity', 'Professional Identity', 'Articulate your strengths, values and professional identity, and connect them to the career you are preparing for.', 6),
  ('196ce07f-e750-5e1a-acaf-49b40aa31310', '136b2a1c-9303-5372-b872-e15b913cd6fb', '7dfc723a-21ca-5797-8587-89a53df9561d', 'career-materials', 'Career Materials', 'Produce a resume, cover letter or profile tailored to one specific employer or audience.', 7),
  ('37894bb4-1a47-5f37-bef6-d09687d8b34a', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'general-programming-coding', 'General Programming & Coding', 'Use core programming concepts to represent data, express logic, and reason about how code behaves.', 0),
  ('7065eb7f-d5b0-5478-a213-1d3c9e1e4b23', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'data-literacy', 'Data Literacy', 'Inspect unfamiliar data, interpret its structure and types, and ask concrete questions about quality and provenance.', 1),
  ('51ba922d-ae96-5566-9db3-83e243d72987', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'git-version-control', 'Git & Version Control', 'Track, organize, and share changes to technical work with version-control practices.', 2),
  ('0bba63cd-d2da-545a-b132-4713c6ec5352', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'terminal-command-line', 'Terminal / Command Line', 'Navigate and operate a development environment from a command-line interface.', 3),
  ('95789112-c513-58a1-9f72-befeb5a43671', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'control-flow-loops', 'Control Flow & Loops', 'Control program execution with conditionals and iteration.', 4),
  ('7c84a663-46f5-521b-bca7-201dc048ea4e', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'functions-modular-programming', 'Functions & Modular Programming', 'Organize code into reusable functions with clear inputs, outputs, and responsibilities.', 5),
  ('de005cdb-12fd-53d3-8a29-b74c8cee3290', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'object-oriented-programming', 'Object-Oriented Programming', 'Model data and behavior with classes and objects.', 6),
  ('d6e36547-e4b6-5616-9d60-a6f8931316ed', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'algorithmic-complexity-big-o', 'Algorithmic Complexity (Big-O)', 'Reason about how an approach''s runtime or resource use grows with input size, and choose between approaches on that basis.', 7),
  ('f7ab54a8-5630-5ae9-af16-31e5d7831d9c', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'data-structures-selection', 'Data Structures Selection', 'Choose and use an appropriate data structure for a task, and justify the choice against the access patterns the task actually needs.', 8),
  ('9348f3e3-d1ac-5619-913e-b20b44bf74cb', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'statistical-analysis', 'Statistical Analysis', 'Use statistical summaries and methods to describe data and support evidence-based conclusions.', 9),
  ('96bc4a5e-bd19-517e-899b-a2bfd94e696f', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'data-distributions-shape', 'Data Distributions & Shape', 'Interpret the shape and behavior of data distributions.', 10),
  ('69c13907-f1b3-512f-9347-a16145bf1463', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'data-mining', 'Data Mining', 'Explore data to identify meaningful patterns, segments, relationships, or anomalies.', 11),
  ('5a082783-f0de-5c95-adf6-c6db13401641', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'data-cleaning-imputation', 'Data Cleaning & Imputation', 'Prepare data for trustworthy analysis by identifying and resolving quality issues, including missingness.', 12),
  ('a59864df-2575-54d1-ab50-aecd4757d6a8', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'sql', 'SQL', 'Query and transform relational data using SQL.', 13),
  ('927662a3-3e4c-5739-9659-e6f107ad3da2', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'relational-databases', 'Relational Databases', 'Design and work with relational database structures and constraints.', 14),
  ('e2fea88c-ac10-595f-97ad-65e4542add82', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'python', 'Python', 'Use Python fluently for data-oriented scripting, analysis, and integration.', 15),
  ('13208ca0-fd0e-5cc6-a974-f52e25455878', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'excel', 'Excel', 'Use spreadsheet functionality to analyze, summarize, and communicate data.', 16),
  ('8fa98c8d-be36-5cc8-b703-d24412aa4edd', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'data-visualization', 'Data Visualization', 'Choose and create charts that accurately support analysis and communication.', 17),
  ('2e3da078-2b93-5fee-879a-84efd8685e24', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'tableau', 'Tableau', 'Build interactive analytical views and dashboards in Tableau.', 18),
  ('20effcac-9a71-5ea0-85fe-308a0fc92a95', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'query-optimization', 'Query Optimization', 'Evaluate and improve SQL query performance.', 19),
  ('0d4d8f99-c60c-5b81-96bd-e81d20fc8ae9', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'data-modeling', 'Data Modeling', 'Design logical and physical data structures that represent entities, relationships, and analytical needs clearly.', 20),
  ('20f85251-0c77-5418-95d1-b31282269a28', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'data-warehousing', 'Data Warehousing', 'Organize integrated analytical data in warehouse structures that support reliable historical reporting and analysis.', 21),
  ('e21c6c4c-fac4-52b7-8f7a-381d7f460ba0', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'dbt', 'dbt', 'Develop tested, documented analytics transformations with dbt.', 22),
  ('e9add0c7-c86b-5055-9d74-d609f1269d17', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'etl-elt', 'ETL/ELT', 'Design repeatable extract, load, and transform workflows that move and prepare data for downstream use.', 23),
  ('c40fb9c6-1ca3-51d2-bb2e-aa621bff2797', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'apache-airflow', 'Apache Airflow', 'Define, schedule, and monitor data workflows using Apache Airflow.', 24),
  ('2f18851e-ac6a-515c-9a47-8a84fd8f9108', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'automation', 'Automation', 'Replace repeatable manual data-work steps with reliable scripted or orchestrated processes.', 25),
  ('b4e86e21-7787-5e22-924b-6f002d71534d', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'data-engineering', 'Data Engineering', 'Build and maintain reliable systems that move, transform, and deliver data for downstream use.', 26),
  ('939b9087-da2b-5a22-a8ff-436b60cb7952', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'monitoring-observability', 'Monitoring & Observability', 'Instrument and monitor data systems so failures, freshness issues, and performance problems can be detected and diagnosed.', 27),
  ('c909ed90-2d50-586b-9695-a5ac1d90027c', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'ci-cd', 'CI/CD', 'Automate validation and delivery of code or data-work changes.', 28),
  ('5e47eae2-2a25-5f93-9dc3-965c8be70747', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'databricks', 'Databricks', 'Use Databricks to develop and run collaborative cloud-based data and analytics workloads.', 29),
  ('383f85be-0abb-5898-9441-76b8e6a68421', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'apache-spark', 'Apache Spark', 'Use distributed Spark concepts and operations to process large datasets across multiple compute resources.', 30),
  ('bba50322-0d35-5450-a571-bdeb7f136b5e', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'pyspark', 'PySpark', 'Use Spark''s Python API to transform, analyze, and process distributed datasets.', 31),
  ('a9a45138-57d6-5cc9-a5a0-cc5cc8565cda', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'distributed-systems', 'Distributed Systems', 'Reason about data and computation distributed across multiple machines, including coordination, partitioning, and failure considerations.', 32),
  ('6d7b73e1-a5a7-57cf-ac97-e1ad8f0538db', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'scalability', 'Scalability', 'Design or evaluate systems so workload, data volume, or user demand can grow without unacceptable loss of performance or reliability.', 33),
  ('81f6de68-c68e-59eb-afe4-fbd43fd38d89', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'cloud-architecture', 'Cloud Architecture', 'Design data-platform components and services in the cloud with appropriate compute, storage, networking, reliability, and cost tradeoffs.', 34),
  ('d746efed-f9cb-50b1-9237-dbdc38f03938', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'delta-lake', 'Delta Lake', 'Use Delta Lake concepts and table features to improve reliability, consistency, and manageability of lake-based analytical data.', 35),
  ('7d8b3eae-7284-5f61-be52-ec95d2ea4b9b', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'data-lake', 'Data Lake', 'Organize and manage large volumes of raw and processed data in flexible lake-based storage for downstream analytics and processing.', 36),
  ('638b0d9f-8b7a-5aa0-a55f-77c7209ac560', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'aws', 'AWS', 'Use foundational Amazon Web Services concepts and services in data-platform workflows.', 37),
  ('5b69a67e-b5d1-5319-8c95-29df19902364', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'azure', 'Azure', 'Use foundational Microsoft Azure concepts and services in data-platform workflows.', 38),
  ('d7bc7419-20c7-51f5-9e5c-590b79db5998', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'gcp', 'GCP', 'Use foundational Google Cloud Platform concepts and services in data-platform workflows.', 39),
  ('cd607a41-3485-534b-826d-83cd809152de', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'docker', 'Docker', 'Package and run applications or data workloads in portable containers.', 40),
  ('2d694c94-983f-5b89-ae73-8a304aa0d417', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'cybersecurity', 'Cybersecurity', 'Apply foundational security practices to protect data, systems, credentials, and access.', 41),
  ('689ad79f-55b5-5364-87dd-987587adc77b', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 's3', 'Amazon S3', 'Use object storage concepts and Amazon S3 to store, organize, and access data assets.', 42),
  ('bdfc9882-6745-5065-9eef-88137e74d9ef', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'data-governance', 'Data Governance', 'Establish policies, ownership, standards, and controls for responsible and trustworthy data use.', 43),
  ('d6f960ad-33f2-5305-b7e0-8f0051beb5a6', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'master-data-management', 'Master Data Management', 'Maintain consistent, governed representations of critical shared business entities across systems.', 44),
  ('fdf9ed86-f7fb-572e-aa13-e1d17eb57de0', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'data-security-compliance', 'Data Security & Compliance', 'Apply security controls and compliance requirements to the handling, access, storage, and use of data.', 45),
  ('af9bd6c1-8bf6-515f-a08c-acfae641c3de', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'federal-security-compliance', 'Federal Security Compliance', 'Interpret and apply applicable federal security requirements to data systems, access, and operational practices.', 46),
  ('3e2e6da0-9e7b-57ae-bcb1-1e1ffc9546bc', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'cjis-records-compliance', 'CJIS Records Compliance', 'Apply Criminal Justice Information Services requirements to the handling, access, storage, and protection of covered records.', 47),
  ('bf74454b-ccb0-51fd-8d64-48250af93553', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'metadata-management', 'Metadata Management', 'Create and maintain descriptive, technical, and operational information that makes data assets understandable and governable.', 48),
  ('004ebc99-774c-5071-a443-28be87bc9273', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'data-cataloging', 'Data Cataloging', 'Organize and document data assets in a catalog so people can discover, understand, and use them appropriately.', 49),
  ('febebe70-b68e-5add-99c8-ac1b45600698', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'pii-classification', 'PII Classification', 'Identify and classify personally identifiable information so it can be handled according to appropriate privacy and security requirements.', 50),
  ('7cc3ebc1-e71d-5e22-a950-7884800592b4', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'open-data-management', 'Open Data Management', 'Prepare, maintain, and publish open or public data so it is usable, documented, and responsibly managed.', 51),
  ('eb7074d2-85cc-5957-b9b4-4061633363f1', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'gis-geospatial-analysis', 'GIS / Geospatial Analysis', 'Use location-based data and geospatial methods to analyze spatial patterns, relationships, or context.', 52),
  ('60ee78bb-3fbb-5569-89d5-95db36e4f816', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'regression-classification', 'Regression & Classification', 'Build and evaluate supervised models for numeric and categorical prediction tasks.', 53),
  ('8020b4a7-b4f8-5a89-876b-37990241d622', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'predictive-modeling', 'Predictive Modeling', 'Develop predictive workflows that connect features, models, evaluation, and use-case decisions.', 54),
  ('321086af-4c9d-5dfd-9c3c-35017f6a8634', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'scikit-learn', 'scikit-learn', 'Implement machine-learning workflows with scikit-learn.', 55),
  ('6aa0fd67-a06c-5ac3-b8d3-1546cf521ea1', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'mlops', 'MLOps', 'Operationalize machine-learning work through reproducibility, monitoring, and lifecycle practices.', 56),
  ('da602dd5-4b3a-56bd-826d-97d4dd3ed1a0', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a1ab8ef9-4c08-5669-9d9f-9cf7875a196c', 'unsupervised-learning', 'Unsupervised Learning', 'Use unlabeled-data methods to discover structure or groups.', 57),
  ('23827c21-c8f9-5bd8-8a1b-c29765868022', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a2b3ab66-2e49-5116-8551-6135cb99c997', 'curiosity', 'Curiosity', 'Ask useful questions, investigate uncertainty, and pursue evidence beyond the obvious first answer.', 0),
  ('b5d24534-0c7d-5b44-a3b3-82efb5bdc4a8', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a2b3ab66-2e49-5116-8551-6135cb99c997', 'critical-thinking', 'Critical Thinking', 'Evaluate evidence, assumptions, alternatives, and limitations before reaching a conclusion.', 1),
  ('0de0e3d4-acda-5c9e-9165-a80825e406ac', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a2b3ab66-2e49-5116-8551-6135cb99c997', 'attention-to-detail', 'Attention to Detail', 'Maintain accuracy and consistency by noticing errors, mismatches, and incomplete work.', 2),
  ('6d8ef9fc-9bc4-5f25-8382-169ce5ab1146', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a2b3ab66-2e49-5116-8551-6135cb99c997', 'problem-solving', 'Problem Solving', 'Break ambiguous problems into workable parts, test approaches, and select effective solutions.', 3),
  ('f559c16f-a993-5aa0-9d85-c5270edfdc4a', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a2b3ab66-2e49-5116-8551-6135cb99c997', 'collaboration', 'Collaboration', 'Work productively with others through shared problem solving, feedback, and coordination.', 4),
  ('eebd7d31-95b4-595b-89f3-dae8f0ab7c10', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a2b3ab66-2e49-5116-8551-6135cb99c997', 'stakeholder-communication', 'Stakeholder Communication', 'Communicate technical work so stakeholders can understand findings, implications, and decisions.', 5),
  ('c96918fd-4ed9-502b-81c0-3616f2841dc9', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a2b3ab66-2e49-5116-8551-6135cb99c997', 'business-acumen', 'Business Acumen', 'Connect analytical work to organizational goals, constraints, stakeholders, and value.', 6),
  ('89d6ba00-f23d-5a57-8bda-39ac560c8a98', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a2b3ab66-2e49-5116-8551-6135cb99c997', 'data-ethics', 'Data Ethics', 'Recognize and address ethical implications in data collection, analysis, communication, and use.', 7),
  ('c63c58c3-1370-52c5-a800-2e5419db12e8', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a2b3ab66-2e49-5116-8551-6135cb99c997', 'documentation', 'Documentation', 'Create clear records that make technical work understandable, reproducible, and maintainable.', 8),
  ('85755ec8-20e5-57a8-b2d7-62ba3dda61d5', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a2b3ab66-2e49-5116-8551-6135cb99c997', 'creativity', 'Creativity', 'Generate useful, non-template approaches, explanations, or designs for a problem.', 9),
  ('eeb6f7e3-b290-5b56-a4b0-05f4dd7f8348', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a2b3ab66-2e49-5116-8551-6135cb99c997', 'prioritization', 'Prioritization', 'Sequence work according to importance, dependency, risk, and available time.', 10),
  ('cf9bae39-4612-5b2f-ab5e-5bd28b0b275a', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a2b3ab66-2e49-5116-8551-6135cb99c997', 'project-management', 'Project Management', 'Plan and coordinate work so scope, dependencies, progress, and deliverables stay manageable.', 11),
  ('65c4cd1b-a8cb-50df-b7c0-a0cb36e79ee9', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a2b3ab66-2e49-5116-8551-6135cb99c997', 'leadership', 'Leadership', 'Help a group move toward a shared outcome through direction, facilitation, and responsibility.', 12),
  ('69d9b42e-0de5-529c-b8c7-2bdffc996829', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a2b3ab66-2e49-5116-8551-6135cb99c997', 'ownership-accountability', 'Ownership & Accountability', 'Take responsibility for the quality, completion, and consequences of one''s work.', 13),
  ('fd6d3231-54ca-54d6-b3de-d72b9ff2ee5b', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a2b3ab66-2e49-5116-8551-6135cb99c997', 'adaptability', 'Adaptability', 'Adjust effectively when tools, requirements, evidence, or constraints change.', 14),
  ('b017ae7d-3ab2-526f-97fc-90f0837c0f66', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', 'a2b3ab66-2e49-5116-8551-6135cb99c997', 'decision-intelligence', 'Decision Intelligence', 'Use evidence, uncertainty, context, and tradeoffs to support sound decisions.', 15),
  ('197ee1b8-7407-5093-946f-16c964439574', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', '5fc33293-c75b-5905-a831-2ce8949d7763', 'ai-literacy', 'AI Literacy', 'Understand AI capabilities and limitations well enough to use AI appropriately and maintain human responsibility.', 0),
  ('727c9560-515f-5a7f-bb00-ed0733dd0b5d', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', '5fc33293-c75b-5905-a831-2ce8949d7763', 'ai-output-validation', 'AI Output Validation', 'Verify AI-generated claims, calculations, code, interpretations, or recommendations before relying on them.', 1),
  ('cbd1bbfb-d3c2-586a-aa33-1560875883b3', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', '5fc33293-c75b-5905-a831-2ce8949d7763', 'ai-evaluation', 'AI Evaluation', 'Judge AI output for correctness, relevance, completeness, quality, usefulness, and limitations.', 2),
  ('15ce9562-ac2c-543c-aac7-b93fd8e7df7f', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', '5fc33293-c75b-5905-a831-2ce8949d7763', 'ai-as-critic', 'AI as Critic', 'Use AI deliberately to challenge one''s own work, then independently judge whether the critique is valid.', 3),
  ('5d25c8b2-cb16-5864-9b8f-266ffca78019', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', '5fc33293-c75b-5905-a831-2ce8949d7763', 'ai-assisted-coding', 'AI-Assisted Coding', 'Use AI to generate, explain, debug, or improve code while retaining human responsibility for correctness.', 4),
  ('a487f08b-ab86-5a00-a580-9f113b7b7cc7', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', '5fc33293-c75b-5905-a831-2ce8949d7763', 'prompt-engineering', 'Prompt Engineering', 'Design and iteratively refine instructions that make an AI task, constraints, context, and expected output clear.', 5),
  ('0ae55b48-7933-54a5-a033-58e913fc9020', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', '5fc33293-c75b-5905-a831-2ce8949d7763', 'genai-llms', 'Generative AI & LLMs', 'Understand practical generative-AI and large-language-model behavior, uses, and limitations.', 6),
  ('a01eeaba-f0f1-5a35-a0a7-69b0d4eb3338', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', '5fc33293-c75b-5905-a831-2ce8949d7763', 'context-engineering', 'Context Engineering', 'Select, structure, and manage the information an AI system receives so it can perform a task effectively.', 7),
  ('b672bbef-4e2f-5348-b24c-7cbf20e5a427', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', '5fc33293-c75b-5905-a831-2ce8949d7763', 'rag', 'RAG', 'Ground generative-AI responses in retrieved external knowledge and evaluate retrieval quality.', 8),
  ('05a5ec56-c61a-5c5b-8310-f7fd6b7c7e31', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', '5fc33293-c75b-5905-a831-2ce8949d7763', 'ai-tool-orchestration', 'AI Tool Orchestration', 'Coordinate models, tools, data sources, and intermediate outputs into reliable multi-step AI workflows.', 9),
  ('6cd8bd04-909a-5ee9-afa8-a52805837d13', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', '5fc33293-c75b-5905-a831-2ce8949d7763', 'agentic-ai', 'Agentic AI', 'Design or operate AI systems that pursue goals through planning, tool use, iterative action, and feedback under human oversight.', 10),
  ('e3f808b3-5315-5323-a467-a017a3715605', '1cbd919a-ad30-5142-b952-fa1cb5f7bbf9', '5fc33293-c75b-5905-a831-2ce8949d7763', 'responsible-ai-bias-fairness', 'Responsible AI, Bias & Fairness', 'Identify and mitigate harmful, biased, unfair, or poorly governed AI behavior.', 11);
