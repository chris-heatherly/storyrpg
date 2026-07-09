import { describe, expect, it } from 'vitest';

import type { SceneBlueprint } from '../agents/StoryArchitect';
import {
  applySceneContract,
  deriveSceneContract,
  isGenericScenePlannerText,
} from './sceneContractBuilders';

const scene = (overrides: Partial<SceneBlueprint> = {}): SceneBlueprint => ({
  id: 's1-1',
  name: 'setup scene 1',
  description: 'Open the episode through its immediate question: search pressure.',
  location: 'Vâlcescu Club',
  mood: 'charged',
  purpose: 'transition',
  dramaticQuestion: 'What does Kylie risk by trusting Mika at the club door?',
  wantVsNeed: 'Kylie wants entry but needs to learn who is safe.',
  conflictEngine: 'Mika controls the door and the key card.',
  npcsPresent: ['char-mika'],
  narrativeFunction: 'Open the episode through its immediate question: search pressure.',
  keyBeats: [],
  leadsTo: ['s1-2'],
  narrativeRole: 'setup',
  ...overrides,
});

describe('sceneContractBuilders', () => {
  it('detects generic planner scene labels and role-derived turns', () => {
    expect(isGenericScenePlannerText('setup scene 1')).toBe(true);
    expect(isGenericScenePlannerText('Let the fallout settle into the next pressure: search pressure.')).toBe(true);
    expect(isGenericScenePlannerText('Mika hands Kylie the key card at the club door.')).toBe(false);
  });

  it('derives a concrete scene contract from authored required beats before planner text', () => {
    const input = scene({
      requiredBeats: [{
        id: 'rb-1',
        tier: 'authored',
        sourceTurn: 'Mika adopts Kylie at the Vâlcescu Club door.',
        mustDepict: 'Mika swaps Kylie shoes and hands her the Vâlcescu key card.',
      }],
      turnContract: {
        turnId: 'generic-turn',
        source: 'planner',
        centralTurn: 'Open the episode through its immediate question: search pressure.',
        beforeState: '',
        turnEvent: 'Open the episode through its immediate question: search pressure.',
        afterState: '',
        handoff: '',
      },
    });

    const contract = deriveSceneContract(input, {
      sceneIndex: 0,
      nextSceneId: 's1-2',
      episodeSynopsis: 'Kylie lands in Bucharest and enters Dusk Club pressure.',
    });

    expect(contract.source).toBe('requiredBeat');
    expect(contract.title).toContain('Mika swaps Kylie shoes');
    expect(contract.turnContract.source).toBe('treatment');
    expect(contract.turnContract.centralTurn).toContain('key card');
    expect(contract.dramaticStructure.changedState).toContain('visible leverage');
    expect(contract.transitionOut[0]).toMatchObject({ toSceneId: 's1-2', connector: 'therefore' });
    expect(contract.residue[0].type).toBe('access');
    expect(contract.sequenceIntent.turningPoint).toContain('key card');
  });

  it('never accepts a question-shaped turn as the concrete scene turn (bite-me 2026-07-07 s1-7)', () => {
    const episodeQuestion = 'Can Kylie start over, feel wanted, and write under her own name in a city that is already watching her?';
    const input = scene({
      id: 's1-7',
      name: 'release scene 7',
      description: episodeQuestion,
      dramaticQuestion: episodeQuestion,
      dramaticPurpose: episodeQuestion,
      narrativeFunction: episodeQuestion,
      narrativeRole: 'release',
      turnContract: {
        turnId: 's1-7-turn',
        source: 'planner',
        centralTurn: episodeQuestion,
        beforeState: '',
        turnEvent: episodeQuestion,
        afterState: '',
        handoff: '',
      },
    });

    const contract = deriveSceneContract(input, { sceneIndex: 6 });

    expect(contract.source).toBe('role');
    expect(contract.turnContract.centralTurn.endsWith('?')).toBe(false);
    // The role fallback is scaffold text and must never confer event-cue ownership.
    expect(isGenericScenePlannerText(contract.turnContract.centralTurn)).toBe(true);
  });

  it('strips you promise stakes treatment labels from derived sequence intent', () => {
    const treatmentCard = `Hook — Kylie unpacks in a Belle Époque walk-up as the sun sets through the Lipscani window, her grandmother's gold chain catching the light; promise — reinvention, glamour, a city that owes her a better story; stakes — a FaceTime to her niece Sadie ("are there vampires in Romania?" / "only the boys I'm going to date, baby") that lands as a joke and quietly seeds everything.`;
    const input = scene({
      requiredBeats: [{
        id: 'rb-cold-open',
        tier: 'coldopen',
        sourceTurn: treatmentCard,
        mustDepict: treatmentCard,
      }],
      sequenceIntent: {
        objective: treatmentCard,
        activity: `Stage the pressure through visible action, reaction, object movement, distance, or dialogue around ${treatmentCard}`,
        obstacle: '',
        startState: treatmentCard,
        turningPoint: treatmentCard,
        endState: treatmentCard,
        visualThread: treatmentCard,
      },
    });

    const contract = deriveSceneContract(input, {
      sceneIndex: 0,
      nextSceneId: 's1-2',
    });

    const serialized = JSON.stringify(contract.sequenceIntent);
    expect(serialized).not.toMatch(/Hook\s*—|promise\s*—|stakes\s*—|Stage the pressure/i);
    expect(contract.concreteTurn).toContain('Kylie unpacks');
    expect(contract.sequenceIntent.objective).toContain('Kylie unpacks');
    expect(contract.sequenceIntent.turningPoint).toContain('FaceTime to her niece Sadie');
  });

  it('upgrades generic release scenes without authored beats into changed-state contracts', () => {
    const input = scene({
      id: 's1-6',
      name: 'release scene 6',
      location: "Kylie's Apartment",
      narrativeRole: 'release',
      leadsTo: [],
      dramaticQuestion: '',
      wantVsNeed: '',
      conflictEngine: '',
      description: '',
      narrativeFunction: '',
    });

    const contract = deriveSceneContract(input, {
      sceneIndex: 5,
      episodeSynopsis: 'The viral blog post turns private rescue into public romantic pressure.',
      episodePressure: 'Kylie must decide what public attention costs her.',
      role: 'release',
    });

    expect(contract.source).toBe('role');
    expect(contract.title).not.toBe('release scene 6');
    expect(contract.turnContract.centralTurn.toLowerCase()).toContain('aftermath pressure');
    expect(contract.dramaticStructure.question).toContain('What changes');
    expect(contract.residue[0].description).toContain('visible consequence');
    expect(contract.transitionOut).toEqual([]);
  });

  it('applies derived metadata back onto a blueprint scene', () => {
    const input = scene({
      requiredBeats: [{
        id: 'rb-1',
        tier: 'authored',
        sourceTurn: 'Stela presses rose quartz into Kylie hand.',
        mustDepict: 'Stela presses rose quartz into Kylie hand and warns her about Victor.',
      }],
    });

    applySceneContract(input, { sceneIndex: 0, nextSceneId: 's1-2' });

    expect(input.name).not.toBe('setup scene 1');
    expect(input.dramaticStructure?.turn).toContain('rose quartz');
    expect(input.turnContract?.centralTurn).toContain('rose quartz');
    expect(input.sequenceIntent?.objective).toBeTruthy();
    expect(input.transitionOut?.[0].toSceneId).toBe('s1-2');
    expect(input.residue?.[0].type).toBe('information');
    expect(input.keyBeats.some((beat) => beat.startsWith('PEAK:'))).toBe(true);
  });

  it('never seeds visualThread from treatment titles via Track-the-visible scaffold', () => {
    const input = scene({
      name: 'She wanders into a bookshop owned by Stela who befriends her and…',
      location: 'Lumina Books',
      requiredBeats: [{
        id: 'rb-1',
        tier: 'authored',
        sourceTurn: 'She wanders into a bookshop owned by Stela who befriends her.',
        mustDepict: 'She wanders into a bookshop owned by Stela who befriends her.',
      }],
    });

    const contract = deriveSceneContract(input, { sceneIndex: 1 });
    expect(contract.sequenceIntent.visualThread).not.toMatch(/Track the visible consequence/i);
    expect(contract.sequenceIntent.visualThread).toMatch(/Lumina Books|geography|threshold/i);
  });

  it('hydrates a complete stakes ladder for opening scenes with empty key beats', () => {
    const input = scene({
      id: 's1-arrival-cold-open',
      name: 'arrival cold open',
      location: 'New City Apartment',
      narrativeRole: 'setup',
      keyBeats: [],
      requiredBeats: [{
        id: 'rb-cold-open',
        tier: 'coldopen',
        sourceTurn: 'The protagonist arrives alone and tries to make reinvention look effortless.',
        mustDepict: 'The protagonist arrives alone and turns a private call into proof that reinvention has a cost.',
      }],
      coldOpenProfile: {
        id: 'cold-open-profile-s1',
        sceneId: 's1-arrival-cold-open',
        mode: 'new_normal',
        archetype: 'status_quo_shift',
        storyCircleBeats: ['you', 'need'],
        storyCircleFulfillment: {
          beats: ['you', 'need'],
          combinedBeats: ['you', 'need'],
          baseline: 'The protagonist arrives alone and tries to make reinvention look effortless.',
          need: 'The protagonist needs the move to mean more than escape.',
          collision: 'Private reinvention collides with the need to prove the move has meaning.',
          sourceContractIds: ['story-circle-you', 'story-circle-need'],
        },
        centralTurn: 'Private reinvention collides with the need to prove the move has meaning.',
        microConflict: 'A private call exposes the cost of making the move look effortless.',
        openQuestion: 'Can reinvention survive its first public test?',
        activeCastLimit: 2,
        beatBudget: { min: 4, recommended: 5, max: 7 },
        exitHook: 'End on the first consequence of making reinvention public.',
        sourceContractIds: ['story-circle-you', 'story-circle-need'],
        selectedConcepts: [],
        routedConceptIds: [],
      },
    });

    applySceneContract(input, {
      sceneIndex: 0,
      nextSceneId: 's1-1',
      episodeSynopsis: 'A fresh start becomes public pressure.',
    });

    expect(input.keyBeats.length).toBeGreaterThanOrEqual(5);
    expect(input.keyBeats.map((beat) => beat.split(':')[0])).toEqual([
      'REST',
      'RISK',
      'LEVERAGE',
      'PEAK',
      'CONSEQUENCE',
    ]);
    expect(input.keyBeats.join('\n')).toMatch(/risk|cost|leverage|narrows|consequence|pressure/i);
  });

  it('replaces generic single-peak repair beats with a full stakes ladder', () => {
    const forcedReaction = 'The protagonist must decide whether private proof becomes public danger.';
    const input = scene({
      id: 's1-4',
      name: 'release scene 4',
      location: 'Apartment',
      narrativeRole: 'release',
      dramaticQuestion: '',
      wantVsNeed: '',
      conflictEngine: '',
      description: '',
      narrativeFunction: '',
      keyBeats: [`PEAK: ${forcedReaction}`],
      turnContract: {
        turnId: 's1-4-turn',
        source: 'planner',
        centralTurn: forcedReaction,
        beforeState: 'The episode fallout is still private.',
        turnEvent: forcedReaction,
        afterState: 'The consequence becomes public enough to reshape the next choice.',
        handoff: 'Close on the next pressure.',
      },
    });

    applySceneContract(input, {
      sceneIndex: 3,
      episodeSynopsis: 'A private rescue becomes public pressure.',
      role: 'release',
    });

    expect(input.keyBeats.length).toBeGreaterThanOrEqual(5);
    expect(input.keyBeats.filter((beat) => /^PEAK:/i.test(beat))).toHaveLength(1);
    expect(input.keyBeats.join('\n')).toMatch(/REST:|RISK:|LEVERAGE:|PEAK:|CONSEQUENCE:/);
    expect(input.keyBeats.join('\n')).toMatch(/cost|public|danger|consequence|pressure/i);
  });

  it('derives a complete three-layer stakes stack for planned major scenes', () => {
    const input = scene({
      name: 'Kylie arrives in Bucharest',
      description: 'Kylie arrives in Bucharest and realizes her dating column is now her only map.',
      narrativeRole: 'setup',
      stakesLayers: {
        existential: 'Kylie risks losing the future she came to Bucharest to claim.',
      },
    });

    const contract = deriveSceneContract(input, {
      sceneIndex: 0,
      episodeSynopsis: 'Kylie lands in Bucharest and enters Dusk Club pressure.',
    });

    expect(contract.stakesLayers.material).toContain('concrete access');
    expect(contract.stakesLayers.relational).toContain('trust');
    expect(contract.stakesLayers.identity).toContain('self-protective');
    expect(contract.stakesLayers.existential).toContain('future');
  });
});
