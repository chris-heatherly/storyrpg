import type { Beat, Choice, Episode, Scene, Story } from '../../types';
import { isPlanningRegisterText } from '../constants/planningRegisterText';
import { READER_PROSE_LEAK_PATTERNS, STRUCTURAL_SCAFFOLDING_PATTERNS } from '../constants/metaProse';
import { collectEncounterMetaTexts, collectReaderFacingTexts } from './EncounterAnchorContentValidator';

export type RouteContinuityIssueType =
  | 'route_chronology_violation'
  | 'choice_bridge_sibling_leak'
  | 'route_duplicate_event'
  | 'unsafe_fallback_prose'
  | 'role_fidelity_violation';

export interface RouteContinuityIssue {
  type: RouteContinuityIssueType;
  severity: 'error' | 'warning';
  message: string;
  episodeId?: string;
  episodeNumber?: number;
  sceneId?: string;
  beatId?: string;
  validator: 'RouteContinuityValidator';
  suggestion?: string;
}

export interface RouteContinuityResult {
  issues: RouteContinuityIssue[];
}

type RouteCue =
  | 'arrival'
  | 'valcescuDoor'
  | 'bookshopQuartz'
  | 'rooftopMeet'
  | 'parkAttack'
  | 'walkHome'
  | 'lateNightWriting'
  | 'blogAftermath';

interface CueHit {
  cue: RouteCue;
  order: number;
  scene: Scene;
  sceneIndex: number;
}

interface TextField {
  path: string;
  text: string;
  sceneId?: string;
  beatId?: string;
}

const TERMINAL_SCENE_TARGETS = new Set([
  'episode-end', 'story-end', 'season-end', 'end', 'the-end', 'ending',
]);

const ROUTE_CUE_ORDER: Record<RouteCue, number> = {
  arrival: 10,
  valcescuDoor: 20,
  bookshopQuartz: 30,
  rooftopMeet: 40,
  parkAttack: 50,
  walkHome: 60,
  lateNightWriting: 70,
  blogAftermath: 80,
};

const DUPLICATE_SENSITIVE_CUES = new Set<RouteCue>([
  'valcescuDoor',
  'bookshopQuartz',
  'rooftopMeet',
  'parkAttack',
  'walkHome',
  'blogAftermath',
]);

