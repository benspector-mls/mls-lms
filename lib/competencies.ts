/**
 * The Marcy Lab School competencies: what they are called, what working toward one looks like,
 * and what working away from one looks like.
 *
 * Transcribed from `reference-material/competencies.md`. The source's pitfalls are comma-run
 * sentences; here each run is split into discrete entries, because a pitfall is something a
 * goal can be built against and a goal names one thing.
 *
 * **The list is content that is still being developed, which decides two things about this file.**
 * It lives in code rather than in a table, so editing it is editing this file and shipping — no
 * authoring screen for a list that one person maintains. And every entry's id is hand-assigned
 * and permanent: a stored goal holds the id forever, so rewording an entry must never change it.
 * Rewording the *text* is always safe, because a goal copies the text it chose at the moment of
 * agreement and never reads it back from here.
 *
 * **Browser-safe and importing nothing but the generated enum**, in the manner of
 * `lib/course-units.ts`: the competency
 * picker runs in the browser, and the coaching router reads the same list on the server so a
 * goal's copied text is taken from this file rather than from the client.
 */

import type { CompetencyEntryKind } from "./generated/prisma/enums";

export type { CompetencyEntryKind };

/** The three sections of the source document, in presentation order. */
export type CompetencyGroup = "PROFESSIONALISM" | "LEADERSHIP_SEMINAR" | "SWE_TECHNICAL";

/** One selectable line: an indicator or a pitfall. */
export type Entry = {
  /**
   * Permanent. The competency's slug, a slash, then this entry's slug — and a pitfall's slug
   * begins `pitfall-`, so the one part of an entry that survives every rewording also says what
   * it is.
   */
  id: string;
  text: string;
};

export type Competency = {
  /** Permanent, for the same reason an entry's is. */
  id: string;
  group: CompetencyGroup;
  name: string;
  /** The source's one-line definition, shown wherever the name alone is not enough. */
  blurb: string;
  indicators: readonly Entry[];
  pitfalls: readonly Entry[];
};

export const COMPETENCY_GROUPS = [
  "PROFESSIONALISM",
  "LEADERSHIP_SEMINAR",
  "SWE_TECHNICAL",
] as const satisfies readonly CompetencyGroup[];

export type GroupMeta = {
  /** The section heading, as the source document titles it. */
  label: string;
};

/**
 * `satisfies` rather than an annotation, so a group added to the union and forgotten here is a
 * compile error — the same guarantee `CATEGORY_META` makes in `lib/course-units.ts`.
 */
export const GROUP_META = {
  PROFESSIONALISM: { label: "Professionalism & Productivity" },
  LEADERSHIP_SEMINAR: { label: "Leadership Seminar" },
  SWE_TECHNICAL: { label: "SWE Technical" },
} satisfies Record<CompetencyGroup, GroupMeta>;

