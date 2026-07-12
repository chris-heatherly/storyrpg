import { describe, expect, it } from 'vitest';
import type { Story } from '../../types/story';
import type { NarrativeContractGraph } from '../../types/narrativeContract';
import type { SeasonScenePlan } from '../../types/scenePlan';
import { NarrativeContractValidator } from './NarrativeContractValidator';

function story(texts: string[]): Story {
  return {
    id: 'bite-me', title: 'Bite Me', genre: 'romance', synopsis: '', coverImage: '', npcs: [],
    initialState: { attributes: {}, skills: {}, tags: [], inventory: [] },
    episodes: [{
      id: 'ep1', number: 1, title: 'Dating After Dusk', synopsis: '', coverImage: '', startingSceneId: 's1',
      scenes: texts.map((text, index) => ({ id: `s${index + 1}`, name: `Scene ${index + 1}`, beats: [{ id: `b${index + 1}`, text }], startingBeatId: `b${index + 1}` })),
    }],
  } as unknown as Story;
}

function graph(): NarrativeContractGraph {
  return {
    version: 2, compilerVersion: 'test', storyId: 'bite-me', sourceHash: 'hash', events: [
      { id: 'ep1-blog', episodeNumber: 1, sourceOrder: 1, sourceText: 'By evening the post has gone viral.', sourceContractIds: [], realizationMode: 'depiction', ownershipPolicy: 'exactly_one_scene', prerequisiteEventIds: [], targetSceneIds: ['s1'], targetSpineUnitIds: [], ownerSceneId: 's1', cue: 'blogAftermath', provenance: { source: 'treatment_contract', confidence: 'authoritative' } },
    ],
    characterPresenceContracts: [],
    identityScheduleContracts: [{ id: 'identity:victor', characterId: 'victor', canonicalName: 'Victor Valcescu', allowedAliases: ['Mr. Midnight'], forbiddenBeforeNamedEpisode: ['Victor Valcescu', 'Victor'], firstVisualEpisode: 1, firstNamedEpisode: 2, sourceContractIds: [] }],
    characterRoleConstraints: [{ id: 'role:radu:ep1', characterId: 'radu', characterName: 'Radu Stoian', episodeNumber: 1, allowedFunctions: ['visual_plant'], forbiddenFunctions: ['attacker'], sourceContractIds: [] }],
    episodeTopologyContracts: [{ episodeNumber: 1, expectedSceneCount: 1, authoredUnitIds: ['unit-1'], authoredUnitTexts: ['Post goes viral'], tolerance: 0 }],
    dependencies: [], validation: { passed: true, issues: [] },
  };
}

