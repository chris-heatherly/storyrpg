import type { Story, Scene } from '../../types/story';
import type { Choice } from '../../types/choice';
import type { SeasonScenePlan } from '../../types/scenePlan';
import type {
  NarrativeContractGraph,
  NarrativePremiseContract,
  NarrativeSeedContract,
  NarrativeStateContract,
} from '../../types/narrativeContract';
import { collectReaderFacingTexts, collectReaderFacingTextsForEncounterOutcomeTier, collectReaderFacingTerminalTextsForEncounterOutcomeTier } from './encounterTextSurfaces';
import { BaseValidator, buildFailureResult, buildSuccessResult, type ValidationIssue, type ValidationResult } from './BaseValidator';
import { isGenericScenePlannerText, isQuestionShapedTurnText } from '../utils/sceneContractBuilders';
import { validateOwnerRealizationTasks } from '../pipeline/realizationTaskGate';

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function sceneText(scene: Scene): string {
  return collectReaderFacingTexts(scene).join(' ');
}

function episodeScenes(story: Story, episodeNumber: number): Scene[] {
  return story.episodes?.find((episode) => episode.number === episodeNumber)?.scenes ?? [];
}

function containsName(text: string, name: string): boolean {
  const haystack = ` ${normalize(text)} `;
  const full = normalize(name);
  const first = full.split(' ')[0];
  return haystack.includes(` ${full} `) || (first.length >= 3 && haystack.includes(` ${first} `));
}

function nearbyForbiddenRole(text: string, name: string): boolean {
  const normalized = normalize(text);
  const full = normalize(name);
  const first = full.split(' ')[0];
  const index = normalized.indexOf(full) >= 0 ? normalized.indexOf(full) : normalized.indexOf(first);
  if (index < 0) return false;
  const window = normalized.slice(Math.max(0, index - 140), index + full.length + 140);
  return /\b(?:attack|attacked|attacker|assault|assaulted|grab|grabbed|grabs|lunges|lunged|strike|struck|pinned|threaten|threatened)\w*\b/i.test(window);
}

function evidenceHit(pattern: string, text: string): boolean {
  const needle = normalize(pattern);
  const haystack = normalize(text);
  if (!needle) return false;
  if (haystack.includes(needle)) return true;
  const words = needle.split(' ').filter((word) => word.length >= 4);
  if (words.length === 0) return false;
  const hayWords = new Set(haystack.split(' '));
  const hits = words.filter((word) => hayWords.has(word) || [...hayWords].some((candidate) => candidate.startsWith(word) || word.startsWith(candidate)));
  return hits.length / words.length >= 0.6;
}

function contractTextForScene(story: Story, episodeNumber: number, sceneId: string): string {
  const scene = episodeScenes(story, episodeNumber).find((candidate) => candidate.id === sceneId);
  return scene ? sceneText(scene) : '';
}

function relationshipSubjectTerms(
  story: Story,
  task: { evidenceScope?: { npcId?: string; groupId?: string } } | undefined,
): string[] {
  const scope = task?.evidenceScope;
  const scopedId = scope?.npcId ?? scope?.groupId;
  if (!scopedId) return [];
  const terms = new Set<string>();
  const normalizedId = normalize(scopedId);
  if (normalizedId) terms.add(normalizedId);
  const idWithoutPrefix = normalizedId.replace(/^char\s+/, '');
  if (idWithoutPrefix) terms.add(idWithoutPrefix);
  const npc = scope?.npcId
    ? story.npcs?.find((candidate) => candidate.id === scope.npcId)
    : undefined;
  if (npc?.name) terms.add(normalize(npc.name));
  return [...terms].filter((term) => term.length >= 3);
}

function relationshipLabelIsSubjectScoped(
  sentence: string,
  label: string,
  subjectTerms: string[],
): boolean {
  if (subjectTerms.length === 0) return true;
  const normalizedSentence = normalize(sentence);
  const labelIndex = normalizedSentence.indexOf(normalize(label));
  if (labelIndex < 0) return false;
  return subjectTerms.some((term) => {
    const subjectIndex = normalizedSentence.indexOf(term);
    return subjectIndex >= 0 && Math.abs(subjectIndex - labelIndex) <= 56;
  });
}