export const COMPETENCIES = [
  // ————— Professionalism & Productivity —————
  {
    id: "growth-mindset",
    group: "PROFESSIONALISM",
    name: "Growth Mindset",
    blurb:
      "Deriving satisfaction from growth and proactively seeking feedback and assistance to continuously improve and evolve.",
    indicators: [
      {
        id: "growth-mindset/views-challenges",
        text: "Views challenges as opportunities to learn rather than obstacles.",
      },
      {
        id: "growth-mindset/takes-initiative",
        text: "Takes initiative to learn new skills and derives satisfaction from progress.",
      },
      {
        id: "growth-mindset/seeks-feedback",
        text: "Actively seeks feedback on work and incorporates it into future efforts.",
      },
      {
        id: "growth-mindset/asks-for-help",
        text: "Asks for help when stuck rather than struggling in silence.",
      },
      {
        id: "growth-mindset/receives-criticism",
        text: "Responds positively to constructive criticism.",
      },
      {
        id: "growth-mindset/reflects-on-mistakes",
        text: "Reflects on mistakes to understand root causes and prevent recurrence (self-awareness).",
      },
      {
        id: "growth-mindset/celebrates-progress",
        text: "Celebrates progress and small wins along the learning journey.",
      },
    ],
    pitfalls: [
      {
        id: "growth-mindset/pitfall-defensive",
        text: "Becoming defensive when receiving feedback.",
      },
      { id: "growth-mindset/pitfall-avoids-challenges", text: "Avoiding challenges." },
      {
        id: "growth-mindset/pitfall-gives-up-quickly",
        text: "Giving up quickly when faced with difficulty.",
      },
      {
        id: "growth-mindset/pitfall-fixed-mindset",
        text: "Viewing abilities as fixed rather than developable.",
      },
    ],
  },
  {
    id: "time-task-management",
    group: "PROFESSIONALISM",
    name: "Time & Task Management",
    blurb:
      "Prioritizing workloads effectively to consistently meet deadlines and deliver reliable results.",
    indicators: [
      {
        id: "time-task-management/breaks-down-projects",
        text: "Breaks large projects into manageable tasks with realistic timelines.",
      },
      {
        id: "time-task-management/prioritizes-tasks",
        text: "Prioritizes tasks based on urgency and importance.",
      },
      {
        id: "time-task-management/meets-deadlines",
        text: "Consistently meets deadlines for assignments and projects.",
      },
      {
        id: "time-task-management/balances-responsibilities",
        text: "Balances multiple responsibilities without compromising quality.",
      },
      {
        id: "time-task-management/allocates-time",
        text: "Allocates sufficient time for planning, execution, and review.",
      },
      {
        id: "time-task-management/uses-tracking-tools",
        text: "Uses tools and systems to track tasks and deadlines.",
      },
    ],
    pitfalls: [
      {
        id: "time-task-management/pitfall-misses-deadlines",
        text: "Consistently missing deadlines.",
      },
      { id: "time-task-management/pitfall-last-minute-rush", text: "Last-minute rushing." },
      { id: "time-task-management/pitfall-cannot-prioritize", text: "Difficulty prioritizing." },
      {
        id: "time-task-management/pitfall-overcommits",
        text: "Taking on too much without realistic planning.",
      },
    ],
  },
  {
    id: "learning-retention",
    group: "PROFESSIONALISM",
    name: "Learning & Retaining Information",
    blurb:
      "Effectively learning new skills and retaining that knowledge. Taking ownership of one's educational journey through disciplined study and self-management.",
    indicators: [
      {
        id: "learning-retention/applies-prior-concepts",
        text: "Applies concepts learned in previous sessions to new problems.",
      },
      {
        id: "learning-retention/creates-study-materials",
        text: "Creates personal notes, summaries, or study materials to reinforce learning.",
      },
      {
        id: "learning-retention/reviews-regularly",
        text: "Reviews and practices material regularly rather than cramming.",
      },
      {
        id: "learning-retention/recalls-and-explains",
        text: "Can recall and explain previously covered concepts when needed.",
      },
      {
        id: "learning-retention/knows-own-strategies",
        text: "Identifies personal learning strategies that work best for them.",
      },
      {
        id: "learning-retention/seeks-resources",
        text: "Seeks out additional resources to deepen understanding.",
      },
    ],
    pitfalls: [
      {
        id: "learning-retention/pitfall-repeats-questions",
        text: "Repeatedly asking the same questions.",
      },
      {
        id: "learning-retention/pitfall-cannot-transfer",
        text: "Struggling to apply previously learned concepts.",
      },
      { id: "learning-retention/pitfall-no-study-routine", text: "Lack of study routine." },
      {
        id: "learning-retention/pitfall-class-time-only",
        text: "Relying solely on in-class time for learning.",
      },
    ],
  },
  {
    id: "transparent-communication",
    group: "PROFESSIONALISM",
    name: "Timely and Transparent Communication",
    blurb:
      "Managing professional obligations through timely, transparent updates regarding status and responsibilities.",
    indicators: [
      {
        id: "transparent-communication/responds-timely",
        text: "Responds to messages and emails within expected timeframes.",
      },
      {
        id: "transparent-communication/flags-challenges-early",
        text: "Proactively communicates when facing challenges or delays.",
      },
      {
        id: "transparent-communication/clear-status-updates",
        text: "Provides clear updates on progress and blockers.",
      },
      {
        id: "transparent-communication/right-channels",
        text: "Uses appropriate communication channels for different types of updates.",
      },
      {
        id: "transparent-communication/follows-through",
        text: "Follows through on commitments or communicates when adjustments are needed.",
      },
    ],
    pitfalls: [
      {
        id: "transparent-communication/pitfall-goes-silent",
        text: "Going silent when facing difficulties.",
      },
      {
        id: "transparent-communication/pitfall-unannounced-misses",
        text: "Missing deadlines without prior communication.",
      },
      {
        id: "transparent-communication/pitfall-vague-updates",
        text: "Providing vague or incomplete updates.",
      },
    ],
  },
  {
    id: "presence-participation",
    group: "PROFESSIONALISM",
    name: "Presence & Participation",
    blurb:
      "Demonstrating reliability and commitment through high attendance and participation rates.",
    indicators: [
      {
        id: "presence-participation/attends-on-time",
        text: "Consistently attends all scheduled sessions and arrives on time.",
      },
      {
        id: "presence-participation/participates-actively",
        text: "Actively participates in discussions and activities.",
      },
      {
        id: "presence-participation/communicates-absences",
        text: "Communicates proactively when absence is unavoidable.",
      },
      {
        id: "presence-participation/engages-fully",
        text: "Engages fully during sessions rather than appearing distracted.",
      },
    ],
    pitfalls: [
      {
        id: "presence-participation/pitfall-absent-or-late",
        text: "Frequent absences or tardiness.",
      },
      {
        id: "presence-participation/pitfall-passive-presence",
        text: "Passive presence without engagement.",
      },
      { id: "presence-participation/pitfall-unexplained-absences", text: "Unexplained absences." },
    ],
  },
  {
    id: "collaboration",
    group: "PROFESSIONALISM",
    name: "Collaboration",
    blurb:
      "Working harmoniously within a team to achieve shared objectives through mutual support.",
    indicators: [
      {
        id: "collaboration/contributes-meaningfully",
        text: "Contributes meaningfully to group discussions and projects.",
      },
      {
        id: "collaboration/listens-actively",
        text: "Listens actively to teammates' ideas and perspectives.",
      },
      { id: "collaboration/helps-peers", text: "Offers help to peers who are struggling." },
      {
        id: "collaboration/handles-disagreement",
        text: "Handles disagreements constructively and professionally.",
      },
      {
        id: "collaboration/shares-credit",
        text: "Shares credit for successes and takes shared responsibility for challenges.",
      },
      {
        id: "collaboration/adapts-to-team",
        text: "Adapts communication and work style to complement team dynamics.",
      },
    ],
    pitfalls: [
      {
        id: "collaboration/pitfall-dominates-or-passive",
        text: "Dominating group work or being passive.",
      },
      { id: "collaboration/pitfall-wont-compromise", text: "Difficulty compromising." },
      { id: "collaboration/pitfall-under-contributes", text: "Not pulling one's weight." },
      { id: "collaboration/pitfall-creates-conflict", text: "Creating interpersonal conflicts." },
    ],
  },
  {
    id: "leadership",
    group: "PROFESSIONALISM",
    name: "Leadership",
    blurb:
      "Motivating others and managing project lifecycles by leveraging team strengths and maintaining a positive, goal-oriented attitude.",
    indicators: [
      {
        id: "leadership/organizes-and-delegates",
        text: "Takes initiative to organize team efforts and delegate tasks.",
      },
      {
        id: "leadership/leverages-strengths",
        text: "Recognizes and leverages individual team members' strengths.",
      },
      {
        id: "leadership/keeps-momentum",
        text: "Maintains positive energy and momentum even when facing setbacks.",
      },
      {
        id: "leadership/facilitates-decisions",
        text: "Facilitates decision-making and keeps projects moving forward.",
      },
      {
        id: "leadership/encourages-teammates",
        text: "Provides encouragement and support to teammates.",
      },
      {
        id: "leadership/models-professionalism",
        text: "Models professionalism and work ethic for others.",
      },
      {
        id: "leadership/owns-outcomes",
        text: "Demonstrates ownership and responsibility over one's own outcomes.",
      },
      {
        id: "leadership/supportive-accountability",
        text: "Holds self and others accountable in a supportive manner.",
      },
    ],
    pitfalls: [
      { id: "leadership/pitfall-micromanages", text: "Micromanaging teammates." },
      { id: "leadership/pitfall-wont-delegate", text: "Failing to delegate." },
      {
        id: "leadership/pitfall-negative-attitude",
        text: "Negative attitude that affects team morale.",
      },
      {
        id: "leadership/pitfall-avoids-accountability",
        text: "Avoiding accountability or playing the victim.",
      },
    ],
  },
  {
    id: "ethical-technology-use",
    group: "PROFESSIONALISM",
    name: "Ethical Technology Use",
    blurb:
      "Leveraging digital tools responsibly and efficiently to solve problems and enhance productivity.",
    indicators: [
      {
        id: "ethical-technology-use/ai-for-learning",
        text: "Uses AI and other tools to enhance learning rather than bypass it.",
      },
      {
        id: "ethical-technology-use/validates-ai-output",
        text: "Applies an appropriate level of skepticism over what AI produces and takes the necessary steps to validate it.",
      },
      {
        id: "ethical-technology-use/attributes-sources",
        text: "Properly attributes sources and respects intellectual property.",
      },
      {
        id: "ethical-technology-use/right-tool-right-time",
        text: "Understands when and how to use various tools appropriately.",
      },
      {
        id: "ethical-technology-use/defends-own-work",
        text: "Can explain and defend their own work, regardless of tools used.",
      },
      {
        id: "ethical-technology-use/considers-implications",
        text: "Considers privacy, security, and ethical implications of technology choices.",
      },
      {
        id: "ethical-technology-use/balances-fundamentals",
        text: "Balances tool usage with developing fundamental skills.",
      },
    ],
    pitfalls: [
      {
        id: "ethical-technology-use/pitfall-ai-overreliance",
        text: "Over-reliance on AI without understanding underlying concepts.",
      },
      { id: "ethical-technology-use/pitfall-plagiarism", text: "Plagiarism." },
      {
        id: "ethical-technology-use/pitfall-shortcuts-learning",
        text: "Using tools to shortcut learning.",
      },
      {
        id: "ethical-technology-use/pitfall-tool-dependence",
        text: "Inability to work without specific tools.",
      },
    ],
  },

  // ————— Leadership Seminar —————
  {
    id: "critical-thinking",
    group: "LEADERSHIP_SEMINAR",
    name: "Critical Thinking",
    blurb: "Analyzing information objectively to make reasoned judgments and innovative decisions.",
    indicators: [
      {
        id: "critical-thinking/sound-reasoning",
        text: "Make decisions and solve problems using sound, inclusive reasoning and judgment.",
      },
      {
        id: "critical-thinking/gathers-diverse-input",
        text: "Gather and analyze information from a diverse set of sources and individuals to fully understand a problem.",
      },
      {
        id: "critical-thinking/interprets-data",
        text: "Accurately summarize and interpret data with an awareness of personal biases that may impact outcomes.",
      },
      {
        id: "critical-thinking/communicates-rationale",
        text: "Effectively communicate actions and rationale, recognizing the diverse perspectives and lived experiences of stakeholders.",
      },
    ],
    pitfalls: [
      {
        id: "critical-thinking/pitfall-jumps-to-conclusions",
        text: "Jumping to conclusions without gathering sufficient information.",
      },
      {
        id: "critical-thinking/pitfall-ignores-evidence",
        text: "Ignoring contradictory evidence.",
      },
      {
        id: "critical-thinking/pitfall-unexamined-bias",
        text: "Failing to consider how personal biases affect interpretation.",
      },
      {
        id: "critical-thinking/pitfall-ignores-stakeholders",
        text: "Making decisions without considering impact on different stakeholders.",
      },
    ],
  },
  {
    id: "career-self-development",
    group: "LEADERSHIP_SEMINAR",
    name: "Career & Self-Development",
    blurb:
      "Proactively seeking opportunities for personal growth and long-term professional advancement.",
    indicators: [
      {
        id: "career-self-development/knows-own-strengths",
        text: "Shows an awareness of own strengths and areas for development.",
      },
      {
        id: "career-self-development/pursues-feedback",
        text: "Identify areas for continual growth while pursuing and applying feedback.",
      },
      {
        id: "career-self-development/plans-career",
        text: "Develop plans and goals for one's future career.",
      },
      {
        id: "career-self-development/seeks-opportunities",
        text: "Display curiosity; seek out opportunities to learn.",
      },
      {
        id: "career-self-development/builds-relationships",
        text: "Establish, maintain, and/or leverage relationships with people who can help one professionally.",
      },
    ],
    pitfalls: [
      {
        id: "career-self-development/pitfall-waits-for-opportunity",
        text: "Waiting for opportunities to come rather than seeking them out.",
      },
      {
        id: "career-self-development/pitfall-no-reflection",
        text: "Failing to reflect on strengths and growth areas.",
      },
      {
        id: "career-self-development/pitfall-vague-goals",
        text: "Setting vague career goals without actionable steps.",
      },
      {
        id: "career-self-development/pitfall-no-network",
        text: "Not building or maintaining professional relationships.",
      },
      {
        id: "career-self-development/pitfall-ignores-feedback",
        text: "Ignoring feedback about development areas.",
      },
    ],
  },
  {
    id: "equity-inclusion",
    group: "LEADERSHIP_SEMINAR",
    name: "Equity & Inclusion Lens",
    blurb:
      "Integrating diverse perspectives and fostering an environment where all identities are respected and valued.",
    indicators: [
      {
        id: "equity-inclusion/inclusive-decisions",
        text: "Solicit and use feedback from multiple cultural perspectives to make inclusive and equity-minded decisions.",
      },
      {
        id: "equity-inclusion/contributes-to-change",
        text: "Actively contribute to inclusive and equitable practices that influence individual and systemic change.",
      },
      {
        id: "equity-inclusion/advocates",
        text: "Advocate for inclusion, equitable practices, justice, and empowerment for historically marginalized communities.",
      },
      {
        id: "equity-inclusion/open-minded",
        text: "Keep an open mind to diverse ideas and new ways of thinking.",
      },
    ],
    pitfalls: [
      {
        id: "equity-inclusion/pitfall-single-perspective",
        text: "Assuming one perspective represents all.",
      },
      {
        id: "equity-inclusion/pitfall-unquestioned-practices",
        text: "Perpetuating exclusive practices without questioning them.",
      },
      {
        id: "equity-inclusion/pitfall-dismisses-equity",
        text: "Dismissing concerns about equity as “politics”.",
      },
      {
        id: "equity-inclusion/pitfall-ignores-impact",
        text: "Making decisions without considering differential impact on marginalized groups.",
      },
      {
        id: "equity-inclusion/pitfall-silent-bystander",
        text: "Remaining silent when witnessing exclusionary behavior.",
      },
    ],
  },
  {
    id: "storytelling",
    group: "LEADERSHIP_SEMINAR",
    name: "Storytelling",
    blurb:
      "Crafting clear, compelling narratives in writing and speech to effectively communicate complex ideas.",
    indicators: [
      {
        id: "storytelling/organized-writing",
        text: "Develop clear, well-organized written narratives that engage readers and convey key messages effectively.",
      },
      {
        id: "storytelling/adapts-to-audience",
        text: "Adapt communication style and content to suit different audiences and contexts.",
      },
      {
        id: "storytelling/concrete-examples",
        text: "Use concrete examples and vivid details to illustrate abstract concepts and make ideas memorable.",
      },
      {
        id: "storytelling/structured-delivery",
        text: "Structure presentations and conversations with a clear beginning, middle, and end that guides the audience through complex information.",
      },
    ],
    pitfalls: [
      {
        id: "storytelling/pitfall-jargon",
        text: "Losing the audience with excessive technical jargon or abstract concepts.",
      },
      {
        id: "storytelling/pitfall-poor-organization",
        text: "Poor organization that confuses rather than clarifies.",
      },
      {
        id: "storytelling/pitfall-one-register",
        text: "Failing to adapt tone or detail level for different audiences.",
      },
      {
        id: "storytelling/pitfall-irrelevant-detail",
        text: "Including irrelevant details that distract from the main message.",
      },
      {
        id: "storytelling/pitfall-no-comprehension-check",
        text: "Rushing through explanations without checking for understanding.",
      },
    ],
  },
  {
    id: "curiosity",
    group: "LEADERSHIP_SEMINAR",
    name: "Curiosity",
    blurb:
      "Maintaining an active desire to learn, explore new concepts, and challenge the status quo.",
    indicators: [
      {
        id: "curiosity/asks-deep-questions",
        text: "Ask thoughtful questions that go beyond surface-level understanding to explore underlying principles and connections.",
      },
      {
        id: "curiosity/seeks-beyond-assigned",
        text: "Actively seek out learning resources and opportunities beyond assigned materials to deepen knowledge.",
      },
      {
        id: "curiosity/experiments",
        text: "Experiment with new approaches and technologies, even when not directly required for assignments.",
      },
      {
        id: "curiosity/challenges-assumptions",
        text: "Challenge assumptions and explore alternative solutions rather than accepting the first answer that works.",
      },
    ],
    pitfalls: [
      {
        id: "curiosity/pitfall-face-value",
        text: "Accepting information at face value without deeper inquiry.",
      },
      { id: "curiosity/pitfall-assigned-only", text: "Only engaging with assigned materials." },
      {
        id: "curiosity/pitfall-rigid-habits",
        text: "Sticking rigidly to familiar approaches even when they're not optimal.",
      },
      {
        id: "curiosity/pitfall-works-is-enough",
        text: "Viewing “getting it working” as the end goal rather than understanding why it works.",
      },
      {
        id: "curiosity/pitfall-fears-mistakes",
        text: "Treating mistakes as failures rather than learning opportunities.",
      },
    ],
  },

  // ————— SWE Technical —————
  {
    id: "technical-communication",
    group: "SWE_TECHNICAL",
    name: "Technical Communication",
    blurb:
      "Clearly articulating the “what, how, and why” of technical decisions and product development to diverse audiences, from stakeholders to teammates.",
    indicators: [
      {
        id: "technical-communication/what-how-why",
        text: "Shares not just what they did, but how they did it and why it matters.",
      },
      {
        id: "technical-communication/decisions-and-impact",
        text: "Articulates technical decisions and their impact on the project timeline, performance, or user experience.",
      },
      {
        id: "technical-communication/uses-analogies",
        text: "Uses effective analogies, diagrams, and code snippets to enhance explanations.",
      },
      {
        id: "technical-communication/audience-aware",
        text: "Adapts communication style based on audience (technical vs. non-technical stakeholders).",
      },
      {
        id: "technical-communication/written-and-spoken",
        text: "Can effectively communicate in both writing and in oral presentations.",
      },
    ],
    pitfalls: [
      {
        id: "technical-communication/pitfall-unclear-explanations",
        text: "Struggling to explain code clearly.",
      },
      {
        id: "technical-communication/pitfall-no-audience-awareness",
        text: "Lack of audience awareness.",
      },
      {
        id: "technical-communication/pitfall-cannot-articulate-tradeoffs",
        text: "Difficulty articulating technical decisions and tradeoffs.",
      },
    ],
  },
  {
    id: "mental-models",
    group: "SWE_TECHNICAL",
    name: "Mental Models",
    blurb:
      "Creating simplified abstractions of complex systems to focus on essential concepts, enabling faster learning and better problem-solving.",
    indicators: [
      {
        id: "mental-models/explains-by-analogy",
        text: "Can illustrate a concept using an analogy or a diagram.",
      },
      {
        id: "mental-models/simplified-language",
        text: "Can explain a concept clearly with simplified language.",
      },
      {
        id: "mental-models/corrects-misconceptions",
        text: "Corrects misconceptions when new evidence emerges.",
      },
      { id: "mental-models/pseudocode", text: "Can communicate algorithms using pseudocode." },
      {
        id: "mental-models/essential-details",
        text: "Can identify essential vs. extraneous details when analyzing a problem.",
      },
      {
        id: "mental-models/transfers-solutions",
        text: "Accurately applies known solutions, data structures, and algorithms to new but similar problems.",
      },
      {
        id: "mental-models/weighs-tradeoffs",
        text: "Makes informed technical decisions based on understanding of high-level tradeoffs.",
      },
    ],
    pitfalls: [
      {
        id: "mental-models/pitfall-memorizes-syntax",
        text: "Memorizing syntax without understanding why.",
      },
      { id: "mental-models/pitfall-holds-misconceptions", text: "Holding misconceptions." },
      {
        id: "mental-models/pitfall-cannot-transfer",
        text: "Difficulty transferring knowledge to new situations.",
      },
    ],
  },
  {
    id: "systems-thinking",
    group: "SWE_TECHNICAL",
    name: "Systems Thinking",
    blurb:
      "Analyzing how individual components and dependencies interact within a larger framework to design reliable, scalable, and maintainable software.",
    indicators: [
      {
        id: "systems-thinking/sees-big-picture",
        text: "Sees the big picture and how pieces connect (front-end, back-end, DB, APIs).",
      },
      {
        id: "systems-thinking/anticipates-ripples",
        text: "Anticipates ripple effects of a change.",
      },
      {
        id: "systems-thinking/designs-for-change",
        text: "Designs for extensibility, debug-ability, and reliability, not just “getting it to work.”",
      },
      {
        id: "systems-thinking/decomposes-problems",
        text: "Breaks large problems into smaller ones.",
      },
      {
        id: "systems-thinking/maps-dependencies",
        text: "Identifies dependencies between subtasks.",
      },
    ],
    pitfalls: [
      {
        id: "systems-thinking/pitfall-tunnel-vision",
        text: "Tunnel vision on one layer of the stack.",
      },
      {
        id: "systems-thinking/pitfall-misses-ripples",
        text: "Failing to anticipate ripple effects.",
      },
      {
        id: "systems-thinking/pitfall-cannot-zoom-out",
        text: "Struggling to “zoom out.”",
      },
    ],
  },
  {
    id: "methodical-debugging",
    group: "SWE_TECHNICAL",
    name: "Methodical Debugging",
    blurb:
      "Applying a structured, methodical approach to identify root causes and implement comprehensive fixes rather than relying on guesswork.",
    indicators: [
      {
        id: "methodical-debugging/structured-approach",
        text: "Debugs with a structured approach instead of randomly trying fixes.",
      },
      {
        id: "methodical-debugging/reads-errors",
        text: "Reads error messages and test output carefully and investigates root causes.",
      },
      {
        id: "methodical-debugging/multiple-strategies",
        text: "Tries multiple strategies when initial approach fails.",
      },
      {
        id: "methodical-debugging/root-causes",
        text: "Seeks to understand root causes rather than applying surface-level fixes.",
      },
      {
        id: "methodical-debugging/traces-execution",
        text: "Can trace through code execution to understand program behavior.",
      },
      {
        id: "methodical-debugging/tests-comprehensively",
        text: "Tests solutions comprehensively, ensuring edge cases are covered.",
      },
    ],
    pitfalls: [
      {
        id: "methodical-debugging/pitfall-guesses",
        text: "Frequently “guessing” at what the problem is without systematically finding the root.",
      },
      {
        id: "methodical-debugging/pitfall-no-plan",
        text: "Jumping into code without planning an approach first.",
      },
      { id: "methodical-debugging/pitfall-ignores-errors", text: "Ignoring error messages." },
      {
        id: "methodical-debugging/pitfall-late-help",
        text: "Not asking for help in a timely manner.",
      },
      {
        id: "methodical-debugging/pitfall-gives-up",
        text: "Giving up too quickly when the initial approach doesn't work.",
      },
    ],
  },
  {
    id: "detail-orientation",
    group: "SWE_TECHNICAL",
    name: "Detail Orientation",
    blurb:
      "Taking professional pride in producing clean, well-documented code and error-free materials that adhere to industry best practices and team standards.",
    indicators: [
      {
        id: "detail-orientation/reads-thoroughly",
        text: "Reads documentation and instructions thoroughly.",
      },
      {
        id: "detail-orientation/clean-code",
        text: "Writes clean, readable code that follows established style guides and coding conventions.",
      },
      {
        id: "detail-orientation/error-free-materials",
        text: "Creates well-structured, error-free documentation, READMEs, and presentations.",
      },
      {
        id: "detail-orientation/double-checks",
        text: "Double-checks work before submitting for review or presentation.",
      },
      {
        id: "detail-orientation/implements-feedback",
        text: "Proactively seeks feedback and implements learnings in subsequent work.",
      },
      { id: "detail-orientation/git-practices", text: "Follows git best practices." },
    ],
    pitfalls: [
      {
        id: "detail-orientation/pitfall-lint-flags",
        text: "Submitting code that raises numerous linting flags and doesn't adhere to known style guides.",
      },
      {
        id: "detail-orientation/pitfall-error-filled-materials",
        text: "Creating documentation, technical writing, and technical presentations that are error-filled or contain typos or technical inaccuracies.",
      },
      {
        id: "detail-orientation/pitfall-repeats-mistakes",
        text: "Repeating the same mistakes without incorporating feedback.",
      },
    ],
  },
] satisfies readonly Competency[];

