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
