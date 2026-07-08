import type { SceneContent } from '../agents/SceneWriter';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { Story } from '../../types/story';
import type { FailureModeAuditContract } from '../../types/scenePlan';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';
import { treatmentFieldCloseMatch } from '../utils/treatmentFieldContracts';
import { failureModeAuditMatchThreshold } from '../utils/failureModeAuditContracts';
import { detectBeatTenseDrift } from '../utils/proseTense';

export type NarrativeFailureModeCode =
  | 'escalation_trap'
  | 'mystery_box_collapse'
  | 'character_drift'
  | 'shaggy_dog'
  | 'passive_protagonist'
  | 'reset_disease'
  | 'theme_drift'
  | 'unmotivated_escalation'
  | 'snowglobe_arc'
  | 'inverted_thematic_rhyme'
  | 'convenient_coincidence'
  | 'telegraphed_twist'
  | 'cheating_twist'
  | 'repetitive_toast_motif'
  | 'tense_drift';

export interface NarrativeFailureModeIssue extends ValidationIssue {
  code: NarrativeFailureModeCode;
  source?: string;
}

export interface NarrativeFailureModeInput {
  sceneContents?: SceneContent[];
  baseIssues?: Array<Pick<ValidationIssue, 'severity' | 'message' | 'location' | 'suggestion'> & { source?: string }>;
  failureModeAuditContracts?: FailureModeAuditContract[];
  seasonPlan?: SeasonPlan;
  story?: Story;
}

export interface NarrativeFailureModeMetrics {
  mappedIssueCount: number;
  convenientCoincidenceSignals: number;
  telegraphedTwistSignals: number;
  repetitiveMotifSignals: number;
  tenseDriftSignals: number;
  authoredContractIssues: number;
}

export interface NarrativeFailureModeResult extends ValidationResult {
  issues: NarrativeFailureModeIssue[];
  metrics: NarrativeFailureModeMetrics;
}

interface FailureModeMapping {
  code: NarrativeFailureModeCode;
  matches: RegExp[];
  suggestion: string;
}

