import type { FullCreativeBrief } from '../pipeline/FullStoryPipeline';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import type { SeasonPlan } from '../../types/seasonPlan';
import { PipelineError } from '../pipeline/errors';
import {
  CANONICAL_IDENTITY_SCHEMA_VERSION,
  canonicalPersonNamesEqual,
  isPlaceholderPersonName,
  normalizeCanonicalPersonName,
  normalizeCanonicalPronouns,
} from '../utils/canonicalIdentity';

export type GenerationIdentitySource =
  | 'user_override'
  | 'season_plan'
  | 'source_analysis'
  | 'draft_brief'
  | 'missing';

export interface GenerationIdentityResolution {
  version: typeof CANONICAL_IDENTITY_SCHEMA_VERSION;
  action: 'unchanged' | 'normalized' | 'missing';
  canonicalSource: GenerationIdentitySource;
  reasonCodes: string[];
  originalName?: string;
  canonicalName?: string;
}

export interface CompileGenerationBriefInput {
  draftBrief: FullCreativeBrief;
  sourceAnalysis?: SourceMaterialAnalysis | null;
  seasonPlan?: SeasonPlan | null;
  protagonistOverride?: Partial<FullCreativeBrief['protagonist']> | null;
}

export function selectGenerationIdentityResolution(
  incoming: GenerationIdentityResolution | undefined,
  compiled: GenerationIdentityResolution,
): GenerationIdentityResolution {
  return incoming && incoming.action !== 'unchanged' ? incoming : compiled;
}

type IdentityCandidate = Partial<FullCreativeBrief['protagonist']> & {
  source: GenerationIdentitySource;
};

function cloneBrief(brief: FullCreativeBrief): FullCreativeBrief {
  return JSON.parse(JSON.stringify(brief)) as FullCreativeBrief;
}

function candidate(
  source: GenerationIdentitySource,
  value?: Partial<FullCreativeBrief['protagonist']> | null,
): IdentityCandidate | undefined {
  if (!value) return undefined;
  const name = normalizeCanonicalPersonName(value.name);
  if (!name) return undefined;
  return {
    id: value.id,
    name,
    pronouns: normalizeCanonicalPronouns(value.pronouns),
    description: value.description,
    role: value.role,
    fashionStyle: value.fashionStyle,
    source,
  };
}

function identityConflict(left: IdentityCandidate, right: IdentityCandidate): never {
  throw new PipelineError(
    `[GenerationIdentityCompiler] Explicit protagonist "${left.name}" from ${left.source} conflicts with "${right.name}" from ${right.source}.`,
    'generation_preflight',
    {
      context: {
        identitySchemaVersion: CANONICAL_IDENTITY_SCHEMA_VERSION,
        left: { source: left.source, id: left.id, name: left.name },
        right: { source: right.source, id: right.id, name: right.name },
      },
      failure: {
        code: 'generation_preflight_invalid',
        ownerStage: 'source_analysis',
        retryClass: 'none',
        issueCodes: ['generation_protagonist_identity_mismatch'],
        repairTarget: 'canonical-generation-brief',
      },
    },
  );
}

function assertCompatible(left?: IdentityCandidate, right?: IdentityCandidate): void {
  if (!left || !right || canonicalPersonNamesEqual(left.name, right.name)) return;
  identityConflict(left, right);
}

/**
 * Compile the identity-bearing part of a generation brief from canonical inputs.
 * Missing and known legacy placeholders are repaired; real name-vs-name conflicts
 * fail before a provider call. All non-identity brief fields remain untouched.
 */
export function compileGenerationBrief(input: CompileGenerationBriefInput): {
  brief: FullCreativeBrief;
  identityResolution: GenerationIdentityResolution;
} {
  const brief = cloneBrief(input.draftBrief);
  if (input.seasonPlan) brief.seasonPlan = input.seasonPlan;

  const draftRawName = brief.protagonist?.name?.trim();
  const draft = candidate('draft_brief', brief.protagonist);
  const analysis = candidate('source_analysis', input.sourceAnalysis?.protagonist);
  const plan = candidate('season_plan', input.seasonPlan?.protagonist);
  const override = candidate('user_override', input.protagonistOverride);

  assertCompatible(analysis, plan);
  const locked = plan || analysis;
  assertCompatible(locked, override);

  const canonical = override || locked || draft;
  if (canonical && locked && draft) assertCompatible(draft, locked);

  if (!canonical) {
    brief.protagonist = {
      ...brief.protagonist,
      name: '',
      pronouns: 'they/them',
    };
    return {
      brief,
      identityResolution: {
        version: CANONICAL_IDENTITY_SCHEMA_VERSION,
        action: 'missing',
        canonicalSource: 'missing',
        reasonCodes: draftRawName && isPlaceholderPersonName(draftRawName)
          ? ['legacy_placeholder_removed']
          : ['identity_not_supplied'],
        originalName: draftRawName || undefined,
      },
    };
  }

  const canonicalPronouns = normalizeCanonicalPronouns(
    override?.pronouns || (canonicalPersonNamesEqual(plan?.name, analysis?.name) ? analysis?.pronouns : undefined)
      || canonical.pronouns || (draft ? brief.protagonist?.pronouns : undefined),
  ) || 'they/them';
  const reasonCodes: string[] = [];
  if (!draft) {
    reasonCodes.push(draftRawName && isPlaceholderPersonName(draftRawName)
      ? 'legacy_placeholder_replaced'
      : 'missing_identity_filled');
  }
  if (brief.protagonist?.id !== canonical.id && canonical.id) reasonCodes.push('canonical_id_reconciled');
  if (brief.protagonist?.name !== canonical.name) reasonCodes.push('canonical_name_reconciled');
  if (brief.protagonist?.pronouns !== canonicalPronouns) reasonCodes.push('canonical_pronouns_reconciled');

  brief.protagonist = {
    ...brief.protagonist,
    ...canonical,
    id: canonical.id || brief.protagonist?.id || 'protagonist',
    name: canonical.name || '',
    pronouns: canonicalPronouns,
    description: canonical.description || brief.protagonist?.description || '',
    role: brief.protagonist?.role || 'protagonist',
  } as FullCreativeBrief['protagonist'];
  delete (brief.protagonist as FullCreativeBrief['protagonist'] & { source?: string }).source;

  return {
    brief,
    identityResolution: {
      version: CANONICAL_IDENTITY_SCHEMA_VERSION,
      action: reasonCodes.length > 0 ? 'normalized' : 'unchanged',
      canonicalSource: canonical.source,
      reasonCodes,
      originalName: draftRawName || undefined,
      canonicalName: canonical.name,
    },
  };
}
