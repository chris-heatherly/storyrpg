/**
 * Character Designer Agent
 *
 * The NPC and protagonist specialist responsible for:
 * - Creating compelling character profiles with distinct voices
 * - Designing character arcs that intersect the player journey
 * - Generating dialogue patterns and verbal tics
 * - Maintaining character relationship dynamics
 */

import { AgentConfig } from '../config';
import { describeTierRequirements } from '../config/tierRequirements';
import { BaseAgent, AgentResponse, TruncatedLLMResponseError } from './BaseAgent';
import type {
  CharacterFashionStyle,
  StoryAnchors,
  LegacyStructuralMap,
  CharacterArchitecture,
} from '../../types/sourceAnalysis';
import type { InformationLedgerEntry } from '../../types/seasonPlan';
import type { CharacterTreatmentRealizationContract } from '../../types/scenePlan';
import { resolveAuthoredContext } from '../utils/documentSectionSlice';
import { buildCharacterBibleJsonSchema } from '../schemas/characterBibleSchema';

// Input types
export interface CharacterDesignerInput {
  // Story context
  storyContext: {
    title: string;
    genre: string;
    tone: string;
    themes: string[];
    userPrompt?: string;
  };

  // Characters to develop
  charactersToCreate: Array<{
    id: string;
    name: string;
    role: 'protagonist' | 'antagonist' | 'ally' | 'mentor' | 'love_interest' | 'rival' | 'neutral' | 'wildcard';
    briefDescription: string;
    importance: 'major' | 'supporting' | 'minor';
    fashionStyle?: CharacterFashionStyle;
  }>;

  // Relationship context
  protagonistId?: string;
  existingCharacters?: CharacterProfile[];

  // World context for grounding
  worldContext: string;
  culturalNotes?: string[];

  // Raw document content for additional context
  rawDocument?: string;

  // Pipeline memory context (optimization hints from prior runs, Claude only)
  memoryContext?: string;

  /**
   * Season-level narrative anchors. The protagonist's internal + external
   * arc should be grounded in these anchors so character design serves
   * the story spine.
   */
  seasonAnchors?: StoryAnchors;

  /** Season-level legacy-structure beat map (for long-arc character planning). */
  seasonLegacyStructure?: LegacyStructuralMap;

  /**
   * Authored character architecture (treatment Section 3): the protagonist's
   * Lie/Need/Truth/Want plus supporting micro-arcs. Forwarded so the bible can
   * carry the authored 5-axis identity model instead of re-deriving a lossy
   * Want/Fear/Flaw from prose.
   */
  characterArchitecture?: CharacterArchitecture;
  characterTreatmentContracts?: CharacterTreatmentRealizationContract[];

  /**
   * Authored information ledger (treatment Section 6). Forwarded as context so
   * character design respects what each character knows / withholds and when
   * reveals are scheduled.
   */
  informationLedger?: InformationLedgerEntry[];
}

// Output types
export type PronounSet = 'he/him' | 'she/her' | 'they/them';

export interface CharacterProfile {
  id: string;
  name: string;
  pronouns: PronounSet; // Character's pronouns for correct narrative usage
  role: string;
  importance: string;

  /**
   * First-class NPC tier (Phase 1.3). Authored directly by CharacterDesigner
   * based on narrative weight (core / supporting / background) rather than
   * inferred from `role`. Optional for backward compatibility — older
   * character bibles may omit it and fall back to role-based inference.
   */
  tier?: 'core' | 'supporting' | 'background';

  /**
   * Secrets the character carries. Either a primary `hiddenSecret` (kept for
   * back-compat) or a list of secrets surfaced across the story. Persisted
   * into Story.npcs[].secrets so downstream tooling can see them without
   * reading the CharacterBible.
   */
  secrets?: string[];

  // Core identity
  overview: string; // 2-3 sentence summary
  fullBackground: string; // Detailed backstory

  // The Want/Fear/Flaw trinity
  want: string; // What they're actively pursuing
  fear: string; // What they're running from
  flaw: string; // What holds them back

  /**
   * Authored 5-axis identity model (treatment Section 3). Carried from
   * `seasonPlan.characterArchitecture` so the bible preserves the authored
   * Lie/Need/Truth/Wound rather than collapsing to Want/Fear/Flaw. All
   * optional for back-compat with bibles produced before this field existed
   * and for stories with no authored character architecture.
   *
   * Agent-facing only — never surfaced to the player as a label; scenes
   * express these through behavior and choices (fiction-first).
   */
  need?: string; // Dramatic necessity underneath the conscious want
  truth?: string; // What they must recognize (or refuse, in a tragic arc)
  wound?: string; // Formative pressure that made the protective Lie useful
  microLies?: string[]; // Smaller protective beliefs the character carries

  // Personality
  traits: string[]; // 3-5 defining traits
  values: string[]; // What they believe in
  quirks: string[]; // Memorable behaviors

  // Appearance
  physicalDescription: string;
  distinctiveFeatures: string[];
  typicalAttire: string;
  fashionStyle?: CharacterFashionStyle;

  // Voice
  voiceProfile: VoiceProfile;

  // Relationships
  relationships: CharacterRelationship[];

  // Arc potential
  arcPotential: {
    currentState: string;
    possibleGrowth: string;
    possibleFall: string;
    triggerEvents: string[];
  };

  // Gameplay integration
  initialStats?: {
    trust: number;
    affection: number;
    respect: number;
    fear: number;
  };

  // Character skills (for skill checks and encounter advantages)
  skills?: Array<{
    name: string;
    level: number; // 1-100
    description?: string;
  }>;

  // Secret (for narrative reveals)
  hiddenSecret?: string;

  // Brief description for quick reference
  description?: string;

  // Pixar-style character depth (Rule #13: strong opinions)
  pixarDepth?: {
    coreOpinion: string;        // What they believe strongly about
    personalStakes: string;     // Why it matters to them personally
    strongOpinionOn: string;    // Topic they have strong views on
    polarOpposite: string;      // What would be their worst nightmare/opposite
  };
}

export interface VoiceProfile {
  // Speech patterns
  vocabulary: 'simple' | 'educated' | 'technical' | 'poetic' | 'street';
  sentenceLength: 'terse' | 'average' | 'verbose';
  formality: 'casual' | 'neutral' | 'formal';

  // Distinctive elements
  verbalTics: string[]; // "You know what I mean?", "Listen...", etc.
  favoriteExpressions: string[];
  avoidedWords: string[]; // Words they'd never use

  // Emotional tells
  whenHappy: string;
  whenAngry: string;
  whenNervous: string;
  whenLying: string;

  // Sample lines
  greetingExamples: string[];
  farewellExamples: string[];
  underStressExamples: string[];

  // Signature lines (catchphrases or memorable quotes)
  signatureLines?: string[];

  // Dialogue notes for writers
  writingGuidance: string;
}

export interface CharacterRelationship {
  targetId: string;
  targetName: string;
  relationshipType: string; // 'friend' | 'enemy' | 'family' | 'romantic' | 'professional' | 'complicated'