const FAILURE_MODE_MAPPINGS: FailureModeMapping[] = [
  {
    code: 'escalation_trap',
    matches: [/\bescalat(?:e|ion|ed|ing)\b/i, /\bstakes? ladder\b/i, /\bstakes? (?:jump|leap|raise)/i],
    suggestion: 'Slow the rise in threat until the scene has earned audience investment, personal cost, and causal pressure.',
  },
  {
    code: 'mystery_box_collapse',
    matches: [/\bmystery\b/i, /\bbox-question\b/i, /\bbox question\b/i, /\bopens? \d+ question/i, /\bunanswered question/i],
    suggestion: 'Plan the answer before introducing the question, and convert excess mysteries into suspense or dramatic irony.',
  },
  {
    code: 'character_drift',
    matches: [/\bcharacter drift\b/i, /\bestablished psychology\b/i, /\bidentity delta\b/i, /\bcharacter arc\b/i, /\bLie\b.*\bTruth\b/i],
    suggestion: 'Tie the action back to the character Lie, wound, want, need, relationship pressure, or earned change.',
  },
  {
    code: 'shaggy_dog',
    matches: [/\bsetup\b.*\bpayoff\b/i, /\bpayoff\b.*\bsetup\b/i, /\bunpaid\b/i, /\bshaggy dog\b/i, /\bcallback\b.*\bunresolved\b/i],
    suggestion: 'Pay off major setup in proportion to its emphasis, or demote/remove the setup.',
  },
  {
    code: 'passive_protagonist',
    matches: [/\bpassive protagonist\b/i, /\bprotagonist\b.*\bpassive\b/i, /\bplayer\b.*\bcaus(?:e|al|ed)\b/i, /\b60%\b.*\bcaus/i],
    suggestion: 'Rewrite the turn so the protagonist causes the decisive change through choice, preparation, sacrifice, or leverage.',
  },
  {
    code: 'reset_disease',
    matches: [/\breset\b/i, /\bstatus quo\b/i, /\bexit shift\b/i, /\bchoice residue\b/i, /\bno residue\b/i],
    suggestion: 'Leave a permanent strategic, emotional, relational, identity, or information change behind.',
  },
  {
    code: 'theme_drift',
    matches: [/\btheme\b/i, /\bcentral question\b/i, /\btheme question\b/i, /\bpress(?:es|ing)? on\b/i],
    suggestion: 'Make the scene answer, complicate, refuse, or reframe the theme question through protagonist-visible choice.',
  },
  {
    code: 'unmotivated_escalation',
    matches: [/\bunmotivated escalation\b/i, /\bescalation\b.*\bchoice\b/i, /\bstakes\b.*\bearned\b/i],
    suggestion: 'Anchor escalation in a prior choice, consequence, antagonist pressure, discovery, cost, or relationship change.',
  },
  {
    code: 'snowglobe_arc',
    matches: [/\bsnowglobe\b/i, /\barc\b.*\brestore/i, /\bpermanent change\b/i, /\breturns? to.*beginning\b/i],
    suggestion: 'Resolve the local question while leaving the protagonist or situation materially changed.',
  },
  {
    code: 'inverted_thematic_rhyme',
    matches: [/\bB-?plot\b/i, /\bsecondary (?:plot|pressure)\b/i, /\bthematic(?:ally)? rhyme\b/i, /\bA-?plot\b.*\bB-?plot\b/i],
    suggestion: 'When a secondary pressure lane exists, make it echo the same question in a different domain.',
  },
  {
    code: 'convenient_coincidence',
    matches: [/\bcoincidence\b/i, /\bdeus ex\b/i, /\bexternal rescue\b/i, /\brescued by\b/i, /\boutside force\b/i],
    suggestion: 'Move the solution into protagonist/player action instead of rescue, luck, prophecy, or villain-only action.',
  },
  {
    code: 'telegraphed_twist',
    matches: [/\btelegraph(?:ed|ing)?\b/i, /\bover-foreshadow/i, /\bpredictable twist\b/i, /\btoo obvious\b/i],
    suggestion: 'Reduce repeated clue language and add a plausible alternate interpretation for the same setup.',
  },
  {
    code: 'cheating_twist',
    matches: [/\bcheating twist\b/i, /\bno setup\b/i, /\bunplanted\b/i, /\bforeshadow\b.*\bmissing\b/i],
    suggestion: 'Plant the reveal earlier with at least one fair setup beat that reads differently after the reveal.',
  },
];

const EXTERNAL_RESCUE = /\b(?:guards?|police|soldiers?|authorit(?:y|ies)|mentor|ally|stranger|backup|reinforcements|the cavalry)\s+(?:arrive|arrives|appears?|intervenes?|saves?|solve|solves|rescue|rescues)\b|\b(?:arrive|arrives|appears?)\s+(?:just in time|out of nowhere)\b|\b(?:deus ex|coincidence|coincidentally|by chance|luckily|fortune|randomly|prophecy|fate|destiny|external rescue|someone else solves|villain slips)\b/i;
const PROTAGONIST_AGENCY = /\b(?:player|protagonist|hero|lead|they|she|he|we|you)\s+(?:choose|chooses|decide|decides|refuse|refuses|sacrifice|sacrifices|use|uses|reveal|reveals|leverage|leverages|risk|risks|commit|commits|confront|confronts|act|acts|prepared|earned|pay|pays|trade|trades|give|gives|break|breaks|accept|accepts)\b|\b(?:chooses?|decides?|refuses?|sacrifices?|uses?|reveals?|leverages?|risks?|commits?|confronts?|acts?|prepared|earned|trades?)\b|\bbecause (?:of|they|she|he|you|we)\b|\bthrough (?:choice|preparation|sacrifice|leverage|action)\b/i;