function choicesInScene(scene: Scene): Choice[] {
  const choices: Choice[] = [];
  for (const beat of scene.beats ?? []) choices.push(...((beat.choices ?? []) as Choice[]));
  for (const phase of scene.encounter?.phases ?? []) {
    for (const beat of phase.beats ?? []) choices.push(...((beat.choices ?? []) as Choice[]));
  }
  return choices;
}

function setFlagsInEpisode(story: Story, episodeNumber: number): Set<string> {
  const flags = new Set<string>();
  const noteConsequences = (consequences: Array<{ type?: string; flag?: string }> | undefined): void => {
    for (const consequence of consequences ?? []) {
      if (consequence.type === 'setFlag' && typeof consequence.flag === 'string') flags.add(consequence.flag);
    }
  };
  for (const scene of episodeScenes(story, episodeNumber)) {
    for (const choice of choicesInScene(scene)) {
      for (const consequence of choice.consequences ?? []) {
        if (consequence.type === 'setFlag' && typeof consequence.flag === 'string') flags.add(consequence.flag);
      }
      for (const delayed of choice.delayedConsequences ?? []) {
        if (delayed.consequence.type === 'setFlag' && typeof delayed.consequence.flag === 'string') flags.add(delayed.consequence.flag);
      }
    }
    const encounter = scene.encounter as (typeof scene.encounter & {
      outcomes?: Record<string, { consequences?: Array<{ type?: string; flag?: string }> }>;
      storylets?: Record<string, { consequences?: Array<{ type?: string; flag?: string }>; setsFlags?: Array<{ flag?: string }> }>;
    }) | undefined;
    for (const outcome of Object.values(encounter?.outcomes ?? {})) noteConsequences(outcome?.consequences);
    for (const storylet of Object.values(encounter?.storylets ?? {})) {
      noteConsequences(storylet?.consequences);
      for (const flag of storylet?.setsFlags ?? []) if (typeof flag.flag === 'string') flags.add(flag.flag);
    }
  }
  return flags;
}

function hasPremiseEvidence(contract: NarrativePremiseContract, text: string): boolean {
  if (contract.evidenceAtoms?.length) {
    const hits = contract.evidenceAtoms.filter((atom) =>
      atom.acceptedPatterns.some((pattern) => evidenceHit(pattern, text)),
    ).length;
    return hits >= contract.minimumEvidenceHits;
  }
  if (contract.evidencePatterns.length === 0) return Boolean(text.trim());
  const hits = contract.evidencePatterns.filter((pattern) => evidenceHit(pattern, text)).length;
  return hits >= contract.minimumEvidenceHits;
}

function stateMatches(flags: Set<string>, state: NarrativeStateContract): boolean {
  return [state.canonicalStateId, ...state.aliases].some((id) => flags.has(id));
}

export interface NarrativeContractValidatorInput {
  story: Story;
  scenePlan?: SeasonScenePlan;
  graph?: NarrativeContractGraph;
}

export class NarrativeContractValidator extends BaseValidator {
  constructor() {
    super('NarrativeContractValidator');
  }

