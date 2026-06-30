/**
 * OutcomeVariantAuthor — the generative half of the encounter-outcome-variant gate
 * (Gen-4 W4).
 *
 * `seedEncounterOutcomeFlags` makes each encounter outcome SET a state flag, and
 * `findEncounterOutcomeDesyncs` flags reconvergence scenes whose prose ignores it
 * (≥2 outcomes feed one next scene that opens identically regardless of what
 * happened — the Endsong wall-breach → s3-5 case: Lysandra wounded in one outcome
 * but "relaxed at the parapet" in the shared opening). The deterministic passes can
 * detect the desync but cannot WRITE the outcome-aware prose.
 *
 * This agent authors that prose: given the reconvergence scene's opening beat and
 * what each reconverging outcome left behind (its outcomeText), it writes one variant
 * of the opening beat per outcome that reflects that state while preserving the
 * scene's purpose and continuity. The caller gates each variant on the matching
 * `encounter_<id>_<outcome>` flag.
 *
 * Degrade-not-block: any failure returns zero variants, so the gate keeps the desync.
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';

export interface OutcomeVariantAuthorInput {
  reconvergenceSceneId: string;
  /** The opening (default) prose of the reconvergence scene the variants branch from. */
  openingBeatText: string;
  encounterId: string;
  encounterName: string;
  /** The reconverging outcomes and what each left behind (the encounter's outcomeText). */
  outcomes: Array<{ outcome: string; outcomeText: string }>;
}

export interface AuthoredOutcomeVariant {
  outcome: string;
  text: string;
}

export interface OutcomeVariantAuthorResult {
  variants: AuthoredOutcomeVariant[];
}

export class OutcomeVariantAuthor extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Outcome Variant Author', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Outcome Variant Author

A scene is reached by several different encounter outcomes. Its opening prose is
currently the SAME no matter what happened — so it can contradict the result (a
character wounded in one outcome appears unharmed). Rewrite the opening prose into
one variant per outcome so it reflects what actually happened.

**Rules**
1. One variant per outcome listed. Keep each variant the same scene moment and
   purpose as the original opening — only what the OUTCOME changed should differ
   (a wound, a captured ally, a lost item, a shift in who is present or how they
   carry themselves).
2. Stay continuous with the original: same place, same characters present, same
   forward intent. Do not invent new plot or contradict the outcome's facts.
3. Fiction-first: never mention outcomes, flags, mechanics, or "because you won/lost".
   Show the state through behavior and sensory detail.
4. Keep length within ±30% of the original opening.

**REQUIRED JSON STRUCTURE**
\`\`\`json
{
  "variants": [
    { "outcome": "partialVictory", "text": "...opening prose reflecting the wound..." },
    { "outcome": "defeat", "text": "...opening prose reflecting the loss..." }
  ]
}
\`\`\`

Return ONLY JSON. Include one entry per outcome provided.
`;
  }

  async execute(input: OutcomeVariantAuthorInput): Promise<AgentResponse<OutcomeVariantAuthorResult>> {
    if (!input.outcomes || input.outcomes.length === 0 || !input.openingBeatText) {
      return { success: true, data: { variants: [] } };
    }
    const prompt = this.buildPrompt(input);
    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      let parsed: OutcomeVariantAuthorResult;
      try {
        parsed = this.parseJSON<OutcomeVariantAuthorResult>(response);
      } catch (parseError) {
        console.error('[OutcomeVariantAuthor] JSON parse failed:', response.substring(0, 500));
        throw parseError;
      }
      return { success: true, data: normalizeOutcomeVariants(parsed, input.outcomes.map((o) => o.outcome)), rawResponse: response };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[OutcomeVariantAuthor] Error:', msg);
      return { success: true, data: { variants: [] }, error: msg };
    }
  }

  private buildPrompt(input: OutcomeVariantAuthorInput): string {
    const outcomeBlock = input.outcomes
      .map((o) => `- ${o.outcome}: ${o.outcomeText}`)
      .join('\n');
    return (
      `# Reconvergence scene: ${input.reconvergenceSceneId}\n` +
      `Reached after encounter "${input.encounterName}" (${input.encounterId}).\n\n` +
      `## Current opening prose (default, outcome-blind)\n${input.openingBeatText}\n\n` +
      `## What each outcome left behind\n${outcomeBlock}\n\n` +
      `Write one opening variant per outcome per the REQUIRED JSON STRUCTURE above. Return ONLY JSON.`
    );
  }
}

/**
 * Keep only variants whose `outcome` is one of the requested outcomes and whose
 * `text` is non-empty; first variant per outcome wins. Pure + exported for testing.
 */
export function normalizeOutcomeVariants(
  parsed: OutcomeVariantAuthorResult | undefined,
  requestedOutcomes: string[],
): OutcomeVariantAuthorResult {
  const allowed = new Set(requestedOutcomes);
  const seen = new Set<string>();
  const variants: AuthoredOutcomeVariant[] = [];
  for (const v of parsed?.variants ?? []) {
    if (!v || typeof v.outcome !== 'string' || typeof v.text !== 'string') continue;
    const outcome = v.outcome.trim();
    const text = v.text.trim();
    if (!allowed.has(outcome) || !text || seen.has(outcome)) continue;
    seen.add(outcome);
    variants.push({ outcome, text });
  }
  return { variants };
}