const TWIST_PHRASES: Array<{ label: string; pattern: RegExp }> = [
  { label: 'something is off', pattern: /\bsomething (?:is|was|feels|felt|seems|seemed) off\b/gi },
  { label: 'not what it seems', pattern: /\bnot (?:what|who) (?:it|they|he|she|this|that) seems?\b/gi },
  { label: 'hidden truth', pattern: /\bhidden truth\b/gi },
  { label: 'secret betrayal', pattern: /\bsecret betrayal\b/gi },
  { label: 'real villain', pattern: /\breal villain\b/gi },
  { label: 'traitor among us', pattern: /\btraitor (?:among|in|inside)\b/gi },
];

export class NarrativeFailureModeValidator extends BaseValidator {
  constructor() {
    super('NarrativeFailureModeValidator');
  }

  validate(input: NarrativeFailureModeInput): NarrativeFailureModeResult {
    const issues: NarrativeFailureModeIssue[] = [];
    const mapped = this.mapBaseIssues(input.baseIssues ?? []);
    issues.push(...mapped);

    const coincidenceSignals = this.detectConvenientCoincidence(input.sceneContents ?? []);
    issues.push(...coincidenceSignals);

    const telegraphSignals = this.detectTelegraphedTwist(input.sceneContents ?? []);
    issues.push(...telegraphSignals);

    const proseStyleSceneContents = input.sceneContents ?? sceneContentsFromStory(input.story);
    const repetitiveMotifSignals = this.detectRepetitiveMotif(proseStyleSceneContents);
    issues.push(...repetitiveMotifSignals);

    const tenseDriftSignals = this.detectTenseDrift(proseStyleSceneContents);
    issues.push(...tenseDriftSignals);

    const contractIssues = this.validateAuthoredContracts(input);
    issues.push(...contractIssues);

    const errorCount = issues.filter((issue) => issue.severity === 'error').length;
    const warningCount = issues.filter((issue) => issue.severity === 'warning').length;

    return {
      valid: errorCount === 0,
      score: Math.max(0, 100 - errorCount * 15 - warningCount * 5),
      issues,
      suggestions: Array.from(new Set(issues.map((issue) => issue.suggestion).filter((s): s is string => Boolean(s)))),
      metrics: {
        mappedIssueCount: mapped.length,
        convenientCoincidenceSignals: coincidenceSignals.length,
        telegraphedTwistSignals: telegraphSignals.length,
        repetitiveMotifSignals: repetitiveMotifSignals.length,
        tenseDriftSignals: tenseDriftSignals.length,
        authoredContractIssues: contractIssues.length,
      },
    };
  }