  validate(input: NarrativeContractValidatorInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const graph = input.graph ?? input.scenePlan?.narrativeContractGraph;
    if (!graph) return buildSuccessResult(100);
    const taskByContractId = new Map((graph.realizationTasks ?? []).map((task) => [task.contractId, task]));

    // Owner-stage tasks must be rechecked after every late mutator (critic,
    // continuity, cliffhanger, and final-contract repairs). The content phase
    // gate proves the producer emitted the evidence, while this final pass
    // proves no downstream phase erased it before packaging. Premise and
    // relationship tasks keep their existing specialized diagnostics; event
    // tasks are added here to avoid duplicate findings while preserving the
    // exact repair handler and artifact target.
    for (const episode of input.story.episodes ?? []) {
      for (const scene of episode.scenes ?? []) {
        const eventTasks = (graph.realizationTasks ?? []).filter((task) =>
          task.sceneId === scene.id && task.eventId,
        );
        if (eventTasks.length === 0) continue;
        const findings = validateOwnerRealizationTasks({
          sceneId: scene.id,
          tasks: eventTasks,
          sceneContent: scene,
          encounter: scene.encounter,
          mode: 'final_regression',
        });
        for (const finding of findings) {
          const task = eventTasks.find((candidate) => candidate.id === finding.taskId);
          const issue = (finding.blocking ? this.error.bind(this) : this.warning.bind(this))(
            `Canonical owner realization drift in scene "${scene.id}": ${finding.message}`,
            `ownerRealization:ep${episode.number}:${scene.id}:${finding.taskId}`,
            'Repair the assigned owner surface without changing the event identity, route policy, or cross-episode dependency.',
          );
          issue.metadata = {
            taskId: finding.taskId,
            contractId: finding.contractId,
            eventId: task?.eventId,
            episodeNumber: episode.number,
            sceneId: scene.id,
            outcomeTier: finding.outcomeTier,
            artifactPath: finding.field,
            repairHandler: task?.repairHandler,
            missingEvidenceAtoms: finding.missingEvidenceAtoms,
            requiredEvidenceAtoms: task?.evidenceAtoms.filter((atom) => atom.required).map((atom) => atom.id),
            realizationFingerprint: finding.fingerprint,
            matchedForbiddenAtoms: finding.matchedForbiddenAtoms,
          };
          issues.push(issue);
        }
      }
    }

    for (const schedule of graph.identityScheduleContracts ?? []) {
      for (const episode of input.story.episodes ?? []) {
        if (episode.number >= schedule.firstNamedEpisode) continue;
        for (const scene of episode.scenes ?? []) {
          const text = sceneText(scene);
          if (!containsName(text, schedule.canonicalName)) continue;
          issues.push(this.error(
            `Canonical identity "${schedule.canonicalName}" appears in episode ${episode.number} before its scheduled named introduction in episode ${schedule.firstNamedEpisode}.`,
            `identitySchedule:ep${episode.number}:${scene.id}:${schedule.characterId}`,
            `Use an allowed visual plant or codename (${schedule.allowedAliases.join(', ') || 'no canonical name'}) until the scheduled reveal.`,
          ));
        }
      }
    }

    // The graph is not authoritative until its immutable owner map survives
    // blueprint normalization, assembly, and checkpoint round-trips. Compare
    // the sealed runtime projection against the EpisodeEventPlan here rather
    // than trusting scene-level prose validators to infer ownership.
    for (const episode of input.story.episodes ?? []) {
      const plan = input.scenePlan?.episodeEventPlans?.[episode.number];
      if (!plan) continue;
      const expectedByScene = new Map<string, string[]>();
      for (const assignment of plan.assignments) {
        expectedByScene.set(assignment.sceneId, [
          ...(expectedByScene.get(assignment.sceneId) ?? []),
          assignment.eventId,
        ]);
      }
      const expectedEvents = new Set(plan.assignments.map((assignment) => assignment.eventId));
      const actualEvents = new Set<string>();
      for (const scene of episode.scenes ?? []) {
        const expected = [...(expectedByScene.get(scene.id) ?? [])].sort();
        const actual = (scene.sceneEventOwnership?.ownedEvents ?? [])
          .map((event) => event.eventContractId ?? event.key)
          .filter(Boolean)
          .sort();
        actual.forEach((eventId) => actualEvents.add(eventId));
        if (expected.join('|') !== actual.join('|')) {
          issues.push(this.error(
            `Runtime ownership for scene "${scene.id}" diverges from the immutable EpisodeEventPlan. Expected [${expected.join(', ')}], received [${actual.join(', ')}].`,
            `runtimeOwnership:ep${episode.number}:${scene.id}`,
            'Restore the canonical event projection after blueprint parsing and before final packaging.',
          ));
        }
      }
      for (const eventId of expectedEvents) {
        if (!actualEvents.has(eventId)) {
          issues.push(this.error(
            `Depiction event "${eventId}" has no owner in the sealed runtime episode ${episode.number}.`,
            `runtimeEventMissing:ep${episode.number}:${eventId}`,
            'Do not advance the realization ledger or package the episode until the event has one runtime owner.',
          ));
        }
      }
      const expectedSceneOrder = plan.sceneOrder;
      const actualSceneOrder = (episode.scenes ?? []).map((scene) => scene.id);
      if (expectedSceneOrder.join('|') !== actualSceneOrder.join('|')) {
        issues.push(this.error(
          `Runtime scene order for episode ${episode.number} diverges from the immutable EpisodeEventPlan. Expected [${expectedSceneOrder.join(', ')}], received [${actualSceneOrder.join(', ')}].`,
          `runtimeTopology:ep${episode.number}`,
          'Reject the runtime projection and recompile the episode from the sealed scene plan before packaging.',
        ));
      }
    }

    for (const constraint of graph.characterRoleConstraints ?? []) {
      for (const scene of episodeScenes(input.story, constraint.episodeNumber)) {
        const text = sceneText(scene);
        if (!containsName(text, constraint.characterName)) continue;
        if (!constraint.forbiddenFunctions.includes('attacker')) continue;
        if (nearbyForbiddenRole(text, constraint.characterName)) {
          issues.push(this.error(
            `Character "${constraint.characterName}" performs a forbidden early role in episode ${constraint.episodeNumber}; the treatment schedule allows a plant or romantic-pressure presence, not an attack.`,
            `characterRole:ep${constraint.episodeNumber}:${scene.id}:${constraint.characterId}`,
            `Preserve the character's scheduled function and move the attack to an authored antagonist or anonymous threat.`,
          ));
        }
      }
    }

    for (const premise of graph.premiseContracts ?? []) {
      const targetScenes = premise.targetSceneIds.length > 0
        ? premise.targetSceneIds.map((sceneId) => contractTextForScene(input.story, premise.episodeNumber, sceneId)).filter(Boolean)
        : episodeScenes(input.story, premise.episodeNumber).map(sceneText);
      const text = targetScenes.join(' ');
      if (hasPremiseEvidence(premise, text)) continue;
      issues.push(premise.blocking
        ? this.error(
          `Premise contract "${premise.fieldName}" was not realized in its opening surface: "${premise.sourceText}".`,
          `premise:ep${premise.episodeNumber}:${premise.targetSceneIds[0] ?? 'episode'}:${premise.id}`,
            'Rewrite the assigned opening scene so the authored identity, role, origin pressure, or wound is concrete on-page; do not leave it in metadata.',
          )
        : this.warning(
          `Premise contract "${premise.fieldName}" has no concrete reader-facing evidence in episode ${premise.episodeNumber}: "${premise.sourceText}".`,
          `premise:ep${premise.episodeNumber}:${premise.targetSceneIds[0] ?? 'episode'}:${premise.id}`,
          'Add a specific behavioral, occupational, relational, or wound detail without exposing planning language.',
        ));
      const issue = issues[issues.length - 1];
      const task = taskByContractId.get(premise.id);
      if (issue) {
        const text = targetScenes.join(' ');
        const missingEvidenceAtoms = (task?.evidenceAtoms ?? [])
          .filter((atom) => atom.required && !atom.acceptedPatterns.some((pattern) => evidenceHit(pattern, text)))
          .map((atom) => atom.id);
        issue.metadata = {
          taskId: task?.id,
          contractId: premise.id,
          episodeNumber: premise.episodeNumber,
          sceneId: premise.targetSceneIds[0],
          artifactPath: task?.artifactPath,
          repairHandler: task?.repairHandler,
          missingEvidenceAtoms,
          requiredEvidenceAtoms: task?.evidenceAtoms.filter((atom) => atom.required).map((atom) => atom.id),
        };
      }
    }

    const generatedEpisodes = new Set((input.story.episodes ?? []).map((episode) => episode.number));
    for (const state of graph.stateContracts ?? []) {
      if (!generatedEpisodes.has(state.sourceEpisodeNumber)) continue;
      if (stateMatches(setFlagsInEpisode(input.story, state.sourceEpisodeNumber), state)) continue;
      issues.push(this.error(
        `Canonical state "${state.canonicalStateId}" is declared for episode ${state.sourceEpisodeNumber} but no authored choice or encounter outcome sets it.`,
        `state:ep${state.sourceEpisodeNumber}:episode:${state.id}`,
        'Use the canonical state id from the NarrativeContractGraph; do not replace it with an unregistered alias.',
      ));
    }

    for (const seed of graph.seedContracts ?? []) {
      const targetEpisode = seed.targetEpisodeNumbers.find((episodeNumber) => generatedEpisodes.has(episodeNumber));
      if (targetEpisode == null) continue;
      const targetText = seed.targetSceneIds.length > 0
        ? seed.targetSceneIds.map((sceneId) => contractTextForScene(input.story, targetEpisode, sceneId)).join(' ')
        : episodeScenes(input.story, targetEpisode).map(sceneText).join(' ');
      if (seed.requiredEvidence.length === 0 || seed.requiredEvidence.some((pattern) => evidenceHit(pattern, targetText))) continue;
      issues.push(seed.blocking
        ? this.error(
          `Downstream seed "${seed.id}" reached episode ${targetEpisode} without its required residue evidence.`,
          `seed:ep${targetEpisode}:${seed.targetSceneIds[0] ?? 'episode'}:${seed.id}`,
          'Realize the prior choice as changed behavior, information, leverage, reputation, or relationship residue; do not restage the original event.',
        )
        : this.warning(
          `Downstream seed "${seed.id}" has no visible residue evidence in episode ${targetEpisode}.`,
          `seed:ep${targetEpisode}:${seed.targetSceneIds[0] ?? 'episode'}:${seed.id}`,
          'Carry the canonical residue into a later scene through an explicit callback, state-conditioned variant, or changed NPC behavior.',
        ));
    }

    for (const residue of graph.choiceResidueContracts ?? []) {
      const targetEpisode = residue.targetEpisodeNumbers.find((episodeNumber) => generatedEpisodes.has(episodeNumber));
      if (targetEpisode == null || !residue.sourceText.trim()) continue;
      const targetText = residue.targetSceneIds.length > 0
        ? residue.targetSceneIds.map((sceneId) => contractTextForScene(input.story, targetEpisode, sceneId)).join(' ')
        : episodeScenes(input.story, targetEpisode).map(sceneText).join(' ');
      const evidenceWords = normalize(residue.sourceText).split(' ').filter((word) => word.length >= 5);
      if (evidenceWords.length === 0 || evidenceWords.some((word) => evidenceHit(word, targetText))) continue;
      issues.push(residue.blocking
        ? this.error(
          `Choice residue "${residue.id}" has no visible downstream realization in episode ${targetEpisode}.`,
          `choiceResidue:ep${targetEpisode}:${residue.targetSceneIds[0] ?? 'episode'}:${residue.id}`,
          'Carry the choice forward through changed behavior, information, relationship posture, reputation, or a state-conditioned text variant.',
        )
        : this.warning(
          `Choice residue "${residue.id}" has no visible downstream realization in episode ${targetEpisode}.`,
          `choiceResidue:ep${targetEpisode}:${residue.targetSceneIds[0] ?? 'episode'}:${residue.id}`,
          'Give the earlier decision a distinct consequence surface instead of allowing branches to reconverge as identical prose.',
        ));
    }

    for (const episode of input.story.episodes ?? []) {
      const choicesByTarget = new Map<string, Array<{ choice: Choice; sceneId: string }>>();
      for (const scene of episode.scenes ?? []) {
        for (const choice of choicesInScene(scene)) {
          if (!choice.nextSceneId) continue;
          choicesByTarget.set(choice.nextSceneId, [...(choicesByTarget.get(choice.nextSceneId) ?? []), { choice, sceneId: scene.id }]);
        }
      }
      for (const [targetSceneId, routedChoices] of choicesByTarget) {
        if (routedChoices.length < 2) continue;
        const target = episode.scenes?.find((scene) => scene.id === targetSceneId);
        if (!target) continue;
        const opening = normalize((target.beats ?? []).find((beat) => beat.text?.trim())?.text ?? '');
        if (!opening || new Set(routedChoices.map(({ choice }) => normalize(choice.text))).size < 2) continue;
        const branchOpening = routedChoices.map(() => opening);
        if (new Set(branchOpening).size !== 1) continue;
        const hasMeaningfulConsequence = routedChoices.some(({ choice }) => (choice.consequences ?? []).some((consequence) =>
          consequence.type === 'setFlag'
          || consequence.type === 'relationship'
          || consequence.type === 'changeScore'
          || consequence.type === 'skill'
          || consequence.type === 'attribute'
          || consequence.type === 'addItem'
        ));
        const message = `Multiple distinct choices in episode ${episode.number} converge on scene "${targetSceneId}" with identical opening prose; branch residue is not visibly differentiated.`;
        const suggestion = 'Author distinct state-conditioned opening text, a text variant, or changed character behavior for each meaningful choice path.';
        issues.push(hasMeaningfulConsequence
          ? this.error(message, `choiceResidue:ep${episode.number}:${routedChoices[0].sceneId}`, suggestion)
          : this.warning(message, `choiceResidue:ep${episode.number}:${routedChoices[0].sceneId}`, suggestion));
      }
    }

    for (const transition of graph.transitionContracts ?? []) {
      const episode = input.story.episodes?.find((candidate) => candidate.number === transition.episodeNumber);
      if (!episode) continue;
      const scene = episode.scenes?.find((candidate) => candidate.id === transition.toSceneId);
      if (!scene) continue;
      const expectedLocation = normalize(transition.toLocation ?? '');
      const actualLocation = normalize(scene.timeline?.location ?? '');
      const expectedTime = normalize(transition.toTimeOfDay ?? '');
      const actualTime = normalize(scene.timeline?.timeOfDay ?? '');
      for (const stateContract of transition.stateContracts ?? []) {
        const hasEvidence = stateContract.requiredEvidence.length === 0
          || stateContract.requiredEvidence.some((pattern) => evidenceHit(pattern, sceneText(scene)));
        if (hasEvidence) continue;
        issues.push(stateContract.blocking
          ? this.error(
            `Continuity state "${stateContract.subject}" did not carry its required transition evidence into scene "${transition.toSceneId}".`,
            `transition-state:${stateContract.id}`,
            'Rewrite the receiving scene so the object, relationship, or disposition visibly persists across the transition.',
          )
          : this.warning(
            `Continuity state "${stateContract.subject}" has no visible transition evidence in scene "${transition.toSceneId}".`,
            `transition-state:${stateContract.id}`,
            'Add a natural visible reminder of the carried state.',
          ));
      }
      const locationMismatch = Boolean(expectedLocation && actualLocation && expectedLocation !== actualLocation && !actualLocation.includes(expectedLocation) && !expectedLocation.includes(actualLocation));
      const timeMismatch = Boolean(expectedTime && actualTime && expectedTime !== actualTime);
      if (!locationMismatch && !timeMismatch) continue;
      issues.push(transition.blocking
        ? this.error(
          `Canonical transition metadata for scene "${transition.toSceneId}" drifted from the episode plan (${locationMismatch ? 'location' : ''}${locationMismatch && timeMismatch ? ' and ' : ''}${timeMismatch ? 'time' : ''}).`,
          `transition:ep${transition.episodeNumber}:${transition.toSceneId}:${transition.id}`,
          'Repair the scene timeline from the canonical transition contract, then ensure the opening prose acknowledges the move naturally.',
        )
        : this.warning(
          `Transition metadata for scene "${transition.toSceneId}" does not match its canonical plan.`,
          `transition:ep${transition.episodeNumber}:${transition.toSceneId}:${transition.id}`,
          'Align location and time metadata with the compiled scene transition.',
        ));
    }

    for (const twist of graph.twistContracts ?? []) {
      if (!generatedEpisodes.has(twist.episodeNumber)) continue;
      const targetScenes = twist.targetSceneIds.length > 0
        ? episodeScenes(input.story, twist.episodeNumber).filter((scene) => twist.targetSceneIds.includes(scene.id))
        : episodeScenes(input.story, twist.episodeNumber);
      const hasScheduledBeat = targetScenes.some((scene) => (scene.beats ?? []).some((beat) => beat.plotPointType === twist.beatRole || (twist.beatRole === 'revelation' && beat.plotPointType === 'twist')));
      const hasEvidence = twist.requiredEvidence.some((pattern) => targetScenes.some((scene) => evidenceHit(pattern, sceneText(scene))));
      if (hasScheduledBeat && hasEvidence) continue;
      issues.push(twist.blocking
        ? this.error(
          `Scheduled ${twist.beatRole} "${twist.id}" is missing its on-page realization in episode ${twist.episodeNumber}.`,
          `twist:ep${twist.episodeNumber}:${twist.targetSceneIds[0] ?? 'episode'}:${twist.id}`,
          'Recompile or rewrite the owning scene so the planned revelation is foreshadowed and realized in the scheduled surface.',
        )
        : this.warning(
          `Scheduled ${twist.beatRole} "${twist.id}" has no explicit plot-point marker and evidence in episode ${twist.episodeNumber}.`,
          `twist:ep${twist.episodeNumber}:${twist.targetSceneIds[0] ?? 'episode'}:${twist.id}`,
          'Mark and realize the scheduled turn, or remove the recommendation from the architecture rather than carrying stale twist metadata.',
        ));
    }

    for (const topology of graph.episodeTopologyContracts ?? []) {
      if (topology.expectedSceneCount == null) continue;
      const runtimeScenes = episodeScenes(input.story, topology.episodeNumber);
      const plannedScenes = input.scenePlan?.scenes.filter((scene) => scene.episodeNumber === topology.episodeNumber) ?? [];
      const plannedById = new Map(plannedScenes.map((scene) => [scene.id, scene]));
      const genericShells = runtimeScenes.filter((scene) => {
        const planned = plannedById.get(scene.id);
        if (!planned || planned.planningOrigin) return false;
        if ((planned.narrativeEventIds ?? []).length > 0) return false;
        const label = scene.name || planned.title || planned.dramaticPurpose;
        return isQuestionShapedTurnText(label) || isGenericScenePlannerText(label);
      });
      if (genericShells.length === 0) continue;
      issues.push(this.error(
        `Episode ${topology.episodeNumber} contains ${genericShells.length} unowned generic scene shell(s) beyond the authored topology.`,
        `episodeTopology:ep${topology.episodeNumber}:${genericShells.map((scene) => scene.id).join(',')}`,
        'Merge generic pressure shells into their nearest authored event scene or add an explicitly justified treatment split.',
      ));
    }

    const hasExecutableEventTask = (eventId: string): boolean =>
      (graph.realizationTasks ?? []).some((task) => task.eventId === eventId);
    const viralEvents = graph.events.filter((event) =>
      !hasExecutableEventTask(event.id)
      && event.cue === 'blogAftermath'
      && /viral|readership|audience|followers?|shares?|views?/i.test(event.sourceText),
    );
    for (const event of viralEvents) {
      const prose = episodeScenes(input.story, event.episodeNumber).map(sceneText).join(' ');
      if (!/\bviral\b|goes?\s+viral/i.test(prose)) {
        issues.push(this.error(
          `Authored viral blog payoff "${event.id}" is not visibly realized in episode ${event.episodeNumber}.`,
          `viralBlogPayoff:ep${event.episodeNumber}:${event.id}`,
          'Show concrete public reach: readers, shares, notifications, local recognition, or another visible audience consequence.',
        ));
      }
    }

    for (const event of graph.events.filter((candidate) => candidate.cue === 'lateNightWriting')) {
      if (hasExecutableEventTask(event.id)) continue;
      const aliasRequirement = event.evidenceRequirements?.find((requirement) => requirement.kind === 'exact_alias');
      if (!aliasRequirement) continue;
      const prose = event.ownerSceneId
        ? contractTextForScene(input.story, event.episodeNumber, event.ownerSceneId)
        : episodeScenes(input.story, event.episodeNumber).map(sceneText).join(' ');
      if (!aliasRequirement.acceptedPatterns.some((pattern) => normalize(prose).includes(normalize(pattern)))) {
        issues.push(this.error(
          `Authored codename payoff "${event.id}" is not visibly realized in its owner scene ${event.ownerSceneId ?? `episode ${event.episodeNumber}`}.`,
          `identityAlias:ep${event.episodeNumber}:${event.id}`,
          `Use the exact authored alias: ${aliasRequirement.acceptedPatterns.join(', ')}.`,
        ));
      }
    }

    for (const event of graph.events.filter((candidate) =>
      candidate.routeRealizationPolicy === 'all_routes' && !hasExecutableEventTask(candidate.id),
    )) {
      const owner = event.ownerSceneId
        ? episodeScenes(input.story, event.episodeNumber).find((scene) => scene.id === event.ownerSceneId)
        : undefined;
      if (!owner?.encounter) continue;
      const tiers = event.requiredOutcomeTiers ?? [];
      for (const tier of tiers) {
        const routeTexts = collectReaderFacingTextsForEncounterOutcomeTier(owner, [tier]).get(tier) ?? [];
        const routeText = normalize(routeTexts.join(' '));
        const terminalText = normalize(collectReaderFacingTerminalTextsForEncounterOutcomeTier(owner, tier).join(' '));
        if (!routeText && !terminalText) continue;
        const hasRescue = /\b(?:rescu|interven|saved|pulled|dragged|shielded|carried|walked you home)\w*/i.test(routeText);
        const hasThreshold = /\b(?:threshold|door|apartment|hallway|gone|vanish|disappear|empty)\w*/i.test(terminalText);
        if (hasRescue && hasThreshold) continue;
        const issue = this.error(
          `Threat event "${event.id}" is not realized on terminal route "${tier}"; required rescue and disappearance/threshold evidence is missing.`,
          `routeRealization:ep${event.episodeNumber}:${event.id}:${tier}`,
          'Author the missing route evidence on its declared surface: rescue may occur on the reachable path, while threshold/disappearance must remain in the terminal aftermath.',
        );
        const requirement = event.evidenceRequirements?.find((candidate) => candidate.id.endsWith('rescue'));
        const task = requirement
          ? (graph.realizationTasks ?? []).find((candidate) =>
            candidate.contractId === requirement.id
            && (candidate.target.scope === 'route_path' || candidate.target.scope === 'route_terminal')
            && candidate.target.outcomeTier === tier,
          )
          : undefined;
        issue.metadata = {
          taskId: task?.id,
          contractId: requirement?.id ?? event.id,
          eventId: event.id,
          episodeNumber: event.episodeNumber,
          sceneId: event.ownerSceneId,
          outcomeTier: tier,
          artifactPath: task?.artifactPath,
          repairHandler: 'encounter_route',
          missingEvidenceAtoms: [
            ...(!hasRescue ? [`${event.id}:rescue`] : []),
            ...(!hasThreshold ? [`${event.id}:threshold-disappearance`] : []),
          ],
        };
        issues.push(issue);
      }
    }

    // Relationship pacing is authored per planned scene, but the forbidden
    // label is episode-local: a later scene must not leapfrog a contract that
    // was earned only in an encounter or branch-specific surface. Scan only
    // reader-facing text and ignore explicit negation, which is pacing-correct.
    const blockedRelationshipLabels = new Map<number, Array<{ label: string; contractId: string; permittedSceneOrder: number }>>();
    for (const planned of input.scenePlan?.scenes ?? []) {
      for (const pacing of planned.relationshipPacing ?? []) {
        for (const label of pacing.blockedLabels ?? []) {
          const existing = blockedRelationshipLabels.get(planned.episodeNumber) ?? [];
          existing.push({ label, contractId: pacing.id, permittedSceneOrder: planned.order });
          blockedRelationshipLabels.set(planned.episodeNumber, existing);
        }
      }
    }
    for (const [episodeNumber, labels] of blockedRelationshipLabels) {
      const scenes = episodeScenes(input.story, episodeNumber);
      for (const { label, contractId, permittedSceneOrder } of labels) {
        const labelPattern = normalize(label);
        const task = taskByContractId.get(contractId);
        const subjectTerms = relationshipSubjectTerms(input.story, task);
        const plannedOrderByScene = new Map((input.scenePlan?.scenes ?? [])
          .filter((scene) => scene.episodeNumber === episodeNumber)
          .map((scene) => [scene.id, scene.order]));
        const hitScene = scenes.find((scene) => {
          const order = plannedOrderByScene.get(scene.id) ?? scenes.indexOf(scene);
          if (order > permittedSceneOrder) return false;
          return sceneText(scene).split(/(?<=[.!?])\s+/).some((text) => {
            const normalized = normalize(text);
            if (!normalized.includes(labelPattern)) return false;
            if (!relationshipLabelIsSubjectScoped(text, label, subjectTerms)) return false;
            const prefix = normalized.slice(0, normalized.indexOf(labelPattern));
            return !/(?:\bnot|\bnever|\bno|\bnot yet|\bcould become|\bmight become)\s+(?:your|our|my|a|an|the)?\s*$/i.test(prefix);
          });
        });
        if (!hitScene) continue;
        const sceneId = hitScene.id;
        const issue = this.error(
          `Blocked relationship label "${label}" appears in reader-facing episode ${episodeNumber} prose before contract "${contractId}" permits it.`,
          `relationshipLabel:ep${episodeNumber}:${sceneId}:${contractId}:${labelPattern}`,
          'Rewrite the line at the currently earned relationship stage; preserve attraction, pressure, or provisional alliance without declaring the blocked label.',
        );
        issue.metadata = {
          taskId: task?.id,
          contractId,
          episodeNumber,
          sceneId,
          artifactPath: task?.artifactPath,
          repairHandler: 'relationship_pacing',
        };
        issues.push(issue);
      }
    }

    const blockingIssues = issues.filter((issue) => issue.severity === 'error');
    if (blockingIssues.length === 0) {
      return { ...buildSuccessResult(100), issues };
    }
    return buildFailureResult(issues, 0);
  }
}