describe('NarrativeContractValidator', () => {
  it('blocks early canonical identity and unauthorized attacker role', () => {
    const result = new NarrativeContractValidator().validate({
      story: story(['Victor Valcescu watches while Radu Stoian attacks you.']),
      graph: graph(),
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join('\n')).toMatch(/canonical identity/i);
    expect(result.issues.map((issue) => issue.message).join('\n')).toMatch(/forbidden early role/i);
  });

  it('requires a concrete viral audience consequence', () => {
    const result = new NarrativeContractValidator().validate({ story: story(['You publish Mr. Midnight.']), graph: graph() });
    expect(result.issues.some((issue) => /viral blog payoff/i.test(issue.message))).toBe(true);
  });

  it('accepts a codename and visible reach without naming Victor', () => {
    const result = new NarrativeContractValidator().validate({
      story: story(['You publish Mr. Midnight. By evening, the post has gone viral; readers share it and strangers recognize your name.']),
      graph: graph(),
    });
    expect(result.issues).toEqual([]);
  });

  it('requires an exact alias on the late-night writing owner scene', () => {
    const canonical = graph();
    canonical.events.unshift({
      id: 'ep1-writing',
      episodeNumber: 1,
      sourceOrder: 0,
      sourceText: 'You write about Mr. Midnight.',
      sourceContractIds: ['writing'],
      realizationMode: 'depiction',
      ownershipPolicy: 'exactly_one_scene',
      prerequisiteEventIds: [],
      targetSceneIds: ['s1'],
      targetSpineUnitIds: [],
      ownerSceneId: 's1',
      cue: 'lateNightWriting',
      evidenceRequirements: [{
        id: 'ep1-writing:exact-alias',
        eventId: 'ep1-writing',
        kind: 'exact_alias',
        acceptedPatterns: ['Mr. Midnight'],
        requiredExactText: true,
        requiredSurface: 'owner_scene',
        blocking: true,
      }],
      provenance: { source: 'treatment_contract', confidence: 'authoritative' },
    });
    const input = story(['You open a blank document.', 'The stranger calls himself Mr. Midnight.']);
    input.episodes[0].scenes[1].id = 's2';
    const result = new NarrativeContractValidator().validate({ story: input, graph: canonical });
    expect(result.issues.some((issue) => /owner scene/i.test(issue.message))).toBe(true);
  });

  it('rejects runtime scene topology drift instead of filtering stale plan shells', () => {
    const input = story(['The opening turn lands.']);
    const scenePlan = {
      scenes: [{ id: 's1', episodeNumber: 1, narrativeEventIds: ['ep1-blog'] }],
      episodeEventPlans: {
        1: {
          version: 2,
          compilerVersion: 'test',
          episodeNumber: 1,
          sourceGraphHash: 'hash',
          orderedEventIds: ['ep1-blog'],
          assignments: [{ eventId: 'ep1-blog', sceneId: 's1', order: 0 }],
          sceneOrder: ['s1', 'stale-shell'],
          sceneContexts: [{ sceneId: 's1', ownedEventIds: ['ep1-blog'], priorEventIdsWithinEpisode: [], forbiddenRestageEventIds: [] }],
          dueDependencyIds: [],
          activeDependencyIds: [],
          characterPresenceContracts: [],
          validation: { passed: true, issues: [] },
        },
      },
    } as unknown as SeasonScenePlan;
    input.episodes[0].scenes[0].sceneEventOwnership = { ownedEvents: [{ eventContractId: 'ep1-blog' }] } as never;
    const result = new NarrativeContractValidator().validate({ story: input, scenePlan, graph: graph() });
    expect(result.issues.some((issue) => /scene order/i.test(issue.message))).toBe(true);
  });

  it('checks terminal encounter routes independently of shared setup prose', () => {
    const canonical = graph();
    canonical.events.push({
      id: 'ep1-threat',
      episodeNumber: 1,
      sourceOrder: 2,
      sourceText: 'You are attacked, rescued at the threshold, and the stranger vanishes.',
      sourceContractIds: ['threat'],
      realizationMode: 'depiction',
      ownershipPolicy: 'exactly_one_scene',
      prerequisiteEventIds: [],
      targetSceneIds: ['s1'],
      targetSpineUnitIds: [],
      ownerSceneId: 's1',
      cue: 'threatEncounter',
      routeRealizationPolicy: 'all_routes',
      requiredOutcomeTiers: ['victory', 'defeat'],
      provenance: { source: 'treatment_contract', confidence: 'authoritative' },
    });
    const input = story(['The attack comes fast. By evening, the post has gone viral.']);
    input.episodes[0].scenes[0].encounter = {
      outcomes: {
        victory: { narrativeText: 'The stranger rescues you at the threshold, then vanishes.' },
        defeat: { narrativeText: 'You run until the park is empty.' },
      },
    } as never;
    const result = new NarrativeContractValidator().validate({ story: input, graph: canonical });
    expect(result.issues.some((issue) => /terminal route "defeat"/i.test(issue.message))).toBe(true);
  });

  it('accepts path-level rescue plus terminal threshold evidence without duplicating rescue prose', () => {
    const canonical = graph();
    canonical.events.push({
      id: 'ep1-threat-path', episodeNumber: 1, sourceOrder: 2,
      sourceText: 'You are attacked, rescued, and brought to the threshold before the stranger vanishes.',
      sourceContractIds: ['threat'], realizationMode: 'depiction', ownershipPolicy: 'exactly_one_scene',
      prerequisiteEventIds: [], targetSceneIds: ['s1'], targetSpineUnitIds: [], ownerSceneId: 's1', cue: 'threatEncounter',
      routeRealizationPolicy: 'all_routes', requiredOutcomeTiers: ['victory', 'defeat'],
      provenance: { source: 'treatment_contract', confidence: 'authoritative' },
    });
    const input = story(['The attack comes fast. By evening, the post has gone viral.']);
    input.episodes[0].scenes[0].encounter = {
      phases: [{ beats: [{ text: 'A dark-clad rescuer intervenes and pulls you clear.' }] }],
      outcomes: {
        victory: { narrativeText: 'At your apartment door, he is suddenly gone.' },
        defeat: { narrativeText: 'You reach the apartment threshold. The stranger vanishes into the empty street.' },
      },
    } as never;
    const result = new NarrativeContractValidator().validate({ story: input, graph: canonical });
    expect(result.issues.some((issue) => /ep1-threat-path.*terminal route/i.test(issue.message))).toBe(false);
  });

  it('blocks a question-shaped shell only when it has no canonical depiction event', () => {
    const input = story(['The rooftop meeting ends with a new danger.']);
    input.episodes[0].scenes[0].name = 'Can Kylie start over after the rooftop?';
    const scenePlan = {
      scenes: [{ id: 's1', episodeNumber: 1, narrativeEventIds: [] }],
    } as unknown as SeasonScenePlan;
    const result = new NarrativeContractValidator().validate({ story: input, scenePlan, graph: graph() });
    expect(result.issues.some((issue) => /unowned generic scene shell/i.test(issue.message))).toBe(true);
  });

  it('does not treat an authored event scene as a topology failure merely because the planner split it', () => {
    const input = story(['The rooftop meeting ends with a new danger.']);
    input.episodes[0].scenes[0].name = 'Can Kylie start over after the rooftop?';
    const scenePlan = {
      scenes: [{ id: 's1', episodeNumber: 1, narrativeEventIds: ['ep1-rooftop'] }],
    } as unknown as SeasonScenePlan;
    const result = new NarrativeContractValidator().validate({ story: input, scenePlan, graph: graph() });
    expect(result.issues.some((issue) => /unowned generic scene shell/i.test(issue.message))).toBe(false);
  });

  it('blocks a sealed episode when canonical depiction ownership is missing', () => {
    const input = story(['The bookshop opens onto the night.']);
    input.episodes[0].scenes[0].sceneEventOwnership = { ownedEvents: [] } as never;
    const scenePlan = {
      scenes: [{ id: 's1', episodeNumber: 1, narrativeEventIds: ['ep1-blog'] }],
      episodeEventPlans: {
        1: {
          version: 2,
          compilerVersion: 'test',
          episodeNumber: 1,
          sourceGraphHash: 'hash',
          orderedEventIds: ['ep1-blog'],
          assignments: [{ eventId: 'ep1-blog', sceneId: 's1', order: 0 }],
          sceneOrder: ['s1'],
          sceneContexts: [{ sceneId: 's1', ownedEventIds: ['ep1-blog'], priorEventIdsWithinEpisode: [], forbiddenRestageEventIds: [] }],
          dueDependencyIds: [],
          activeDependencyIds: [],
          characterPresenceContracts: [],
          validation: { passed: true, issues: [] },
        },
      },
    } as unknown as SeasonScenePlan;
    const result = new NarrativeContractValidator().validate({ story: input, scenePlan, graph: graph() });
    expect(result.issues.some((issue) => /sealed runtime episode|runtime ownership/i.test(issue.message))).toBe(true);
  });

  it('emits an exact scene and relationship repair target for a premature label', () => {
    const canonical = graph();
    const scenePlan = {
      scenes: [{
        id: 's2', episodeNumber: 1, order: 1, relationshipPacing: [{
          id: 'rel:stela', source: 'treatment', startStage: 'acquaintance', targetStage: 'friend',
          allowedLabels: ['friend'], blockedLabels: ['friend'], requiredEvidence: [],
          minScenesSinceIntroduction: 1, maxDeltaThisScene: 1, mechanicDimensions: ['trust'],
        }],
      }],
      narrativeContractGraph: canonical,
    } as unknown as SeasonScenePlan;
    canonical.realizationTasks = [{
      id: 'task:rel:stela:relationship-labels', contractId: 'rel:stela', episodeNumber: 1,
      ownerStage: 'scene_writer', repairHandler: 'relationship_pacing', sceneId: 's2',
      evidenceAtoms: [], requiredSurface: ['beat_text'], routePolicy: 'owner_surface', sourceContractIds: ['rel:stela'], blocking: true,
    }];
    const input = story(['Arrival.', 'Stela calls you her friend.']);
    const result = new NarrativeContractValidator().validate({ story: input, scenePlan, graph: canonical });
    const issue = result.issues.find((candidate) => /Blocked relationship label/.test(candidate.message));
    expect(issue?.metadata?.sceneId).toBe('s2');
    expect(issue?.metadata?.repairHandler).toBe('relationship_pacing');
    expect(issue?.metadata?.taskId).toBe('task:rel:stela:relationship-labels');
  });

  it('does not treat family-history prose as a relationship label for every NPC', () => {
    const canonical = graph();
    canonical.realizationTasks = [{
      id: 'task:rel:stela:relationship-labels', contractId: 'rel:stela', episodeNumber: 1,
      ownerStage: 'scene_writer', repairHandler: 'relationship_pacing', sceneId: 's2',
      evidenceScope: { npcId: 'char-stela-pavel' }, evidenceAtoms: [{
        id: 'family', description: 'family is not yet earned', acceptedPatterns: ['family'],
        kind: 'relationship_label', required: true, polarity: 'forbidden',
      }], requiredSurface: ['beat_text'], routePolicy: 'owner_surface', sourceContractIds: ['rel:stela'], blocking: true,
    }];
    const input = story(['Arrival.', "Your father's family calls this city a birthright."]);
    input.npcs = [{ id: 'char-stela-pavel', name: 'Stela Pavel' }] as never;
    const scenePlan = {
      scenes: [{ id: 's2', episodeNumber: 1, order: 1, relationshipPacing: [{
        id: 'rel:stela', source: 'treatment', startStage: 'unmet', targetStage: 'spark',
        allowedLabels: ['spark'], blockedLabels: ['family'], requiredEvidence: [],
        minScenesSinceIntroduction: 0, maxDeltaThisScene: 1, mechanicDimensions: ['trust'],
      }] }],
      narrativeContractGraph: canonical,
    } as unknown as SeasonScenePlan;
    const result = new NarrativeContractValidator().validate({ story: input, scenePlan, graph: canonical });
    expect(result.issues.some((issue) => /Blocked relationship label/.test(issue.message))).toBe(false);
  });

  it('rechecks event realization after late scene mutation and preserves the owner repair target', () => {
    const canonical = graph();
    canonical.realizationTasks = [{
      id: 'task:ep1-blog:audience', contractId: 'ep1-blog', eventId: 'ep1-blog', episodeNumber: 1,
      ownerStage: 'scene_writer', repairHandler: 'scene_prose', sceneId: 's1',
      evidenceAtoms: [{ id: 'viral', description: 'viral reach', acceptedPatterns: ['viral', 'readers'], kind: 'route', required: true }],
      requiredSurface: ['beat_text'], routePolicy: 'owner_surface', sourceContractIds: ['ep1-blog'], blocking: true,
    }];
    const result = new NarrativeContractValidator().validate({ story: story(['You publish the post, but the night stays quiet.']), graph: canonical });
    const issue = result.issues.find((candidate) => /Canonical owner realization drift/.test(candidate.message));
    expect(issue?.metadata?.taskId).toBe('task:ep1-blog:audience');
    expect(issue?.metadata?.repairHandler).toBe('scene_prose');
    expect(issue?.metadata?.missingEvidenceAtoms).toEqual(['viral']);
  });

  it('uses realization tasks as the sole executable route check for version-3 graphs', () => {
    const canonical = graph();
    canonical.version = 3;
    canonical.events.push({
      id: 'ep1-threat', episodeNumber: 1, sourceOrder: 2,
      sourceText: 'The stranger vanishes at the threshold.', sourceContractIds: ['threat'],
      realizationMode: 'depiction', ownershipPolicy: 'exactly_one_scene', prerequisiteEventIds: [],
      targetSceneIds: ['s1'], targetSpineUnitIds: [], ownerSceneId: 's1', cue: 'threatEncounter',
      routeRealizationPolicy: 'all_routes', requiredOutcomeTiers: ['victory'],
      provenance: { source: 'treatment_contract', confidence: 'authoritative' },
    });
    canonical.realizationTasks = [{
      id: 'task:ep1-threat:threshold:victory', contractId: 'ep1-threat:threshold', eventId: 'ep1-threat', episodeNumber: 1,
      ownerStage: 'encounter_architect', repairHandler: 'encounter_route', sceneId: 's1', outcomeTier: 'victory',
      evidenceAtoms: [{ id: 'threshold', description: 'threshold departure', acceptedPatterns: ['vanishes'], kind: 'route', required: true }],
      target: { scope: 'route_terminal', outcomeTier: 'victory', surfaces: ['terminal_storylet'] },
      requiredSurface: ['terminal_storylet'], routePolicy: 'terminal_required', sourceContractIds: ['threat'], blocking: true,
    }];
    const input = story(['The attack ends. By evening, the post has gone viral.']);
    input.episodes[0].scenes[0].encounter = { outcomes: { victory: { outcomeText: 'He walks you to the door.' } } } as never;

    const result = new NarrativeContractValidator().validate({ story: input, graph: canonical });
    const routeIssues = result.issues.filter((issue) =>
      issue.metadata?.eventId === 'ep1-threat' || /Threat event "ep1-threat"/.test(issue.message),
    );
    expect(routeIssues).toHaveLength(1);
    expect(routeIssues[0]?.metadata?.taskId).toBe('task:ep1-threat:threshold:victory');
  });

  it('keeps nonblocking realization tasks advisory during final regression', () => {
    const canonical = graph();
    canonical.realizationTasks = [{
      id: 'task:advisory', contractId: 'ep1-blog', eventId: 'ep1-blog', episodeNumber: 1,
      ownerStage: 'scene_writer', repairHandler: 'scene_prose', sceneId: 's1',
      evidenceAtoms: [{ id: 'readers', description: 'audience reach', acceptedPatterns: ['readers'], kind: 'lexical', required: true }],
      target: { scope: 'owner', surfaces: ['beat_text'] },
      requiredSurface: ['beat_text'], routePolicy: 'owner_surface', sourceContractIds: ['ep1-blog'], blocking: false,
    }];

    const result = new NarrativeContractValidator().validate({ story: story(['You publish the post.']), graph: canonical });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.severity).toBe('warning');
  });

  it('blocks an authored premise that exists only in plan metadata', () => {
    const canonical = graph();
    canonical.premiseContracts = [{
      id: 'premise:role',
      episodeNumber: 1,
      fieldName: 'Role in the world',
      fieldKind: 'role_fact',
      sourceText: 'A food writer from New York starts over after a cancelled engagement.',
      evidencePatterns: ['food writer', 'new york', 'cancelled engagement'],
      minimumEvidenceHits: 2,
      targetSceneIds: ['s1'],
      requiredSurface: ['beat_text', 'dialogue'],
      sourceContractIds: ['character-role'],
      blocking: true,
      provenance: { source: 'treatment', confidence: 'authoritative' },
    }];
    const result = new NarrativeContractValidator().validate({
      story: story(['You arrive in a new city with one suitcase and no plan.']),
      graph: canonical,
    });
    expect(result.issues.some((issue) => /premise contract/i.test(issue.message))).toBe(true);
  });

  it('requires the canonical state id at the owning choice surface', () => {
    const canonical = graph();
    canonical.stateContracts = [{
      id: 'state:trusted-contact',
      canonicalStateId: 'trusted_contact',
      aliases: [],
      sourceEpisodeNumber: 1,
      targetEpisodeNumbers: [1, 2],
      sourceContractIds: ['residue-1'],
      requiredSetterSurface: 'choice_consequence',
      blocking: true,
      provenance: { source: 'residue_plan', confidence: 'authoritative' },
    }];
    const input = story(['You decide to tell her the truth.']);
    input.episodes[0].scenes[0].beats[0].choices = [{
      id: 'choice-1',
      text: 'Tell her',
      consequences: [{ type: 'setFlag', flag: 'confided_in_contact_alias', value: true }],
    }] as never;
    const result = new NarrativeContractValidator().validate({ story: input, graph: canonical });
    expect(result.issues.some((issue) => /canonical state/i.test(issue.message))).toBe(true);
  });

  it('checks downstream seed residue only when the payoff episode is present', () => {
    const canonical = graph();
    canonical.seedContracts = [{
      id: 'seed:trust',
      sourceEpisodeNumber: 1,
      targetEpisodeNumbers: [2],
      targetSceneIds: ['s2'],
      sourceText: 'The contact remembers that you trusted her first.',
      requiredEvidence: ['trusted', 'remembers'],
      stateContractIds: ['state:trusted-contact'],
      realizationMode: 'future_obligation',
      payoffWindow: { minEpisode: 2, maxEpisode: 2 },
      requiredSurface: ['beat_text'],
      sourceContractIds: ['residue-1'],
      blocking: true,
      provenance: { source: 'residue_plan', confidence: 'authoritative' },
    }];
    const input = story(['The first conversation changes the shape of the night.']);
    input.episodes.push({
      id: 'ep2', number: 2, title: 'Later', synopsis: '', coverImage: '', startingSceneId: 's2',
      scenes: [{ id: 's2', name: 'Later', beats: [{ id: 'b2', text: 'The contact asks what you want now.' }], startingBeatId: 'b2' }],
    } as never);
    const result = new NarrativeContractValidator().validate({ story: input, graph: canonical });
    expect(result.issues.some((issue) => /downstream seed/i.test(issue.message))).toBe(true);
  });

  it('flags runtime transition metadata drift separately from prose continuity', () => {
    const canonical = graph();
    canonical.transitionContracts = [{
      id: 'transition:s1-to-s2',
      episodeNumber: 1,
      fromSceneId: 's1',
      toSceneId: 's2',
      fromLocation: 'bookshop',
      toLocation: 'rooftop bar',
      fromTimeOfDay: 'afternoon',
      toTimeOfDay: 'night',
      requiredBridgeEvidence: ['later that night'],
      blocking: true,
      sourceContractIds: ['scene:s1', 'scene:s2'],
    }];
    const input = story(['You leave the bookshop.', 'You step into the club.']);
    input.episodes[0].scenes[1].timeline = { location: 'club', timeOfDay: 'dusk' } as never;
    const result = new NarrativeContractValidator().validate({ story: input, graph: canonical });
    expect(result.issues.some((issue) => /transition metadata/i.test(issue.message))).toBe(true);
  });
});