/** One selectable line with everything a picker row or a stored goal copies from it. */
export type PickableEntry = {
  entryId: string;
  kind: CompetencyEntryKind;
  text: string;
  competencyId: string;
  competencyName: string;
  group: CompetencyGroup;
};

/**
 * Every indicator and pitfall as one flat list, in the order the picker presents them: groups in
 * declared order, competencies in list order, indicators before pitfalls.
 */
export function competencyEntries(): PickableEntry[] {
  return COMPETENCIES.flatMap((competency) => {
    const shared = {
      competencyId: competency.id,
      competencyName: competency.name,
      group: competency.group,
    };

    return [
      ...competency.indicators.map((entry) => ({
        entryId: entry.id,
        kind: "INDICATOR" as const,
        text: entry.text,
        ...shared,
      })),
      ...competency.pitfalls.map((entry) => ({
        entryId: entry.id,
        kind: "PITFALL" as const,
        text: entry.text,
        ...shared,
      })),
    ];
  });
}

/** Built once; the picker filters it and the server resolves a chosen id against it. */
const ENTRY_BY_ID = new Map(competencyEntries().map((entry) => [entry.entryId, entry]));

/** The entry an id names, or null — a stored goal may hold an id this file no longer lists. */
export function entryById(id: string): PickableEntry | null {
  return ENTRY_BY_ID.get(id) ?? null;
}

/**
 * The competencies a search query leaves standing, pruned to their matching entries.
 *
 * Case-insensitive substring over entry text, competency name, and group label. A query that
 * matches a competency's name or its group's label keeps everything under that competency —
 * somebody typing "growth mindset" wants the competency, not the subset of its lines that repeat
 * the words — and a competency left with no entries at all disappears rather than standing as an
 * empty heading. A blank query is the whole list, which is what the picker opens on.
 */
export function filterCompetencies(query: string): readonly Competency[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return COMPETENCIES;

  const matches = (text: string) => text.toLowerCase().includes(needle);

  return COMPETENCIES.flatMap((competency) => {
    if (matches(competency.name) || matches(GROUP_META[competency.group].label)) {
      return [competency];
    }

    const indicators = competency.indicators.filter((entry) => matches(entry.text));
    const pitfalls = competency.pitfalls.filter((entry) => matches(entry.text));
    if (indicators.length === 0 && pitfalls.length === 0) return [];

    return [{ ...competency, indicators, pitfalls }];
  });
}