const ROUTE_CUE_PATTERNS: Record<RouteCue, RegExp[]> = {
  arrival: [
    /\b(?:bucharest|romania|airport|arriv(?:e|al|ing)|grandmother['’]s apartment|suitcase|face\s*time|facetime|sadie)\b/i,
  ],
  valcescuDoor: [
    /\b(?:v[âa]lcescu|valcescu|side entrance|key\s*card|club door|club threshold|mika)\b/i,
    /\b(?:club|door|entrance)\b[^.!?\n]{0,120}\b(?:key\s*card|mika|v[âa]lcescu|valcescu)\b/i,
  ],
  bookshopQuartz: [
    /\b(?:bookshop|stela|quartz|crystal|star chart|astrology)\b/i,
  ],
  rooftopMeet: [
    /\b(?:rooftop|roof\b|club roof|roofline)\b/i,
    /\bvictor\b[^.!?\n]{0,160}\b(?:rooftop|roof)\b/i,
  ],
  parkAttack: [
    /\b(?:ci[sș]migiu|cismigiu|park|attacker|attack|aggressor|shadow|knife|rescues?|rescue|lunges?|chases?)\b/i,
  ],
  walkHome: [
    /\bvictor\b[^.!?\n]{0,180}\b(?:walks?|guides?|escorts?)\b[^.!?\n]{0,80}\bhome\b/i,
    /\b(?:small of your back|guiding you away|cobblestones are slick|under your heels)\b/i,
  ],
  lateNightWriting: [
    /\b(?:4\s*a\.?m\.?|four\s*a\.?m\.?|laptop|draft|post\s+the\s+blog|write\s+the\s+blog|writing)\b/i,
  ],
  blogAftermath: [
    /\b(?:viral|80,?000|eighty thousand|reads|views|comments|6\s*p\.?m\.?|six\s*p\.?m\.?)\b/i,
  ],
};

const RECAP_MARKERS = /\b(?:after|aftermath|earlier|remember|recap|blog|post|comments|viral|told|story about)\b/i;

const UNSAFE_ROUTE_FALLBACK_PATTERNS: Array<{ label: string; pattern: RegExp; suggestion: string }> = [
  {
    label: 'composed-surface fallback',
    pattern: /\bcomposed\s+surface\s+slips\b/i,
    suggestion: 'Replace generic interior-state fallback prose with a concrete cold-open action, line of dialogue, or sensory image.',
  },
  {
    label: 'small-evasive-movement fallback',
    pattern: /\bsmall\s+evasive\s+movement\b/i,
    suggestion: 'Name the actual action, prop, or physical dodge instead of a fallback body-language abstraction.',
  },
  {
    label: 'attention-lock fallback',
    pattern: /\bhands\s+and\s+attention\s+lock\s+onto\b/i,
    suggestion: 'Rewrite the beat as specific action and perception; avoid generic attention mechanics.',
  },
  {
    label: 'posture-glance-distance fallback',
    pattern: /\bposture,\s*glance,\s*and\s*distance\b/i,
    suggestion: 'Replace the fallback list with one precise staged gesture or blocking change.',
  },
  {
    label: 'visible-gesture-object-cue fallback',
    pattern: /\bvisible\s+gesture,\s*object\s+cue,\s*or\s+shift\s+in\s+distance\b/i,
    suggestion: 'Author the actual gesture, object, or distance shift instead of naming the category.',
  },
  {
    label: 'character-reacts fallback',
    pattern: /\bcharacter\s+reacts\s+through\s+a\s+visible\s+gesture\b/i,
    suggestion: 'Replace generic reaction scaffolding with character-specific behavior.',
  },
  {
    label: 'subtext-visible fallback',
    pattern: /\bmaking\s+the\s+subtext\s+visible\b/i,
    suggestion: 'Show the subtext through concrete action or dialogue; do not narrate the craft instruction.',
  },
  {
    label: 'balance-change fallback',
    pattern: /\bvisibly\s+changing\s+the\s+balance\b/i,
    suggestion: 'Name who gains or loses leverage and what physical evidence shows it.',
  },
  {
    label: 'busy-hands fallback',
    pattern: /\bbusy\s+hands\s+betray\b/i,
    suggestion: 'Use a specific hand action tied to the scene object, not a stock body-language phrase.',
  },
];

function isTerminalSceneTarget(id: string | undefined): boolean {
  return !!id && TERMINAL_SCENE_TARGETS.has(id.trim().toLowerCase());
}

function normalizeText(value: string | undefined): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function pushText(fields: TextField[], path: string, text: unknown, sceneId?: string, beatId?: string): void {
  if (typeof text !== 'string') return;
  const trimmed = text.trim();
  if (trimmed.length === 0) return;
  fields.push({ path, text: trimmed, sceneId, beatId });
}

function collectStrings(value: unknown, fields: TextField[], path: string, sceneId?: string, beatId?: string, depth = 0): void {
  if (depth > 4 || value == null) return;
  if (typeof value === 'string') {
    pushText(fields, path, value, sceneId, beatId);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectStrings(entry, fields, `${path}[${index}]`, sceneId, beatId, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectStrings(child, fields, `${path}.${key}`, sceneId, beatId, depth + 1);
  }
}

function collectRouteTextFields(scene: Scene): TextField[] {
  const fields: TextField[] = [];
  collectReaderFacingTexts(scene).forEach((text, index) => pushText(fields, `scene:${scene.id}.readerFacing[${index}]`, text, scene.id));
  collectEncounterMetaTexts(scene).forEach((text, index) => pushText(fields, `scene:${scene.id}.encounterMeta[${index}]`, text, scene.id));

  for (const beat of scene.beats || []) {
    pushText(fields, `scene:${scene.id}.beat:${beat.id}.text`, beat.text, scene.id, beat.id);
    pushText(fields, `scene:${scene.id}.beat:${beat.id}.visualMoment`, beat.visualMoment, scene.id, beat.id);
    pushText(fields, `scene:${scene.id}.beat:${beat.id}.primaryAction`, beat.primaryAction, scene.id, beat.id);
    pushText(fields, `scene:${scene.id}.beat:${beat.id}.emotionalRead`, beat.emotionalRead, scene.id, beat.id);
    pushText(fields, `scene:${scene.id}.beat:${beat.id}.relationshipDynamic`, beat.relationshipDynamic, scene.id, beat.id);
    pushText(fields, `scene:${scene.id}.beat:${beat.id}.mustShowDetail`, beat.mustShowDetail, scene.id, beat.id);
    collectStrings(beat.textVariants, fields, `scene:${scene.id}.beat:${beat.id}.textVariants`, scene.id, beat.id);
    collectStrings(beat.dramaticIntent, fields, `scene:${scene.id}.beat:${beat.id}.dramaticIntent`, scene.id, beat.id);
    collectStrings(beat.coveragePlan, fields, `scene:${scene.id}.beat:${beat.id}.coveragePlan`, scene.id, beat.id);
    for (const choice of beat.choices || []) {
      pushText(fields, `scene:${scene.id}.beat:${beat.id}.choice:${choice.id}.text`, choice.text, scene.id, beat.id);
      pushText(fields, `scene:${scene.id}.beat:${beat.id}.choice:${choice.id}.lockedText`, choice.lockedText, scene.id, beat.id);
      pushText(fields, `scene:${scene.id}.beat:${beat.id}.choice:${choice.id}.reactionText`, choice.reactionText, scene.id, beat.id);
      collectStrings(choice.outcomeTexts, fields, `scene:${scene.id}.beat:${beat.id}.choice:${choice.id}.outcomeTexts`, scene.id, beat.id);
    }
  }

  return fields;
}

function collectObligationTexts(scene: Scene): string[] {
  const fields: TextField[] = [];
  const keys = [
    'authoredTreatmentFields',
    'storyCircleBeatContracts',
    'arcPressureContracts',
    'branchConsequenceContracts',
    'endingRealizationContracts',
    'characterTreatmentContracts',
    'worldTreatmentContracts',
    'seasonPromiseContracts',
    'stakesArchitectureContracts',
    'turnContract',
  ] as const;
  for (const key of keys) {
    collectStrings(scene[key], fields, `scene:${scene.id}.${key}`, scene.id);
  }
  return fields.map((field) => field.text);
}

function sceneCueHits(scene: Scene, sceneIndex: number): CueHit[] {
  const routeText = [
    scene.id,
    scene.name,
    scene.timeline?.location,
    scene.timeline?.timeOfDay,
    scene.timeline?.transitionIn,
    ...collectReaderFacingTexts(scene),
    ...collectEncounterMetaTexts(scene),
  ].filter((text): text is string => typeof text === 'string' && text.trim().length > 0).join('\n');

  const hits: CueHit[] = [];
  for (const cue of Object.keys(ROUTE_CUE_PATTERNS) as RouteCue[]) {
    if (ROUTE_CUE_PATTERNS[cue].some((pattern) => pattern.test(routeText))) {
      hits.push({ cue, order: ROUTE_CUE_ORDER[cue], scene, sceneIndex });
    }
  }
  return hits.sort((a, b) => a.order - b.order);
}

function isRecapOnlyCue(scene: Scene, cue: RouteCue): boolean {
  if (cue === 'blogAftermath') return false;
  const text = [
    scene.name,
    ...collectReaderFacingTexts(scene),
    ...collectEncounterMetaTexts(scene),
  ].join(' ');
  return RECAP_MARKERS.test(text) && ROUTE_CUE_PATTERNS.blogAftermath.some((pattern) => pattern.test(text));
}

function extractRequiredRescuer(obligationText: string): string | undefined {
  const patterns = [
    /\b([A-Z][A-Za-zÀ-ž'’.-]{2,}(?:\s+[A-Z][A-Za-zÀ-ž'’.-]{2,}){0,2})\s+(?:rescues?|saves?|pulls|drags|carries)\b/,
    /\brescued\s+by\s+([A-Z][A-Za-zÀ-ž'’.-]{2,}(?:\s+[A-Z][A-Za-zÀ-ž'’.-]{2,}){0,2})\b/i,
  ];
  for (const pattern of patterns) {
    const match = obligationText.match(pattern);
    const name = match?.[1]?.trim();
    if (name && !/^(you|your|she|he|they|the|a|an)$/i.test(name)) return name;
  }
  return undefined;
}

function mentionsRescue(text: string): boolean {
  return /\b(?:rescue|rescues|rescued|save|saves|saved|pulls|drags|carries|intervenes|protects)\b/i.test(text);
}

function namesNearRescue(text: string, names: string[]): string[] {
  const hits: string[] = [];
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped}\\b[^.!?\\n]{0,120}\\b(?:rescue|rescues|rescued|save|saves|saved|pulls|drags|carries|intervenes|protects)\\b|\\b(?:rescue|rescues|rescued|save|saves|saved|pulls|drags|carries|intervenes|protects)\\b[^.!?\\n]{0,120}\\b${escaped}\\b`, 'i');
    if (pattern.test(text)) hits.push(name);
  }
  return hits;
}

export class RouteContinuityValidator {
  validate(input: { story: Story }): RouteContinuityResult {
    const issues: RouteContinuityIssue[] = [];
    const npcNames = (input.story.npcs || [])
      .map((npc) => npc.name)
      .filter((name): name is string => Boolean(name?.trim()));

    for (const episode of input.story.episodes || []) {
      const sceneMap = new Map((episode.scenes || []).map((scene) => [scene.id, scene]));
      this.validateChoiceBridgeChains(episode, issues);
      this.validateSceneTextFields(episode, issues, npcNames);
      this.validateRouteChronology(episode, sceneMap, issues);
    }

    return { issues };
  }

  private validateChoiceBridgeChains(episode: Episode, issues: RouteContinuityIssue[]): void {
    for (const scene of episode.scenes || []) {
      const beatMap = new Map((scene.beats || []).map((beat) => [beat.id, beat]));
      const choiceTargets = new Map<string, string>();
      for (const beat of scene.beats || []) {
        for (const choice of beat.choices || []) {
          if (choice.nextBeatId) choiceTargets.set(choice.id, choice.nextBeatId);
        }
      }
      const targetToChoice = new Map([...choiceTargets.entries()].map(([choiceId, beatId]) => [beatId, choiceId]));

      for (const beat of scene.beats || []) {
        for (const choice of beat.choices || []) {
          if (!choice.nextBeatId) continue;
          this.traceChoiceBridge(scene, beat, choice, beatMap, targetToChoice, episode, issues);
        }
      }
    }
  }

  private traceChoiceBridge(
    scene: Scene,
    sourceBeat: Beat,
    choice: Choice,
    beatMap: Map<string, Beat>,
    targetToChoice: Map<string, string>,
    episode: Episode,
    issues: RouteContinuityIssue[],
  ): void {
    const originChoiceId = choice.routeContext?.sourceChoiceId || choice.id;
    const visited = new Set<string>();
    let currentId = choice.nextBeatId;
    let steps = 0;

    while (currentId && steps <= beatMap.size + 2) {
      steps += 1;
      if (visited.has(currentId)) return;
      visited.add(currentId);
      const current = beatMap.get(currentId);
      if (!current) return;

      const siblingChoiceId = targetToChoice.get(current.id);
      if (current.isChoiceBridge && siblingChoiceId && siblingChoiceId !== choice.id) {
        issues.push({
          type: 'choice_bridge_sibling_leak',
          severity: 'error',
          message:
            `Choice "${choice.id}" routes through sibling choice bridge "${current.id}" for choice "${siblingChoiceId}". ` +
            'Each choice payoff must resolve independently before reconverging.',
          episodeId: episode.id,
          episodeNumber: episode.number,
          sceneId: scene.id,
          beatId: sourceBeat.id,
          validator: 'RouteContinuityValidator',
          suggestion: 'Give each choice bridge its own terminal nextSceneId, or route both choices into a neutral reconvergence beat after their separate payoff beats.',
        });
        return;
      }

      const bridgeSourceId = current.routeContext?.sourceChoiceId;
      if (current.isChoiceBridge && bridgeSourceId && bridgeSourceId !== originChoiceId) {
        issues.push({
          type: 'choice_bridge_sibling_leak',
          severity: 'error',
          message:
            `Choice "${choice.id}" reaches bridge beat "${current.id}" authored for choice "${bridgeSourceId}". ` +
            'This mixes mutually exclusive choice payoffs in one reader route.',
          episodeId: episode.id,
          episodeNumber: episode.number,
          sceneId: scene.id,
          beatId: current.id,
          validator: 'RouteContinuityValidator',
          suggestion: 'Keep choice bridge beats private to their source choice until a neutral shared reconvergence beat.',
        });
        return;
      }

      if (current.isChoiceBridge && current.nextBeatId && current.nextSceneId) {
        issues.push({
          type: 'choice_bridge_sibling_leak',
          severity: 'error',
          message:
            `Choice bridge beat "${current.id}" has both nextBeatId "${current.nextBeatId}" and nextSceneId "${current.nextSceneId}". ` +
            'The reader can receive multiple payoffs or skip across route state.',
          episodeId: episode.id,
          episodeNumber: episode.number,
          sceneId: scene.id,
          beatId: current.id,
          validator: 'RouteContinuityValidator',
          suggestion: 'Choice bridges should either continue to one neutral beat or exit to one next scene, not both.',
        });
        return;
      }

      if (current.nextSceneId || isTerminalSceneTarget(current.nextSceneId)) return;
      currentId = current.nextBeatId;
    }
  }

  private validateSceneTextFields(episode: Episode, issues: RouteContinuityIssue[], npcNames: string[]): void {
    for (const scene of episode.scenes || []) {
      for (const field of collectRouteTextFields(scene)) {
        const pattern = UNSAFE_ROUTE_FALLBACK_PATTERNS.find((entry) => entry.pattern.test(field.text));
        const readerLeak = READER_PROSE_LEAK_PATTERNS.find((entry) => entry.pattern.test(field.text));
        const scaffoldLeak = STRUCTURAL_SCAFFOLDING_PATTERNS.find((entry) => entry.pattern.test(field.text));
        if (pattern || readerLeak || scaffoldLeak || isPlanningRegisterText(field.text)) {
          issues.push({
            type: 'unsafe_fallback_prose',
            severity: 'error',
            message:
              `Unsafe fallback/planning prose survived in ${field.path}: ` +
              `"${field.text.slice(0, 160)}${field.text.length > 160 ? '...' : ''}"`,
            episodeId: episode.id,
            episodeNumber: episode.number,
            sceneId: field.sceneId,
            beatId: field.beatId,
            validator: 'RouteContinuityValidator',
            suggestion: pattern?.suggestion || readerLeak?.suggestion || scaffoldLeak?.suggestion || 'Rewrite the field as concrete in-world prose or visual staging.',
          });
        }
      }

      this.validateRescueRoleFidelity(episode, scene, issues, npcNames);
    }
  }

  private validateRescueRoleFidelity(
    episode: Episode,
    scene: Scene,
    issues: RouteContinuityIssue[],
    npcNames: string[],
  ): void {
    const obligations = collectObligationTexts(scene).filter(mentionsRescue);
    if (obligations.length === 0) return;
    const requiredRescuers = [...new Set(obligations.map(extractRequiredRescuer).filter((name): name is string => Boolean(name)))];
    if (requiredRescuers.length === 0) return;

    const readerText = [
      ...collectReaderFacingTexts(scene),
      ...collectEncounterMetaTexts(scene),
    ].join('\n');
    if (!mentionsRescue(readerText)) return;

    for (const required of requiredRescuers) {
      const requiredSeen = new RegExp(`\\b${required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(readerText);
      if (requiredSeen) continue;
      const otherRescuers = namesNearRescue(readerText, npcNames.filter((name) => normalizeText(name) !== normalizeText(required)));
      issues.push({
        type: 'role_fidelity_violation',
        severity: 'error',
        message:
          `Scene "${scene.name || scene.id}" is obligated to stage ${required} as the rescuer, ` +
          `but the reader-facing rescue prose does not name ${required}` +
          (otherRescuers.length > 0 ? ` and instead implicates ${otherRescuers.join(', ')}` : '') + '.',
        episodeId: episode.id,
        episodeNumber: episode.number,
        sceneId: scene.id,
        validator: 'RouteContinuityValidator',
        suggestion: `Regenerate or repair this scene so ${required} performs the rescue on-page before any aftermath depends on it.`,
      });
    }
  }

  private validateRouteChronology(
    episode: Episode,
    sceneMap: Map<string, Scene>,
    issues: RouteContinuityIssue[],
  ): void {
    const routes = this.enumerateSceneRoutes(episode, sceneMap);
    for (const route of routes) {
      const cueHits = route.flatMap((sceneId) => {
        const scene = sceneMap.get(sceneId);
        if (!scene) return [];
        const sceneIndex = (episode.scenes || []).findIndex((candidate) => candidate.id === scene.id);
        return sceneCueHits(scene, sceneIndex).filter((hit) => !isRecapOnlyCue(scene, hit.cue));
      });

      for (let index = 1; index < cueHits.length; index += 1) {
        const previous = cueHits[index - 1];
        const current = cueHits[index];
        if (current.order >= previous.order) continue;
        issues.push({
          type: 'route_chronology_violation',
          severity: 'error',
          message:
            `Reader route ${route.join(' -> ')} stages ${current.cue} after ${previous.cue}. ` +
            'This inverts the treatment event order and creates a teleport/unstaged setup.',
          episodeId: episode.id,
          episodeNumber: episode.number,
          sceneId: current.scene.id,
          validator: 'RouteContinuityValidator',
          suggestion: 'Reorder the scene graph or rewrite the later scene as explicit recap/aftermath instead of staging the earlier event.',
        });
        break;
      }

      const firstByCue = new Map<RouteCue, CueHit>();
      for (const hit of cueHits) {
        if (!DUPLICATE_SENSITIVE_CUES.has(hit.cue)) continue;
        const first = firstByCue.get(hit.cue);
        if (!first) {
          firstByCue.set(hit.cue, hit);
          continue;
        }
        if (first.scene.id === hit.scene.id) continue;
        issues.push({
          type: 'route_duplicate_event',
          severity: 'error',
          message:
            `Reader route ${route.join(' -> ')} appears to stage ${hit.cue} in both "${first.scene.id}" and "${hit.scene.id}". ` +
            'A route should dramatize the primary event once, then carry aftermath or residue forward.',
          episodeId: episode.id,
          episodeNumber: episode.number,
          sceneId: hit.scene.id,
          validator: 'RouteContinuityValidator',
          suggestion: 'Merge the duplicated event, or rewrite the later scene as consequence, memory, blog fallout, or a distinct escalation.',
        });
        break;
      }
    }
  }

  private enumerateSceneRoutes(episode: Episode, sceneMap: Map<string, Scene>): string[][] {
    const start = episode.startingSceneId;
    if (!start || !sceneMap.has(start)) return [];
    const routes: string[][] = [];
    const maxDepth = Math.max((episode.scenes || []).length + 3, 8);
    const queue: Array<{ sceneId: string; path: string[] }> = [{ sceneId: start, path: [] }];

    while (queue.length > 0 && routes.length < 64) {
      const { sceneId, path } = queue.shift()!;
      if (path.includes(sceneId)) {
        routes.push([...path, sceneId]);
        continue;
      }
      const nextPath = [...path, sceneId];
      if (nextPath.length > maxDepth) {
        routes.push(nextPath);
        continue;
      }
      const scene = sceneMap.get(sceneId);
      if (!scene) {
        routes.push(nextPath);
        continue;
      }
      const targets = this.resolveSceneTargets(scene, sceneMap);
      if (targets.length === 0) {
        routes.push(nextPath);
        continue;
      }
      for (const target of targets.slice(0, 6)) {
        queue.push({ sceneId: target, path: nextPath });
      }
    }

    return routes;
  }

  private resolveSceneTargets(scene: Scene, sceneMap: Map<string, Scene>): string[] {
    const targets = new Set<string>();
    const add = (target: string | undefined): void => {
      if (!target || isTerminalSceneTarget(target) || !sceneMap.has(target)) return;
      targets.add(target);
    };
    const beatMap = new Map((scene.beats || []).map((beat) => [beat.id, beat]));

    for (const beat of scene.beats || []) {
      add(beat.nextSceneId);
      for (const choice of beat.choices || []) {
        add(choice.nextSceneId);
        for (const target of this.resolveBeatChainSceneTargets(choice.nextBeatId, beatMap)) add(target);
      }
    }

    for (const outcome of Object.values(scene.encounter?.outcomes || {})) {
      add(outcome?.nextSceneId);
    }

    if (targets.size === 0) {
      for (const target of scene.leadsTo || []) add(target);
    }

    return [...targets];
  }

  private resolveBeatChainSceneTargets(startBeatId: string | undefined, beatMap: Map<string, Beat>): string[] {
    const targets = new Set<string>();
    const visited = new Set<string>();
    let currentId = startBeatId;
    let steps = 0;
    while (currentId && steps <= beatMap.size + 2) {
      steps += 1;
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const beat = beatMap.get(currentId);
      if (!beat) break;
      if (beat.nextSceneId && !isTerminalSceneTarget(beat.nextSceneId)) targets.add(beat.nextSceneId);
      if (beat.choices?.length) {
        for (const choice of beat.choices) {
          if (choice.nextSceneId && !isTerminalSceneTarget(choice.nextSceneId)) targets.add(choice.nextSceneId);
        }
      }
      currentId = beat.nextBeatId;
    }
    return [...targets];
  }
}