  private mapBaseIssues(
    baseIssues: Array<Pick<ValidationIssue, 'severity' | 'message' | 'location' | 'suggestion'> & { source?: string }>,
  ): NarrativeFailureModeIssue[] {
    const mapped: NarrativeFailureModeIssue[] = [];
    const seen = new Set<string>();

    for (const issue of baseIssues) {
      const message = issue.message ?? '';
      const mapping = FAILURE_MODE_MAPPINGS.find((candidate) => (
        candidate.matches.some((pattern) => pattern.test(message))
      ));
      if (!mapping) continue;

      const key = `${mapping.code}:${issue.location ?? ''}:${message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      mapped.push({
        code: mapping.code,
        severity: issue.severity,
        message: `[${this.formatCode(mapping.code)}] ${message}`,
        location: issue.location,
        suggestion: issue.suggestion || mapping.suggestion,
        source: issue.source,
      });
    }

    return mapped;
  }

  private detectConvenientCoincidence(sceneContents: SceneContent[]): NarrativeFailureModeIssue[] {
    const endingScenes = sceneContents.slice(-2);
    const issues: NarrativeFailureModeIssue[] = [];

    for (const scene of endingScenes) {
      const text = collectSceneText(scene);
      if (!text || !EXTERNAL_RESCUE.test(text) || PROTAGONIST_AGENCY.test(text)) continue;
      issues.push({
        code: 'convenient_coincidence',
        severity: 'error',
        message: '[Convenient coincidence] The ending appears to resolve through outside rescue, luck, fate, or external arrival rather than protagonist/player action.',
        location: scene.sceneId,
        suggestion: 'Rewrite the resolution so the protagonist/player causes the decisive turn through a choice, cost, preparation, relationship leverage, or earned information.',
        source: 'scene_ending_heuristic',
      });
    }

    return issues;
  }

  private detectTelegraphedTwist(sceneContents: SceneContent[]): NarrativeFailureModeIssue[] {
    const text = sceneContents.map(collectSceneText).join('\n');
    if (!text.trim()) return [];

    for (const phrase of TWIST_PHRASES) {
      const matches = text.match(phrase.pattern) ?? [];
      if (matches.length >= 3) {
        return [{
          code: 'telegraphed_twist',
          severity: 'warning',
          message: `[Telegraphed twist] The clue phrase "${phrase.label}" appears ${matches.length} times, making the twist setup too legible.`,
          suggestion: 'Vary the setup language, reduce repeated suspicious phrasing, and make at least one clue serve a plausible non-twist interpretation.',
          source: 'twist_phrase_density',
        }];
      }
    }

    return [];
  }

  private detectRepetitiveMotif(sceneContents: SceneContent[]): NarrativeFailureModeIssue[] {
    // Group per SCENE: a toast in the club scene and another three scenes
    // later is normal craft (and some treatments make drinks a core motif —
    // bite-me's dark wine drives its endings). Only same-scene repetition is
    // choreography padding, and two-in-one-scene is a polish note, not an
    // abort: run bite-me 2026-07-02T23-54-38 hard-failed a QA-94 episode on
    // two glass beats in a rooftop-bar scene.
    const usesByScene = new Map<string, Array<{ sceneId: string; beatId?: string }>>();
    for (const scene of sceneContents) {
      for (const beat of scene.beats ?? []) {
        const text = typeof beat.text === 'string' ? beat.text : '';
        if (!text) continue;
        if (/\braises?\s+(?:her|his|their|your|a|the)?\s*glass\b/i.test(text) || /\bglasses?\s+click/i.test(text) || /\bglass\s+clicked\b/i.test(text)) {
          usesByScene.set(scene.sceneId, [...(usesByScene.get(scene.sceneId) ?? []), { sceneId: scene.sceneId, beatId: beat.id }]);
        }
      }
    }

    const issues: NarrativeFailureModeIssue[] = [];
    for (const uses of usesByScene.values()) {
      if (uses.length < 2) continue;
      issues.push({
        code: 'repetitive_toast_motif',
        severity: uses.length >= 3 ? 'error' : 'warning',
        message: `[Repetitive motif] Toast/glass choreography appears in ${uses.length} beats of scene ${uses[0].sceneId} without a clear new turn.`,
        location: uses.map((use) => use.beatId ? `${use.sceneId}.${use.beatId}` : use.sceneId).join(', '),
        suggestion: 'Keep at most one toast/glass beat per scene unless the repetition changes meaning through new pressure, revelation, or consequence.',
        source: 'prose_style_consistency',
      });
    }
    return issues;
  }

  private detectTenseDrift(sceneContents: SceneContent[]): NarrativeFailureModeIssue[] {
    // Detection lives in the shared detectBeatTenseDrift (utils/proseTense) so
    // the scene-time gate and this final-contract check can never disagree (R7).
    const issues: NarrativeFailureModeIssue[] = [];
    for (const scene of sceneContents) {
      for (const drift of detectBeatTenseDrift(scene.beats)) {
        issues.push({
          code: 'tense_drift',
          severity: 'error',
          message: `[Tense drift] Beat "${drift.beatId}" appears to narrate live action in past tense: "${excerpt(drift.text)}"`,
          location: `${scene.sceneId}.${drift.beatId}`,
          suggestion: 'Rewrite live reader-facing action in present tense. Use past tense only for explicit memories, backstory, recaps, or earlier events.',
          source: 'prose_style_consistency',
        });
      }
    }
    return issues;
  }

  private formatCode(code: NarrativeFailureModeCode): string {
    return code.split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
  }

  private validateAuthoredContracts(input: NarrativeFailureModeInput): NarrativeFailureModeIssue[] {
    const contracts = input.failureModeAuditContracts ?? input.seasonPlan?.failureModeAuditContracts ?? [];
    if (contracts.length === 0) return [];
    return contracts.flatMap((contract) => {
      if (contract.blockingLevel === 'warning') return [];
      const storyText = contractStoryText(input, contract);
      const planText = contractPlanText(input.seasonPlan, contract);
      const supportText = [storyText, planText].filter(Boolean).join(' ');
      if (treatmentFieldCloseMatch(contract.sourceText, supportText, failureModeAuditMatchThreshold(contract))) return [];
      if (contract.linkedContractIds.length > 0 && planText.trim() && !input.story) return [];
      if (failureModeContractSatisfied(contract, supportText)) return [];
      const severity: 'error' | 'warning' = contract.blockingLevel === 'treatment' ? 'error' : 'warning';
      return [{
        code: contract.code,
        severity,
        message: `[${this.formatCode(contract.code)}] Authored failure-mode audit mitigation was not realized: "${contract.sourceText}".`,
        location: contract.targetSceneIds[0] ?? `failureModeAudit:${contract.id}`,
        suggestion: suggestionForContract(contract),
        source: 'failure_mode_audit_contract',
      }];
    });
  }
}

function collectSceneText(scene: SceneContent): string {
  const candidate = scene as unknown as {
    sceneId?: string;
    sceneName?: string;
    summary?: string;
    description?: string;
    text?: string;
    beats?: Array<Record<string, unknown>>;
  };
  const parts: string[] = [
    candidate.sceneName,
    candidate.summary,
    candidate.description,
    candidate.text,
  ].filter((value): value is string => typeof value === 'string');

  for (const beat of candidate.beats ?? []) {
    parts.push(...[
      beat.text,
      beat.narration,
      beat.description,
      beat.dialogue,
      beat.content,
      beat.choicePrompt,
    ].filter((value): value is string => typeof value === 'string'));
  }

  return parts.join('\n');
}

function sceneContentsFromStory(story: Story | undefined): SceneContent[] {
  if (!story) return [];
  const contents: SceneContent[] = [];
  for (const episode of story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      contents.push({
        sceneId: scene.id,
        sceneName: scene.name,
        beats: (scene.beats ?? []).map((beat) => ({ id: beat.id, text: beat.text })),
        startingBeatId: scene.startingBeatId,
        moodProgression: [],
        charactersInvolved: [],
        keyMoments: [],
        continuityNotes: [],
      });
    }
  }
  return contents;
}

function excerpt(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function contractStoryText(input: NarrativeFailureModeInput, contract: FailureModeAuditContract): string {
  if (input.story) {
    const targetIds = new Set(contract.targetSceneIds);
    const parts: string[] = [];
    for (const episode of input.story.episodes ?? []) {
      if (contract.targetEpisodeNumbers.length > 0 && !contract.targetEpisodeNumbers.includes(episode.number)) continue;
      for (const scene of episode.scenes ?? []) {
        if (targetIds.size > 0 && !targetIds.has(scene.id)) continue;
        parts.push([
          scene.name,
          scene.sequenceIntent?.startState,
          scene.sequenceIntent?.turningPoint,
          scene.sequenceIntent?.endState,
          scene.turnContract?.centralTurn,
          scene.turnContract?.afterState,
          JSON.stringify(scene.mechanicPressure ?? []),
          JSON.stringify(scene.failureModeAuditContracts ?? []),
          ...(scene.beats ?? []).map((beat) => [
            beat.text,
            beat.visualMoment,
            beat.primaryAction,
            beat.emotionalRead,
            ...(beat.textVariants ?? []).map((variant) => variant.text),
            ...(beat.choices ?? []).map((choice) => [
              choice.text,
              choice.feedbackCue?.echoSummary,
              choice.feedbackCue?.progressSummary,
              choice.visualResidueHint,
              ...(choice.residueHints ?? []).map((hint) => hint.description),
            ].filter(Boolean).join(' ')),
          ].filter(Boolean).join(' ')),
        ].filter(Boolean).join(' '));
      }
    }
    return parts.join(' ');
  }
  const targetIds = new Set(contract.targetSceneIds);
  return (input.sceneContents ?? [])
    .filter((scene) => targetIds.size === 0 || targetIds.has(scene.sceneId))
    .map(collectSceneText)
    .join(' ');
}

function contractPlanText(plan: SeasonPlan | undefined, contract: FailureModeAuditContract): string {
  if (!plan) return '';
  const targetIds = new Set(contract.targetSceneIds);
  const targetScenes = (plan.scenePlan?.scenes ?? []).filter((scene) =>
    targetIds.has(scene.id) || (scene.failureModeAuditContracts ?? []).some((candidate) => candidate.id === contract.id)
  );
  return [
    JSON.stringify(plan.informationLedger ?? []),
    JSON.stringify(plan.consequenceChains ?? []),
    JSON.stringify(plan.choiceMoments ?? []),
    JSON.stringify(plan.arcs ?? []),
    JSON.stringify(plan.episodes?.map((episode) => [episode.cliffhangerPlan, episode.endingRoutes]) ?? []),
    JSON.stringify(plan.stakesArchitectureContracts ?? []),
    JSON.stringify(plan.arcPressureContracts ?? []),
    JSON.stringify(plan.branchConsequenceContracts ?? []),
    JSON.stringify(plan.endingRealizationContracts ?? []),
    JSON.stringify(targetScenes),
  ].join(' ');
}

function failureModeContractSatisfied(contract: FailureModeAuditContract, text: string): boolean {
  if (!text.trim()) return false;
  switch (contract.contractKind) {
    case 'agency_claim':
      return /\b(choose|chooses|decide|decides|refuse|refuses|accept|accepts|confront|confronts|publish|publishes|use|uses|prepared|because of (?:you|her|his|their)|through (?:choice|preparation|sacrifice|leverage|action|information))\b/i.test(text);
    case 'setup_payoff_claim':
    case 'reveal_fair_play_claim':
      return /\b(setup|payoff|pays off|returns?|again|earlier|clue|foreshadow|plant|seed|reveal|truth|because|recognizes?|remembers?)\b/i.test(text);
    case 'episode_state_change_claim':
    case 'arc_state_change_claim':
      return /\b(changed|now|no longer|cannot|keeps?|loses?|left with|afterward|from now on|irreversible|opens?|blocks?|carries?|residue|ends? with)\b/i.test(text);
    case 'theme_rhyme_claim':
      return /\b(voice|choice|known|owned|truth|lie|self|want|need|love|trust|freedom|refuse|belong|same question|again)\b/i.test(text);
    case 'watch_item':
    case 'mitigation':
    case 'causality_claim':
      return /\b(because|planned|prepared|watching|set up|loosened|sent|deliberate|earned|caused|warned|followed|already|before|so that|therefore)\b/i.test(text);
    default:
      return /\b(because|choice|changed|reveals?|pays?|returns?|now|after|therefore|cannot)\b/i.test(text);
  }
}

function suggestionForContract(contract: FailureModeAuditContract): string {
  switch (contract.contractKind) {
    case 'agency_claim':
      return 'Rewrite the scene/choice/ending so the protagonist causes the decisive turn through choice, preparation, sacrifice, leverage, or earned information.';
    case 'setup_payoff_claim':
    case 'reveal_fair_play_claim':
      return 'Plant or pay off the authored clue/setup on-page before the reveal or payoff; avoid unearned surprise.';
    case 'episode_state_change_claim':
    case 'arc_state_change_claim':
      return 'Leave visible durable state change: access, relationship posture, information, route pressure, changed identity, or episode/arc residue.';
    case 'watch_item':
    case 'mitigation':
    case 'causality_claim':
      return 'Stage the authored mitigation before or during the risky event so it reads as in-world causality, not coincidence or explanation.';
    default:
      return 'Stage the failure-mode audit claim as concrete fiction-first mitigation rather than metadata or commentary.';
  }
}
