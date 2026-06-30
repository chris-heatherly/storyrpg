/**
 * Style Architect Agent
 *
 * Takes an arbitrary art-style string (anything from "romance novel" to
 * "Moebius x 90s Saturday-morning cartoon") and expands it into a full
 * `ArtStyleProfile` with rendering technique, color philosophy, lighting,
 * line weight, composition style, and mood language. The pipeline and the
 * UI both call this agent so a user's free-form style description flows
 * through the entire image pipeline as a consistent, enforceable contract
 * instead of a one-word label that the image model interprets however it
 * likes.
 *
 * A small in-process cache keeps repeated calls for the same input string
 * cheap — the profile is deterministic for a given raw string, so we only
 * pay the LLM cost once per session per style.
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';
import type { ArtStyleProfile } from '../images/artStyleProfile';
import { buildVerbatimProfile } from '../images/artStyleProfile';

export interface StyleArchitectInput {
  /** The raw art-style string the user supplied (e.g. "romance novel"). */
  artStyle: string;
  /**
   * Optional genre hint to help the LLM disambiguate (e.g. "regency romance"
   * vs. "paranormal romance" reads the same name but expands differently).
   */
  genreHint?: string;
}

interface StyleArchitectLlmResponse {
  name?: string;
  renderingTechnique?: string;
  colorPhilosophy?: string;
  lightingApproach?: string;
  lineWeight?: string;
  compositionStyle?: string;
  moodRange?: string;
  positiveVocabulary?: string[];
  inappropriateVocabulary?: string[];
  genreNegatives?: string[];
}

export class StyleArchitect extends BaseAgent {
  private static cache = new Map<string, ArtStyleProfile>();

  constructor(config: AgentConfig) {
    super('Style Architect', config);
    this.includeSystemPrompt = false;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Style Architect

You translate arbitrary art-style labels into a precise, enforceable style contract for an image-generation pipeline. Given a style string the user might type (anything from a known school like "watercolor" to a niche like "romance novel cover" or a mashup like "Moebius x Ghibli"), you expand it into concrete visual DNA the model can actually follow.

## Rules
- Treat the user's string as authoritative — never substitute a more familiar style.
- Every DNA field must be a single sentence focused on that dimension only. Do NOT repeat phrasing across fields.
- Keep the total output under ~200 tokens of JSON.
- Never output cinematic cliches ("cinematic", "dramatic", "emotionally charged", "sharp focus") unless the requested style literally IS cinematic live-action.
- Positive/inappropriate vocabulary entries should be 1–3 words each, not full sentences.
- Return ONLY valid JSON — no markdown fences, no prose.
`;
  }

  /**
   * Expand the user's raw art-style string into a full profile. Returns the
   * verbatim heuristic profile if the LLM call fails or returns unusable
   * output — the verbatim profile is always a safe default because it
   * echoes the user's own words back instead of overriding them.
   */
  async expand(input: StyleArchitectInput): Promise<ArtStyleProfile> {
    const raw = input.artStyle.trim();
    if (!raw) return buildVerbatimProfile('');

    const cacheKey = `${raw.toLowerCase()}::${(input.genreHint || '').toLowerCase()}`;
    const cached = StyleArchitect.cache.get(cacheKey);
    if (cached) return cached;

    const prompt = this.buildExpansionPrompt(input);

    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      const parsed = this.parseJSON<StyleArchitectLlmResponse>(response);
      const profile = this.toProfile(raw, parsed);
      StyleArchitect.cache.set(cacheKey, profile);
      return profile;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[StyleArchitect] LLM expansion failed for "${raw}" (${message}); falling back to verbatim profile.`,
      );
      const fallback = buildVerbatimProfile(raw);
      StyleArchitect.cache.set(cacheKey, fallback);
      return fallback;
    }
  }

  /** Expose cache invalidation for tests. */
  static clearCache(): void {
    StyleArchitect.cache.clear();
  }

  /**
   * BaseAgent requires `execute`. We only call `expand` directly, but
   * keep a trivial execute so downstream orchestration utilities that
   * walk a list of agents still work.
   */
  async execute(input: unknown): Promise<AgentResponse<ArtStyleProfile>> {
    const raw =
      typeof input === 'string'
        ? input
        : (input as StyleArchitectInput | undefined)?.artStyle || '';
    const profile = await this.expand({ artStyle: raw });
    return { success: true, data: profile };
  }

  private buildExpansionPrompt(input: StyleArchitectInput): string {
    return `
Expand the following art-style label into its enforceable visual DNA.

**Art style label**: "${input.artStyle.trim()}"
${input.genreHint ? `**Genre hint**: "${input.genreHint}"` : ''}

Respond with ONLY this JSON shape:

{
  "name": "${input.artStyle.trim()}",
  "renderingTechnique": "<one sentence describing medium, brushwork or pixel density, edge softness>",
  "colorPhilosophy": "<one sentence describing palette behavior, saturation, how colors relate>",
  "lightingApproach": "<one sentence describing light quality, shadow behavior, atmosphere>",
  "lineWeight": "<one sentence describing outlines, linework, line variance>",
  "compositionStyle": "<one sentence describing framing conventions, depth treatment, camera feel>",
  "moodRange": "<one sentence describing emotional register and tonal defaults>",
  "positiveVocabulary": ["<1–6 short cue words that reinforce the style>"],
  "inappropriateVocabulary": ["<1–6 short words that CONTRADICT this style and should be stripped>"],
  "genreNegatives": ["<1–6 short negative-prompt cues specific to this style>"]
}

Return ONLY the JSON, no prose.
`;
  }

  private toProfile(raw: string, parsed: StyleArchitectLlmResponse | null): ArtStyleProfile {
    if (!parsed || typeof parsed !== 'object') {
      return buildVerbatimProfile(raw);
    }
    const asString = (v: unknown): string | undefined =>
      typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
    const asStringArray = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
        : [];

    const verbatim = buildVerbatimProfile(raw);
    return {
      name: asString(parsed.name) || verbatim.name,
      family: 'unknown',
      renderingTechnique: asString(parsed.renderingTechnique) || verbatim.renderingTechnique,
      colorPhilosophy: asString(parsed.colorPhilosophy) || verbatim.colorPhilosophy,
      lightingApproach: asString(parsed.lightingApproach) || verbatim.lightingApproach,
      lineWeight: asString(parsed.lineWeight) || verbatim.lineWeight,
      compositionStyle: asString(parsed.compositionStyle) || verbatim.compositionStyle,
      moodRange: asString(parsed.moodRange) || verbatim.moodRange,
      acceptableDeviations: [],
      genreNegatives: asStringArray(parsed.genreNegatives),
      positiveVocabulary:
        asStringArray(parsed.positiveVocabulary).length > 0
          ? asStringArray(parsed.positiveVocabulary)
          : verbatim.positiveVocabulary,
      inappropriateVocabulary: asStringArray(parsed.inappropriateVocabulary),
      anchorWeight: verbatim.anchorWeight,
    };
  }
}
