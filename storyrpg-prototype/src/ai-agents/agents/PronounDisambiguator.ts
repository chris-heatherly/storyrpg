/**
 * PronounDisambiguator — micro-agent for the protagonist-pronoun regen route (Gen-4 W1).
 *
 * The deterministic {@link canonicalizeProtagonistPronouns} resolver fixes the SAFE
 * wrong-gender cases (protagonist-only sentences) but refuses to touch genuinely
 * AMBIGUOUS sentences — ones that name both the protagonist and a wrong-gender NPC,
 * where a bare third-person pronoun could bind to either ("Kylie watches Mika lift
 * his glass"). Those are the residue that gates GATE_PROTAGONIST_PRONOUN.
 *
 * This agent is the regen half: given the ambiguous sentences and the protagonist's
 * canon identity, it rewrites each so EVERY reference is unambiguous — promoting a
 * mis-gendered protagonist pronoun to the canon set (or the name), and pinning an
 * NPC pronoun to that NPC's name. It changes as little as possible and never invents
 * plot. Operates on raw sentences, so it works anywhere a sentence lives (scene
 * beats AND encounter outcome/reaction fields — where the original drift occurred and
 * which SceneCritic cannot reach).
 *
 * Degrade-not-block: any failure returns zero rewrites, so the gate simply keeps the
 * unresolved residue (it never fabricates a fix).
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';

export interface PronounDisambiguatorInput {
  /** The ambiguous sentences to rewrite (verbatim, as the resolver reported them). */
  sentences: string[];
  /** Protagonist display name (e.g. "Kylie"). */
  protagonistName: string;
  /** Protagonist canon pronouns (e.g. "she/her"). */
  protagonistPronouns: string;
  /** Names of wrong-gender characters whose pronouns are the source of ambiguity. */
  otherGenderNames: string[];
}

export interface PronounRewrite {
  original: string;
  rewritten: string;
}

export interface PronounDisambiguationResult {
  rewrites: PronounRewrite[];
}

export class PronounDisambiguator extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Pronoun Disambiguator', config);
    // Narrow, mechanical sentence-surgery task — no need for the full story system prompt.
    this.includeSystemPrompt = false;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Pronoun Disambiguator

You receive prose sentences in which a third-person pronoun is ambiguous: it could
refer to the PROTAGONIST or to another character named in the same sentence. Rewrite
each sentence so every reference is unambiguous.

**Rules**
1. The protagonist's pronouns are CANON. If a pronoun was meant to be the protagonist,
   it MUST match the canon pronouns — if it currently does not, that is the defect:
   fix it (or use the protagonist's name).
2. If a pronoun refers to ANOTHER character, replace the bare pronoun with that
   character's name (or otherwise make the referent unmistakable).
3. Change as little as possible. Preserve meaning, tense, tone, and roughly the length.
4. Never invent new characters, actions, or plot. Do not add commentary.
5. Return the rewritten sentence with its original terminating punctuation.

**REQUIRED JSON STRUCTURE**
\`\`\`json
{
  "rewrites": [
    { "original": "<one of the input sentences, verbatim>", "rewritten": "<the disambiguated sentence>" }
  ]
}
\`\`\`

Include one entry per input sentence. Return ONLY JSON.
`;
  }

  async execute(input: PronounDisambiguatorInput): Promise<AgentResponse<PronounDisambiguationResult>> {
    if (!input.sentences || input.sentences.length === 0) {
      return { success: true, data: { rewrites: [] } };
    }
    const prompt = this.buildPrompt(input);
    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      let parsed: PronounDisambiguationResult;
      try {
        parsed = this.parseJSON<PronounDisambiguationResult>(response);
      } catch (parseError) {
        console.error('[PronounDisambiguator] JSON parse failed:', response.substring(0, 500));
        throw parseError;
      }
      return { success: true, data: normalizeDisambiguation(parsed, input.sentences), rawResponse: response };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[PronounDisambiguator] Error:', msg);
      // Degrade: no rewrites → the gate keeps the unresolved residue.
      return { success: true, data: { rewrites: [] }, error: msg };
    }
  }

  private buildPrompt(input: PronounDisambiguatorInput): string {
    const others = input.otherGenderNames.length
      ? input.otherGenderNames.join(', ')
      : '(none named)';
    const list = input.sentences.map((s, i) => `${i + 1}. ${s}`).join('\n');
    return (
      `# Protagonist\n` +
      `- name: ${input.protagonistName}\n` +
      `- canon pronouns: ${input.protagonistPronouns}\n` +
      `- other (wrong-gender) characters who may appear: ${others}\n\n` +
      `# Sentences to disambiguate\n${list}\n\n` +
      `Rewrite each per the REQUIRED JSON STRUCTURE above. Return ONLY JSON.`
    );
  }
}

/**
 * Keep only rewrites whose `original` is one of the inputs and whose `rewritten` is a
 * non-empty, actually-different string. Pure + exported for unit testing.
 */
export function normalizeDisambiguation(
  parsed: PronounDisambiguationResult | undefined,
  inputSentences: string[],
): PronounDisambiguationResult {
  const allowed = new Set(inputSentences.map((s) => s.trim()));
  const seen = new Set<string>();
  const rewrites: PronounRewrite[] = [];
  for (const r of parsed?.rewrites ?? []) {
    if (!r || typeof r.original !== 'string' || typeof r.rewritten !== 'string') continue;
    const original = r.original.trim();
    const rewritten = r.rewritten.trim();
    if (!allowed.has(original)) continue;       // hallucinated source sentence
    if (!rewritten || rewritten === original) continue; // no-op
    if (seen.has(original)) continue;           // first rewrite per sentence wins
    seen.add(original);
    rewrites.push({ original, rewritten });
  }
  return { rewrites };
}