  // Current state
  currentDynamic: string;
  history: string;

  // Tension
  unresolvedIssues: string[];
  potentialConflicts: string[];

  // Evolution potential
  couldBecome: string[];
}

export interface CharacterBible {
  characters: CharacterProfile[];

  // Protagonist reference (for quick access)
  protagonist?: CharacterProfile;

  // Relationship web
  relationshipSummary: string;
  keyDynamics: Array<{
    characters: string[];
    dynamic: string;
    narrativePotential: string;
  }>;

  // Casting notes
  ensembleBalance: string; // Analysis of how characters complement each other
  gaps: string[]; // Character types that might be missing

  // Consistency notes
  voiceDistinctions: string; // How to keep characters from sounding alike
  doNotForget: string[]; // Critical character facts
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

export function normalizeFashionStyle(
  fashionStyle: Partial<CharacterFashionStyle> | undefined,
): CharacterFashionStyle | undefined {
  if (!fashionStyle) return undefined;

  const styleSummary = String(fashionStyle.styleSummary || '').trim();
  const styleTags = asStringArray(fashionStyle.styleTags);
  const signatureGarments = asStringArray(fashionStyle.signatureGarments);
  const materials = asStringArray(fashionStyle.materials);
  const colorPalette = asStringArray(fashionStyle.colorPalette);
  const accessories = asStringArray(fashionStyle.accessories);
  const sourceEvidence = asStringArray(fashionStyle.sourceEvidence);

  if (
    !styleSummary &&
    styleTags.length === 0 &&
    signatureGarments.length === 0 &&
    materials.length === 0 &&
    colorPalette.length === 0 &&
    accessories.length === 0
  ) {
    return undefined;
  }

  return {
    styleSummary,
    styleTags,
    signatureGarments,
    materials,
    colorPalette,
    accessories,
    ...(sourceEvidence.length > 0 ? { sourceEvidence } : {}),
  };
}

function formatFashionStyleForPrompt(fashionStyle: CharacterFashionStyle | undefined): string {
  if (!fashionStyle) return '';

  const parts = [
    fashionStyle.styleSummary,
    fashionStyle.styleTags.length ? `tags: ${fashionStyle.styleTags.join(', ')}` : '',
    fashionStyle.signatureGarments.length ? `garments: ${fashionStyle.signatureGarments.join(', ')}` : '',
    fashionStyle.materials.length ? `materials: ${fashionStyle.materials.join(', ')}` : '',
    fashionStyle.colorPalette.length ? `palette: ${fashionStyle.colorPalette.join(', ')}` : '',
    fashionStyle.accessories.length ? `accessories: ${fashionStyle.accessories.join(', ')}` : '',
  ].filter(Boolean);

  return parts.join('; ');
}

export class CharacterDesigner extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Character Designer', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Character Designer

You create memorable, consistent, and narratively compelling characters. Every character should feel like a real person with their own inner life, not just a plot device.

## Character Design Principles

### The Want/Fear/Flaw Trinity
Every significant character MUST have:
- **WANT**: An active goal they're pursuing (external motivation)
- **FEAR**: Something they're running from or avoiding (internal motivation)
- **FLAW**: A character weakness that creates conflict (the obstacle)

The best characters have wants, fears, and flaws that conflict with each other.

### Authored 5-Axis Model (when provided)
If an "Authored Character Architecture" section appears above, it is AUTHORITATIVE
for the matching character. Carry the authored axes onto the structured fields:
- authored **Need** → \`need\`
- authored **Truth** → \`truth\`
- authored **Wound** / origin pressure → \`wound\`
- authored **Lie** and supporting **micro-lies** → \`microLies\` (an array)
Keep Want/Fear/Flaw consistent with these. These are agent-facing drivers — never
expose them to the player as labels; express them through behavior and choices.

### Voice Distinction
- Every character must sound DIFFERENT
- Use vocabulary, rhythm, and verbal tics to distinguish
- A reader should identify the speaker without dialogue tags
- Speech patterns reveal background, education, and personality

### Relationship Dynamics
- Characters exist in webs of relationship, not isolation
- Every relationship should have both connection AND tension
- Relationships should be able to change based on player actions
- The most interesting NPCs want something FROM the player

### NPC Tier (REQUIRED)
Every character MUST have a \`tier\` field that classifies them by narrative weight:
- **core**: Protagonist, primary antagonist, or recurring main cast who carries a full arc. At least one relationship dimension, full voiceProfile, want/fear/flaw, and a secret. Usually 2–4 per story.
- **supporting**: Named secondary NPCs who appear in multiple scenes, have at least one relationship dimension, and distinct voiceProfile. Usually 3–6 per story.
- **background**: One-scene or ambient NPCs who add flavor but carry no arc. Voice and personality may be minimal.

Tier is structural, not a rating. An "ally" whose only scene is a brief introduction is \`background\`, not \`core\`.

**Relationship-dimension requirements by tier (enforced by NPCDepthValidator):**
${describeTierRequirements()}

### Show, Don't Tell
- Reveal character through action and dialogue, not description
- Backstory should be implied, not explained
- Let players discover depths over time

## Voice Profile Guidelines

### Vocabulary Levels
- **Simple**: Common words, concrete thinking, direct statements
- **Educated**: Varied vocabulary, abstract concepts, complex sentences
- **Technical**: Jargon-heavy, precise, assumes shared knowledge
- **Poetic**: Metaphorical, rhythmic, emotionally evocative
- **Street**: Slang, contractions, local color

### Verbal Tics
- Filler words: "like", "you know", "basically"
- Sentence starters: "Look,", "Listen,", "Here's the thing..."
- Emphasis patterns: Repetition, intensifiers, understatement
- Unique phrases they return to

### Emotional Tells
Define how speech CHANGES under different emotions:
- Happy: Faster? More animated? More generous?
- Angry: Clipped? Louder? Colder?
- Nervous: Rambling? Quiet? Deflecting?
- Lying: Overly detailed? Vague? Defensive?

## Sample Dialogue Requirements

For each character, provide examples that demonstrate:
1. How they greet someone they like vs. dislike
2. How they say goodbye casually vs. formally
3. How they sound under stress or pressure
4. At least 3 lines that only THIS character would say

## Quality Standards

Before finalizing:
- Would I recognize this character's voice immediately?
- Do they have internal contradictions that create depth?
- Are their relationships complex, not one-dimensional?
- Could they carry a scene on their own?
- Do they serve the story's themes?
`;
  }

  async execute(input: CharacterDesignerInput): Promise<AgentResponse<CharacterBible>> {
    const prompt = this.buildPrompt(input);

    // Debug: Log input characters
    console.log(`[CharacterDesigner] Input characters to create:`,
      input.charactersToCreate.map(c => `${c.id}: "${c.name}" (${c.role})`).join(', ')
    );

    try {
      let response: string;
      try {
        response = await this.callLLM(
          [{ role: 'user', content: prompt }],
          0,
          { jsonSchema: buildCharacterBibleJsonSchema(input.charactersToCreate.length) },
        );
      } catch (error) {
        if (error instanceof TruncatedLLMResponseError) {
          console.warn(`[CharacterDesigner] first response hit ${error.finishReason || 'token limit'} — retrying with compact character-bible contract.`);
          response = await this.callLLM(
            [{ role: 'user', content: this.buildCompactRetryPrompt(prompt, 'The previous character-bible response hit the provider output token limit before a complete JSON object was returned.') }],
            1,
            { jsonSchema: buildCharacterBibleJsonSchema(input.charactersToCreate.length) },
          );
        } else if (this.isGeminiSafetyEmptyError(error)) {
          console.warn(`[CharacterDesigner] first response hit Gemini safety-empty content — retrying with a compact source-thinned character-bible contract.`);
          response = await this.callLLM(
            [{ role: 'user', content: this.buildSafetyRetryPrompt(input) }],
            1,
            { jsonSchema: buildCharacterBibleJsonSchema(input.charactersToCreate.length) },
          );
        } else {
          throw error;
        }
      }

      console.log(`[CharacterDesigner] Received response (${response.length} chars)`);

      // Parse, with ONE focused compact retry: a full character bible is heavy output
      // that weaker models occasionally emit as malformed JSON (an unescaped quote
      // mid-string → "Expected ',' or '}'" at position N) or truncate. Re-running with a
      // strict-escaping/compact directive is far more likely to parse than failing the
      // whole phase on a single bad response.
      let characterBible: CharacterBible = await this.parseCharacterBibleWithCompactRetry(input, prompt, response);

      // Debug: Log output characters
      console.log(`[CharacterDesigner] Output characters from LLM:`,
        characterBible.characters?.map(c => `${c.id}: "${c.name}"`).join(', ') || 'none'
      );

      // Normalize arrays that the LLM might return as strings or undefined
      characterBible = this.normalizeCharacterBible(characterBible);

      // Reconcile LLM-returned IDs with the canonical requested IDs. LLMs often
      // rewrite hyphens to underscores (e.g. "char-mr-green" -> "char-mr_green")
      // or drop casing. We fuzzy-match each returned character back to the
      // requested id so downstream references stay valid.
      this.alignCharacterIds(characterBible, input);
      // When the LLM authored fewer characters than requested (a large cast that
      // truncated, or a couple simply omitted), re-request ONLY the missing ones in
      // a focused, much smaller call and merge them in — rather than failing the
      // whole bible. No-op when every requested character is present.
      await this.fillMissingCharacters(characterBible, input);
      this.preserveInputFashionStyle(characterBible, input);
      this.backfillLowWeightVoiceSamples(characterBible, input);

      this.validateCharacterBible(characterBible, input);
      characterBible.gaps = [];

      // Run quality checks and attempt revision if needed
      const qualityIssues = this.collectQualityIssues(characterBible, input);
      if (qualityIssues.length > 0) {
        console.log(`[CharacterDesigner] Found ${qualityIssues.length} quality issues, attempting revision...`);
        const revisedBible = await this.executeRevision(input, characterBible, qualityIssues);

        // Re-check quality after revision
        const revisedIssues = this.collectQualityIssues(revisedBible, input);
        if (revisedIssues.length < qualityIssues.length) {
          console.log(`[CharacterDesigner] Revision improved quality: ${qualityIssues.length} -> ${revisedIssues.length} issues`);
          // Re-validate structural requirements
          this.validateCharacterBible(revisedBible, input);
          return {
            success: true,
            data: revisedBible,
            rawResponse: response,
          };
        } else {
          console.log(`[CharacterDesigner] Revision did not improve quality, using original`);
        }
      }

      return {
        success: true,
        data: characterBible,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[CharacterDesigner] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Parse the character-bible JSON, with ONE focused compact retry. A full bible is
   * heavy output that weaker models occasionally emit as MALFORMED JSON (an unescaped
   * quote inside a string → "Expected ',' or '}'" mid-document) or truncate. Re-running
   * the same oversized prompt (the phase retry) tends to fail the same way; a retry that
   * asks for the SAME content COMPACTLY and strictly-escaped is far more likely to parse.
   * Only fires on a failure/truncation, so a clean first response — including every
   * golden/_transportOverride run — keeps the single-call path. A still-failing retry
   * rethrows so execute() fails and the phase falls back exactly as before.
   */
  private async parseCharacterBibleWithCompactRetry(
    input: CharacterDesignerInput,
    basePrompt: string,
    firstResponse: string,
  ): Promise<CharacterBible> {
    try {
      const bible = this.parseJSON<CharacterBible>(firstResponse);
      if (!this.wasLastResponseTruncated()) return bible;
      console.warn(`[CharacterDesigner] response parsed but truncation dropped content — retrying with a compact-output directive.`);
    } catch (parseError) {
      const msg = parseError instanceof Error ? parseError.message : String(parseError);
      console.warn(`[CharacterDesigner] JSON parse failed (${msg.slice(0, 120)}) — retrying with a compact, strictly-valid JSON directive.`);
    }
    const compactPrompt = this.buildCompactRetryPrompt(
      basePrompt,
      'Your previous response was not valid JSON because it was malformed or over-long.',
    );
    const response = await this.callLLM(
      [{ role: 'user', content: compactPrompt }],
      4,
      { jsonSchema: buildCharacterBibleJsonSchema(input.charactersToCreate.length) },
    );
    return this.parseJSON<CharacterBible>(response); // rethrows on failure → execute() fails → phase falls back
  }

  /**
   * Backfill characters the first pass did not return. A full bible for a large
   * cast is heavy output that weaker models truncate (dropping the trailing
   * profiles) or simply leave a couple of characters out of — which then throws
   * "Missing requested character" and fails the whole bible. This re-requests ONLY
   * the missing characters in a focused, much smaller call (so it fits and parses)
   * and merges the returned profiles in. One attempt; a failure leaves the bible
   * as-is so validateCharacterBible still surfaces the gap. No-op (no LLM call)
   * when every requested character is already present — so a clean first pass,
   * including every golden/_transportOverride run, is unaffected. Mutates
   * `characterBible.characters` in place.
   */
  private async fillMissingCharacters(
    characterBible: CharacterBible,
    input: CharacterDesignerInput,
  ): Promise<void> {
    if (!Array.isArray(characterBible.characters)) characterBible.characters = [];
    const present = new Set(characterBible.characters.map((c) => c.id));
    const missing = input.charactersToCreate.filter((c) => !present.has(c.id));
    if (missing.length === 0) return;

    console.warn(
      `[CharacterDesigner] ${missing.length}/${input.charactersToCreate.length} requested character(s) missing after the first pass ` +
        `(${missing.map((c) => c.id).join(', ')}) — re-requesting just those in a focused call.`,
    );
    const subInput: CharacterDesignerInput = { ...input, charactersToCreate: missing };
    try {
      const response = await this.callLLM(
        [{ role: 'user', content: this.buildPrompt(subInput) }],
        4,
        { jsonSchema: buildCharacterBibleJsonSchema(subInput.charactersToCreate.length) },
      );
      let patch = this.parseJSON<CharacterBible>(response);
      patch = this.normalizeCharacterBible(patch);
      this.alignCharacterIds(patch, subInput);
      const wanted = new Set(missing.map((c) => c.id));
      let filled = 0;
      for (const ch of patch.characters ?? []) {
        if (wanted.has(ch.id) && !present.has(ch.id)) {
          characterBible.characters.push(ch);
          present.add(ch.id);
          filled += 1;
        }
      }
      console.log(`[CharacterDesigner] Backfilled ${filled}/${missing.length} missing character(s).`);
    } catch (err) {
      console.warn(
        `[CharacterDesigner] Missing-character re-request failed (${err instanceof Error ? err.message : String(err)}); ` +
          `leaving the bible incomplete for validation to surface.`,
      );
    }
  }

  /**
   * Legacy no-op. `bible.gaps` is model-authored advisory text, not deterministic
   * source material. It must not synthesize generic "Mentor" / "Antagonist"
   * characters in treatment-bound runs; only `charactersToCreate` may add roster
   * entries.
   */
  private async backfillGapArchetypes(
    characterBible: CharacterBible,
    input: CharacterDesignerInput,
  ): Promise<void> {
    void input;
    if (Array.isArray(characterBible.gaps) && characterBible.gaps.length > 0) {
      console.warn(`[CharacterDesigner] Ignoring ${characterBible.gaps.length} model-authored character gap suggestion(s); requested cast is authoritative.`);
    }
    characterBible.gaps = [];
  }

  private buildPrompt(input: CharacterDesignerInput): string {
    const characterList = input.charactersToCreate
      .map(c => {
        const fashion = formatFashionStyleForPrompt(c.fashionStyle);
        return `- ID: "${c.id}", Name: "${c.name}", Role: ${c.role}, Importance: ${c.importance}\n  Description: ${c.briefDescription}${fashion ? `\n  Fashion Style: ${fashion}` : ''}`;
      })
      .join('\n');

    const characterIds = input.charactersToCreate.map(c => `"${c.id}"`).join(', ');

    const existingList = input.existingCharacters
      ? input.existingCharacters.map(c => `- ${c.name}: ${c.overview}`).join('\n')
      : 'None yet';

    // Section-aware source slice (Section 3 character architecture + Section 6
    // information ledger), not a lossy first-3000-chars cut. Falls back to the
    // full doc when no headings match.
    const authoredContext = resolveAuthoredContext(input.rawDocument, [
      ['character architecture', 'protagonist brief'],
      ['information ledger'],
    ]);

    const arch = input.characterArchitecture;
    const architectureBlock = arch
      ? `
## Authored Character Architecture (Section 3 — AUTHORITATIVE, agent-facing only)
These are the authored 5-axis identity drivers. Carry them onto the matching
characters' "need", "truth", "wound", and "microLies" fields. Never expose these
as labels to the player; express them through behavior and choices.

### Protagonist
- **Lie (false/protective belief)**: ${arch.protagonist.lie}
- **Wound (origin pressure)**: ${arch.protagonist.originPressure}
- **Truth (must recognize or refuse)**: ${arch.protagonist.truth}
- **Want (conscious goal)**: ${arch.protagonist.want}
- **Need (dramatic necessity)**: ${arch.protagonist.need}
${
  arch.supportingCharacters?.length
    ? `\n### Supporting micro-arcs\n${arch.supportingCharacters
        .map(
          (s) =>
            `- ${s.characterName} (${s.characterId}): micro-lie "${s.microLie}"; counter-pressure "${s.truthOrCounterPressure}"`
        )
        .join('\n')}`
    : ''
}
`
      : '';

    const characterTreatmentBlock = input.characterTreatmentContracts?.length
      ? `
## Authored Protagonist Treatment Contracts
Preserve these authored protagonist facts in the character bible. Use them to fill role, want, need, wound, truth, flaw, typicalAttire, secrets, and arc fields where appropriate. Do not invent contradictions.
${input.characterTreatmentContracts.map((c) => `- ${c.fieldName} (${c.contractKind}): ${c.sourceText}`).join('\n')}
`
      : '';

    const ledger = input.informationLedger;
    const ledgerBlock = ledger?.length
      ? `
## Authored Information Ledger (Section 6 — context for what each character knows)
Respect who knows / withholds each beat and when it is scheduled to surface.
${ledger
  .map(
    (e) =>
      `- ${e.id} "${e.label}": known by ${e.knownBy.join(', ') || 'unspecified'}${
        e.withheldFrom?.length ? `; withheld from ${e.withheldFrom.join(', ')}` : ''
      } (introduced Ep${e.introducedEpisode}${
        e.plannedRevealEpisode ? `, reveal Ep${e.plannedRevealEpisode}` : ''
      })`
  )
  .join('\n')}
`
      : '';

    return `
Create character profiles for this story. Keep descriptions CONCISE (1-2 sentences each).

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}
- **Themes**: ${input.storyContext.themes.join(', ')}
${input.storyContext.userPrompt ? `- **User Instructions/Prompt**: ${input.storyContext.userPrompt}\n` : ''}

## World Context
${input.worldContext}
${architectureBlock}${characterTreatmentBlock}${ledgerBlock}${authoredContext.text ? `
## Original Source Document (Reference for Additional Context)
Use this to extract character details, personalities, relationships, or backstory mentioned in the original document:

${authoredContext.text}${authoredContext.truncated ? '\n... (truncated)' : ''}
` : ''}${input.memoryContext ? `
## Pipeline Memory (Insights from Prior Generations)
${input.memoryContext}
` : ''}
## Characters to Create (MUST use these exact IDs: ${characterIds})
${characterList}

## Required JSON Structure

OUTPUT BUDGET:
- Emit ONLY the fields shown below; do not add fullBackground, traits, values, quirks, pixarDepth, skills, stats, hiddenSecret, or unrequested lore fields.
- Keep scalar text fields to one sentence, ideally 8-18 words.
- Keep arrays to 1-2 items unless a requirement below asks for more.
- Keep relationships to at most 2 per character and keyDynamics to at most 4 total.
- If Fashion Style is provided above, reflect it in typicalAttire; do not emit a nested fashionStyle object unless the schema asks for it.
- Preserve each requested role label exactly, including love_interest, mentor, rival, and wildcard.

{
  "characters": [
    {
      "id": "EXACT_ID_FROM_INPUT",
      "name": "Character Name",
      "pronouns": "he/him OR she/her (use they/them ONLY if character is explicitly non-binary or transgender)",
      "overview": "One sentence summary",
      "role": "protagonist/antagonist/love_interest/mentor/rival/ally/neutral/wildcard",
      "importance": "major/supporting/minor",
      "tier": "core | supporting | background (NPC tier by narrative weight: 'core' = protagonist, primary antagonist, or recurring main cast with a full arc; 'supporting' = named secondary NPCs who appear in several scenes with a relationship dimension; 'background' = one-scene or ambient NPCs)",
      "physicalDescription": "Brief appearance",
      "distinctiveFeatures": ["visual feature 1", "visual feature 2"],
      "typicalAttire": "One concise outfit description that incorporates any provided Fashion Style",
      "want": "What they desire most",
      "fear": "What they're afraid of",
      "flaw": "Their key weakness",
      "need": "OPTIONAL — dramatic necessity underneath the want (map from authored Need if provided)",
      "truth": "OPTIONAL — what they must recognize or refuse (map from authored Truth if provided)",
      "wound": "OPTIONAL — formative pressure behind their protective Lie (map from authored Wound/origin pressure if provided)",
      "microLies": ["OPTIONAL — smaller protective beliefs (map from authored micro-lies if provided)"],
      "voiceProfile": {
        "vocabularyLevel": "simple/moderate/sophisticated",
        "speechPattern": "How they talk",
        "verbalTics": ["tic 1"],
        "emotionalTendency": "How they express emotion",
        "greetingExamples": ["Hello example 1", "Hello example 2"],
        "farewellExamples": ["Goodbye example 1"],
        "underStressExamples": ["Stressed line 1"],
        "signatureLines": ["Unique line 1", "Unique line 2", "Unique line 3"]
      },
      "relationships": [{"targetId": "other-id", "targetName": "Name", "relationshipType": "friend/rival/etc", "currentDynamic": "brief"}],
      "arcPotential": {"growth": "How they could grow", "fall": "How they could fall"},
      "secrets": ["One secret"]
    }
  ],
  "relationshipSummary": "Brief overview of how characters relate",
  "keyDynamics": [{"characters": ["id1", "id2"], "dynamic": "brief", "narrativePotential": "brief"}],
  "ensembleBalance": "How characters complement each other",
  "voiceDistinctions": "How to keep characters sounding distinct from each other",
  "doNotForget": ["Critical character facts to remember"]
}

CRITICAL REQUIREMENTS:
1. Each character "id" MUST be EXACTLY one of: ${characterIds} — copy the string VERBATIM. Do NOT substitute underscores for hyphens. Do NOT change case. Do NOT add suffixes. "char-mr-green" is NOT the same as "char-mr_green".
2. Each character MUST have "pronouns" set to "he/him" or "she/her". Only use "they/them" if the character is explicitly non-binary or transgender. Default to he/him or she/her based on the character's identity.
3. Each character MUST have want, fear, and flaw filled in
4. If a character has a provided Fashion Style, preserve it by reflecting its garments, silhouette, materials, palette, and accessories in "typicalAttire". Fashion style is wardrobe only, not art style.
5. Each voiceProfile MUST have at least 2 greetingExamples and 3 signatureLines
6. MUST include "voiceDistinctions" at the top level (not nested)
7. Keep ALL descriptions concise - one sentence each
8. Return ONLY valid JSON, no markdown, no extra text
`;
  }

  private buildCompactRetryPrompt(basePrompt: string, reason: string): string {
    return `${basePrompt}\n\n` +
      `COMPACT RETRY: ${reason}\n` +
      `Re-emit the COMPLETE character bible as ONE strictly-valid JSON object matching the schema. ` +
      `Escape every double quote inside strings as \\", put no raw line breaks inside strings, and use no trailing commas. ` +
      `Hard output caps: no fields beyond the schema; one sentence per scalar field; arrays max 2 items except greetingExamples and signatureLines; ` +
      `greetingExamples exactly 2, signatureLines exactly 3, keyDynamics max 4, relationships max 2 per character. Return only JSON.`;
  }

  private isGeminiSafetyEmptyError(error: unknown): boolean {
    const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return msg.includes('gemini returned empty content')
      && (
        msg.includes('blockreason=prohibited_content')
        || msg.includes('blockreason=safety')
        || msg.includes('finishreason=safety')
        || msg.includes('prohibited_content')
      );
  }

  private buildSafetyRetryPrompt(input: CharacterDesignerInput): string {
    const characterIds = input.charactersToCreate.map(c => `"${c.id}"`).join(', ');
    const characterList = input.charactersToCreate
      .map(c => {
        const fashion = formatFashionStyleForPrompt(c.fashionStyle);
        return `- ID: "${c.id}", Name: "${c.name}", Role: ${c.role}, Importance: ${c.importance}\n  Brief: ${this.safetyRetryText(c.briefDescription)}${fashion ? `\n  Fashion Style: ${this.safetyRetryText(fashion)}` : ''}`;
      })
      .join('\n');

    return `
SAFETY RETRY: The prior provider response was empty after prompt-safety filtering.
Create a compact character bible from the requested roster only. Do not quote or summarize the source document.
Use non-graphic, non-explicit language. Frame danger, romance, secrets, and supernatural material as emotional/social pressure.

## Story Context
- Title: ${this.safetyRetryText(input.storyContext.title)}
- Genre: ${this.safetyRetryText(input.storyContext.genre)}
- Tone: ${this.safetyRetryText(input.storyContext.tone)}
- Themes: ${input.storyContext.themes.map((theme) => this.safetyRetryText(theme)).join(', ')}

## Characters to Create (MUST use these exact IDs: ${characterIds})
${characterList}

Return ONLY valid JSON with this shape:
{
  "characters": [
    {
      "id": "EXACT_ID_FROM_INPUT",
      "name": "Character Name",
      "pronouns": "he/him OR she/her",
      "overview": "One sentence summary",
      "role": "protagonist/antagonist/love_interest/mentor/rival/ally/neutral/wildcard",
      "importance": "major/supporting/minor",
      "tier": "core | supporting | background",
      "physicalDescription": "Brief appearance",
      "distinctiveFeatures": ["visual feature 1", "visual feature 2"],
      "typicalAttire": "One concise outfit description",
      "want": "What they desire most",
      "fear": "What social, emotional, or identity pressure they avoid",
      "flaw": "Their key weakness",
      "need": "OPTIONAL dramatic necessity",
      "truth": "OPTIONAL truth they must recognize or refuse",
      "wound": "OPTIONAL formative pressure",
      "microLies": ["OPTIONAL protective belief"],
      "voiceProfile": {
        "vocabularyLevel": "simple/moderate/sophisticated",
        "speechPattern": "How they talk",
        "verbalTics": ["tic 1"],
        "emotionalTendency": "How they express emotion",
        "greetingExamples": ["Hello example 1", "Hello example 2"],
        "farewellExamples": ["Goodbye example 1"],
        "underStressExamples": ["Stressed line 1"],
        "signatureLines": ["Unique line 1", "Unique line 2", "Unique line 3"]
      },
      "relationships": [{"targetId": "other-id", "targetName": "Name", "relationshipType": "friend/rival/etc", "currentDynamic": "brief"}],
      "arcPotential": {"growth": "How they could grow", "fall": "How they could fall"},
      "secrets": ["One secret"]
    }
  ],
  "relationshipSummary": "Brief overview",
  "keyDynamics": [{"characters": ["id1", "id2"], "dynamic": "brief", "narrativePotential": "brief"}],
  "ensembleBalance": "How characters complement each other",
  "voiceDistinctions": "How to keep voices distinct",
  "doNotForget": ["Critical character facts"]
}

Requirements:
- Each character id must be exactly one of: ${characterIds}
- Keep every scalar field to one concise sentence.
- greetingExamples exactly 2; signatureLines exactly 3; relationships max 2 per character.
- No markdown, no code fences, no extra text.`;
  }

  private safetyRetryText(value: string | undefined): string {
    return String(value || '')
      .replace(/\b(?:blood|bloody|bite|bitten|vampire|vampiric|strigoi|attack|attacker|kill|killer|murder|sex|sexual)\b/gi, (word) => {
        const lower = word.toLowerCase();
        if (lower.startsWith('vamp') || lower === 'strigoi') return 'supernatural';
        if (lower === 'bite' || lower === 'bitten' || lower === 'blood' || lower === 'bloody') return 'danger';
        if (lower === 'sex' || lower === 'sexual') return 'romantic';
        return 'threat';
      })
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeCharacterBible(bible: CharacterBible): CharacterBible {
    // Top-level arrays
    if (!bible.characters) {
      bible.characters = [];
    } else if (!Array.isArray(bible.characters)) {
      bible.characters = [bible.characters as unknown as CharacterProfile];
    }

    if (!bible.keyDynamics) {
      bible.keyDynamics = [];
    } else if (!Array.isArray(bible.keyDynamics)) {
      bible.keyDynamics = [bible.keyDynamics as unknown as { characters: string[]; dynamic: string; narrativePotential: string }];
    }

    if (!bible.gaps) {
      bible.gaps = [];
    } else if (!Array.isArray(bible.gaps)) {
      bible.gaps = [bible.gaps as unknown as string];
    }

    if (!bible.doNotForget) {
      bible.doNotForget = [];
    } else if (!Array.isArray(bible.doNotForget)) {
      bible.doNotForget = [bible.doNotForget as unknown as string];
    }

    // Normalize each character's arrays
    for (const character of bible.characters) {
      if (!character.traits) {
        character.traits = [];
      } else if (!Array.isArray(character.traits)) {
        character.traits = [character.traits as unknown as string];
      }

      if (!character.values) {
        character.values = [];
      } else if (!Array.isArray(character.values)) {
        character.values = [character.values as unknown as string];
      }

      if (!character.quirks) {
        character.quirks = [];
      } else if (!Array.isArray(character.quirks)) {
        character.quirks = [character.quirks as unknown as string];
      }

      // microLies is optional; only coerce when the LLM returned a bare string.
      if (character.microLies !== undefined && !Array.isArray(character.microLies)) {
        character.microLies = [character.microLies as unknown as string];
      }

      if (!character.distinctiveFeatures) {
        character.distinctiveFeatures = [];
      } else if (!Array.isArray(character.distinctiveFeatures)) {
        character.distinctiveFeatures = [character.distinctiveFeatures as unknown as string];
      }

      character.fashionStyle = normalizeFashionStyle(character.fashionStyle);

      // 1.4: a core/supporting NPC must carry modeled relationship dimensions —
      // NPCDepthValidator infers them from `initialStats` presence (all four for
      // core, >=2 for supporting). Backfill any dimension the LLM omitted with a
      // neutral (0) baseline so a relationship-bearing NPC isn't marked depthless
      // purely for a missing stats block. Real authored values are preserved;
      // only missing dimensions are filled. Background NPCs are left untouched.
      if (character.tier === 'core' || character.tier === 'supporting') {
        const s = character.initialStats;
        character.initialStats = {
          trust: typeof s?.trust === 'number' ? s.trust : 0,
          affection: typeof s?.affection === 'number' ? s.affection : 0,
          respect: typeof s?.respect === 'number' ? s.respect : 0,
          fear: typeof s?.fear === 'number' ? s.fear : 0,
        };
      }

      const validPronouns: PronounSet[] = ['he/him', 'she/her', 'they/them'];
      if (!character.pronouns || !validPronouns.includes(character.pronouns)) {
        const desc = (character.physicalDescription || character.overview || '').toLowerCase();
        const name = (character.name || '').toLowerCase();
        if (desc.includes(' she ') || desc.includes(' her ') || desc.includes('woman') || desc.includes('girl') || desc.includes('female') || desc.includes('queen') || desc.includes('princess') || desc.includes('duchess') || desc.includes('goddess') || desc.includes('mother') || desc.includes('sister') || desc.includes('wife') || desc.includes('daughter')) {
          character.pronouns = 'she/her';
        } else if (desc.includes(' he ') || desc.includes(' his ') || desc.includes(' him ') || desc.includes('man') || desc.includes('boy') || desc.includes('male') || desc.includes('king') || desc.includes('prince') || desc.includes('duke') || desc.includes('god') || desc.includes('father') || desc.includes('brother') || desc.includes('husband') || desc.includes('son')) {
          character.pronouns = 'he/him';
        } else if (desc.includes('non-binary') || desc.includes('nonbinary') || desc.includes('trans') || desc.includes('genderqueer') || desc.includes('genderfluid') || desc.includes('agender')) {
          character.pronouns = 'they/them';
        } else {
          character.pronouns = 'he/him';
        }
      }

      if (!character.relationships) {
        character.relationships = [];
      } else if (!Array.isArray(character.relationships)) {
        character.relationships = [character.relationships as unknown as CharacterRelationship];
      }

      // Normalize voice profile arrays
      if (character.voiceProfile) {
        const voice = character.voiceProfile;

        if (!voice.verbalTics) {
          voice.verbalTics = [];
        } else if (!Array.isArray(voice.verbalTics)) {
          voice.verbalTics = [voice.verbalTics as unknown as string];
        }

        if (!voice.favoriteExpressions) {
          voice.favoriteExpressions = [];
        } else if (!Array.isArray(voice.favoriteExpressions)) {
          voice.favoriteExpressions = [voice.favoriteExpressions as unknown as string];
        }

        if (!voice.avoidedWords) {
          voice.avoidedWords = [];
        } else if (!Array.isArray(voice.avoidedWords)) {
          voice.avoidedWords = [voice.avoidedWords as unknown as string];
        }

        if (!voice.greetingExamples) {
          voice.greetingExamples = [];
        } else if (!Array.isArray(voice.greetingExamples)) {
          voice.greetingExamples = [voice.greetingExamples as unknown as string];
        }

        if (!voice.farewellExamples) {
          voice.farewellExamples = [];
        } else if (!Array.isArray(voice.farewellExamples)) {
          voice.farewellExamples = [voice.farewellExamples as unknown as string];
        }

        if (!voice.underStressExamples) {
          voice.underStressExamples = [];
        } else if (!Array.isArray(voice.underStressExamples)) {
          voice.underStressExamples = [voice.underStressExamples as unknown as string];
        }
      }

      // Normalize arc potential
      if (character.arcPotential) {
        if (!character.arcPotential.triggerEvents) {
          character.arcPotential.triggerEvents = [];
        } else if (!Array.isArray(character.arcPotential.triggerEvents)) {
          character.arcPotential.triggerEvents = [character.arcPotential.triggerEvents as unknown as string];
        }
      }

      // Normalize relationship arrays
      for (const rel of character.relationships) {
        if (!rel.unresolvedIssues) {
          rel.unresolvedIssues = [];
        } else if (!Array.isArray(rel.unresolvedIssues)) {
          rel.unresolvedIssues = [rel.unresolvedIssues as unknown as string];
        }

        if (!rel.potentialConflicts) {
          rel.potentialConflicts = [];
        } else if (!Array.isArray(rel.potentialConflicts)) {
          rel.potentialConflicts = [rel.potentialConflicts as unknown as string];
        }

        if (!rel.couldBecome) {
          rel.couldBecome = [];
        } else if (!Array.isArray(rel.couldBecome)) {
          rel.couldBecome = [rel.couldBecome as unknown as string];
        }
      }
    }

    // Normalize keyDynamics character arrays
    for (const dynamic of bible.keyDynamics) {
      if (!dynamic.characters) {
        dynamic.characters = [];
      } else if (!Array.isArray(dynamic.characters)) {
        dynamic.characters = [dynamic.characters as unknown as string];
      }
    }

    return bible;
  }

  /**
   * Reconcile the IDs returned by the LLM with the canonical IDs the pipeline
   * requested. LLMs frequently rewrite hyphens as underscores, change casing,
   * or truncate long ids. We:
   *   1. Accept exact matches as-is.
   *   2. Try a fuzzy key (stripped of non-alphanumeric chars, lowercased).
   *   3. If a returned id fuzzy-matches a requested id, rewrite it in place and
   *      also fix any cross-references in keyDynamics and relationships.
   *
   * Characters the LLM invented that don't match any requested id are left
   * alone so downstream validation can still surface them, but the requested
   * set is preferred.
   */
  private alignCharacterIds(bible: CharacterBible, input: CharacterDesignerInput): void {
    if (!bible.characters || bible.characters.length === 0) return;

    const fuzzyKey = (s: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

    const requestedById = new Map<string, { id: string; name: string }>();
    const requestedByFuzzyId = new Map<string, string>();
    const requestedByFuzzyName = new Map<string, string>();
    for (const req of input.charactersToCreate) {
      requestedById.set(req.id, req);
      requestedByFuzzyId.set(fuzzyKey(req.id), req.id);
      if (req.name) requestedByFuzzyName.set(fuzzyKey(req.name), req.id);
    }

    const idRewrites = new Map<string, string>();
    for (const character of bible.characters) {
      const currentId = character.id || '';
      if (requestedById.has(currentId)) continue;

      const fk = fuzzyKey(currentId);
      let canonical = requestedByFuzzyId.get(fk);
      if (!canonical && character.name) {
        canonical = requestedByFuzzyName.get(fuzzyKey(character.name));
      }
      if (canonical && canonical !== currentId) {
        console.log(`[CharacterDesigner] Re-aligning character id "${currentId}" → "${canonical}"`);
        idRewrites.set(currentId, canonical);
        character.id = canonical;
      }
    }

    if (idRewrites.size === 0) return;

    // Fix cross-references to the rewritten ids.
    const rewrite = (v: string): string => idRewrites.get(v) ?? v;
    for (const dyn of bible.keyDynamics || []) {
      if (Array.isArray(dyn.characters)) {
        dyn.characters = dyn.characters.map(rewrite);
      }
    }
    for (const character of bible.characters) {
      if (Array.isArray(character.relationships)) {
        for (const rel of character.relationships) {
          const relId = (rel as { characterId?: string }).characterId;
          if (relId && idRewrites.has(relId)) {
            (rel as { characterId?: string }).characterId = idRewrites.get(relId)!;
          }
        }
      }
    }
  }

  private validateCharacterBible(bible: CharacterBible, input: CharacterDesignerInput): void {
    console.log(`[CharacterDesigner] Validating character bible...`);
    console.log(`[CharacterDesigner] Requested IDs:`, input.charactersToCreate.map(c => c.id).join(', '));
    console.log(`[CharacterDesigner] Received IDs:`, bible.characters?.map(c => c.id).join(', ') || 'none');

    // Check we have characters
    if (!bible.characters || bible.characters.length === 0) {
      throw new Error('Character bible must have at least 1 character');
    }

    // Check all requested characters are present
    const characterIds = new Set(bible.characters.map(c => c.id));
    for (const requested of input.charactersToCreate) {
      if (!characterIds.has(requested.id)) {
        throw new Error(`Missing requested character: ${requested.id}. Requested: [${input.charactersToCreate.map(c => c.id).join(', ')}]. Received: [${Array.from(characterIds).join(', ')}]`);
      }
    }

    // Validate each character
    for (const character of bible.characters) {
      // Must have Want/Fear/Flaw
      if (!character.want || !character.fear || !character.flaw) {
        throw new Error(`Character ${character.id} missing Want/Fear/Flaw trinity`);
      }

      // Must have voice profile
      if (!character.voiceProfile) {
        throw new Error(`Character ${character.id} missing voice profile`);
      }

      // Voice profile must have sample lines
      const voice = character.voiceProfile;
      if (!voice.greetingExamples || voice.greetingExamples.length < 2) {
        throw new Error(`Character ${character.id} needs more greeting examples`);
      }
    }

    // Check for voice distinction notes
    if (!bible.voiceDistinctions) {
      throw new Error('Character bible must include voice distinction notes');
    }
  }

  private backfillLowWeightVoiceSamples(bible: CharacterBible, input: CharacterDesignerInput): void {
    const requestedById = new Map(input.charactersToCreate.map((character) => [character.id, character]));

    for (const character of bible.characters || []) {
      const requested = requestedById.get(character.id);
      const isSupportingNeutral = requested?.importance === 'supporting' && requested.role === 'neutral';
      const isLowWeight = character.tier === 'background' || requested?.importance === 'minor' || isSupportingNeutral;
      const voice = character.voiceProfile;
      if (!isLowWeight || !voice) continue;

      if (!Array.isArray(voice.greetingExamples)) {
        voice.greetingExamples = voice.greetingExamples ? [String(voice.greetingExamples)] : [];
      }

      const greetings = voice.greetingExamples.map((line) => String(line || '').trim()).filter(Boolean);
      const formal = voice.formality === 'formal';
      const casual = voice.formality === 'casual';
      const defaults = formal
        ? ['Good evening.', 'Please, come in.']
        : casual
          ? ['Hey.', 'Come on in.']
          : ['Hello.', 'Come in.'];

      for (const fallback of defaults) {
        if (greetings.length >= 2) break;
        if (!greetings.includes(fallback)) greetings.push(fallback);
      }

      voice.greetingExamples = greetings;
    }
  }

  private preserveInputFashionStyle(bible: CharacterBible, input: CharacterDesignerInput): void {
    const inputFashionById = new Map(
      input.charactersToCreate
        .map((character) => [character.id, normalizeFashionStyle(character.fashionStyle)] as const)
        .filter((entry): entry is readonly [string, CharacterFashionStyle] => !!entry[1]),
    );

    for (const character of bible.characters || []) {
      const inputFashion = inputFashionById.get(character.id);
      if (!inputFashion) continue;

      const outputFashion = normalizeFashionStyle(character.fashionStyle);
      character.fashionStyle = outputFashion
        ? {
            styleSummary: outputFashion.styleSummary || inputFashion.styleSummary,
            styleTags: outputFashion.styleTags.length ? outputFashion.styleTags : inputFashion.styleTags,
            signatureGarments: outputFashion.signatureGarments.length ? outputFashion.signatureGarments : inputFashion.signatureGarments,
            materials: outputFashion.materials.length ? outputFashion.materials : inputFashion.materials,
            colorPalette: outputFashion.colorPalette.length ? outputFashion.colorPalette : inputFashion.colorPalette,
            accessories: outputFashion.accessories.length ? outputFashion.accessories : inputFashion.accessories,
            sourceEvidence: outputFashion.sourceEvidence?.length ? outputFashion.sourceEvidence : inputFashion.sourceEvidence,
          }
        : inputFashion;

      if (!character.typicalAttire && character.fashionStyle) {
        character.typicalAttire = [
          character.fashionStyle.styleSummary,
          character.fashionStyle.signatureGarments.join(', '),
        ].filter(Boolean).join('; ');
      }
    }
  }

  /**
   * Collect quality issues that could be improved (beyond structural validation)
   */
  private collectQualityIssues(bible: CharacterBible, input: CharacterDesignerInput): string[] {
    const issues: string[] = [];

    for (const character of bible.characters) {
      // Check Want/Fear/Flaw depth
      if (character.want && character.want.length < 15) {
        issues.push(`CHARACTER "${character.name}": WANT is too brief (${character.want.length} chars). Make it more specific.`);
      }
      if (character.fear && character.fear.length < 15) {
        issues.push(`CHARACTER "${character.name}": FEAR is too brief (${character.fear.length} chars). Make it more specific.`);
      }
      if (character.flaw && character.flaw.length < 15) {
        issues.push(`CHARACTER "${character.name}": FLAW is too brief (${character.flaw.length} chars). Make it more specific.`);
      }

      // Check voice profile completeness
      const voice = character.voiceProfile;
      if (voice) {
        if (!voice.verbalTics || voice.verbalTics.length < 1) {
          issues.push(`CHARACTER "${character.name}": Missing verbal tics. What phrases do they repeat?`);
        }
        if (!voice.underStressExamples || voice.underStressExamples.length < 1) {
          issues.push(`CHARACTER "${character.name}": Missing "under stress" examples. How do they talk when pressured?`);
        }
        if (!voice.farewellExamples || voice.farewellExamples.length < 1) {
          issues.push(`CHARACTER "${character.name}": Missing farewell examples. How do they say goodbye?`);
        }
        // Check for signature lines (important for voice distinction)
        const signatureLines = (voice as any).signatureLines;
        if (!signatureLines || signatureLines.length < 3) {
          issues.push(`CHARACTER "${character.name}": Needs at least 3 signature lines that only THIS character would say.`);
        }
      }

      // Check for relationships (major characters should have them)
      const requestedChar = input.charactersToCreate.find(c => c.id === character.id);
      if (requestedChar?.importance === 'major') {
        if (!character.relationships || character.relationships.length < 1) {
          issues.push(`CHARACTER "${character.name}": Major character should have at least 1 defined relationship.`);
        }
      }

      // Check arc potential
      if (!character.arcPotential) {
        issues.push(`CHARACTER "${character.name}": Missing arc potential. How could they grow or fall?`);
      } else {
        if (!character.arcPotential.possibleGrowth && !(character.arcPotential as any).growth) {
          issues.push(`CHARACTER "${character.name}": Arc potential missing growth path. How could they become better?`);
        }
        if (!character.arcPotential.possibleFall && !(character.arcPotential as any).fall) {
          issues.push(`CHARACTER "${character.name}": Arc potential missing fall path. How could they become worse?`);
        }
      }

      // Check physical description
      if (!character.physicalDescription || character.physicalDescription.length < 20) {
        issues.push(`CHARACTER "${character.name}": Physical description is too brief. Add distinctive visual details.`);
      }
    }

    // Check key dynamics
    if (!bible.keyDynamics || bible.keyDynamics.length < 1) {
      issues.push(`ENSEMBLE: Missing key dynamics between characters.`);
    }

    // Check ensemble balance analysis
    if (!bible.ensembleBalance || bible.ensembleBalance.length < 20) {
      issues.push(`ENSEMBLE: Missing or brief ensemble balance analysis.`);
    }

    return issues;
  }

  /**
   * Execute a revision pass to fix identified quality issues
   */
  private async executeRevision(
    input: CharacterDesignerInput,
    originalBible: CharacterBible,
    issues: string[]
  ): Promise<CharacterBible> {
    console.log(`[CharacterDesigner] Executing revision to fix ${issues.length} quality issues`);

    const issueList = issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n');

    const revisionPrompt = `
You previously created a character bible, but there are quality issues that need improvement.

## Original Character Bible
\`\`\`json
${JSON.stringify(originalBible, null, 2)}
\`\`\`

## Issues to Fix
${issueList}

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}
- **Themes**: ${input.storyContext.themes.join(', ')}

## How to Fix

### WANT/FEAR/FLAW Issues
- WANT: What do they actively desire? Make it specific and concrete.
- FEAR: What are they running from or avoiding? Make it emotionally resonant.
- FLAW: What personal weakness creates conflict? Make it impactful.

### VOICE PROFILE Issues
- Add verbal tics (phrases they repeat)
- Add under-stress examples (how they sound when pressured)
- Add farewell examples (how they say goodbye)
- Add signature lines (unique phrases ONLY this character would say)

### RELATIONSHIP Issues
- Define relationships with other characters
- Include both current dynamic and history
- Note unresolved issues and potential conflicts

### ARC POTENTIAL Issues
- Define growth path (how they could become better)
- Define fall path (how they could become worse)
- Include trigger events that could cause change

## Requirements
Return a REVISED CharacterBible JSON that fixes all the issues above.
Keep all existing content but improve the flagged areas.
Return ONLY valid JSON, no markdown, no extra text.
`;

    try {
      const response = await this.callLLM(
        [{ role: 'user', content: revisionPrompt }],
        4,
        { jsonSchema: buildCharacterBibleJsonSchema(input.charactersToCreate.length) },
      );

      console.log(`[CharacterDesigner] Received revision response (${response.length} chars)`);

      let revisedBible: CharacterBible;
      try {
        revisedBible = this.parseJSON<CharacterBible>(response);
        revisedBible = this.normalizeCharacterBible(revisedBible);
        this.alignCharacterIds(revisedBible, input);
        this.preserveInputFashionStyle(revisedBible, input);
        console.log(`[CharacterDesigner] Revision complete`);
        return revisedBible;
      } catch (parseError) {
        console.error(`[CharacterDesigner] Revision JSON parse failed, using original`);
        return originalBible;
      }
    } catch (error) {
      console.error(`[CharacterDesigner] Revision failed, using original:`, error);
      return originalBible;
    }
  }
}
