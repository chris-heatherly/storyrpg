import { describe, expect, it } from 'vitest';

import type { SceneConstructionSceneLike } from './sceneConstructionProfile';
import {
  attachSceneConstructionProfiles,
  applySceneConstructionProfilesToScenes,
  buildSceneConstructionPromptView,
  buildSceneConstructionProfileSection,
  collectSceneConstructionProfileIssues,
  compileSceneConstructionProfile,
} from './sceneConstructionProfile';

describe('sceneConstructionProfile compiler', () => {
  it('compiles one primary turn and merges duplicate obligations from different lanes', () => {
    const profile = compileSceneConstructionProfile({
      id: 's1-1',
      episodeNumber: 1,
      npcsPresent: ['Ada Vale', 'char-ada-vale', 'Bryn Cole'],
      turnContract: {
        turnId: 's1-1-turn',
        source: 'treatment',
        centralTurn: 'Ada enters the station and the clerk names her aloud.',
        beforeState: 'Ada thinks the false name still protects her.',
        turnEvent: 'Ada enters the station and the clerk names her aloud.',
        afterState: 'The room knows she is exposed.',
        handoff: 'A locked office opens.',
      },
      requiredBeats: [{
        id: 'arrival',
        tier: 'authored',
        sourceTurn: 'Ada enters the station and the clerk names her aloud.',
        mustDepict: 'Ada enters the station and the clerk names her aloud.',
      }],
      storyCircleBeatContracts: [{
        id: 'episode-circle-ep1-you',
        beat: 'you',
        sourceText: 'Ada survives by staying unnamed until the station clerk exposes her.',
        targetEpisodeNumber: 1,
        requiredRealization: ['scene_turn', 'final_prose'],
        eventAtoms: ['The station clerk exposes Ada.'],
        targetSceneIds: ['s1-1'],
        blockingLevel: 'structural',
      }],
      mechanicPressure: [{
        id: 'identity-pressure',
        source: 'treatment',
        domain: 'identity',
        function: 'plant',
        mechanicRef: {},
        storyPressure: 'Being named in public creates identity pressure.',
        evidenceRequired: ['The clerk names Ada aloud.'],
        visibleResidue: ['Ada loses anonymity.'],
        allowedPayoffs: [],
        blockedPayoffs: [],
      }],
    });

    expect(profile.primaryTurn.text).toContain('clerk names her aloud');
    expect(profile.obligations.filter((item) => item.slot === 'primary_turn')).toHaveLength(1);
    expect(profile.obligations.find((item) => item.id === 'arrival')?.mergedInto).toBe('s1-1-turn');
    expect(profile.capacity.activeCastCount).toBe(2);
    expect(profile.activeCast).toContain('Ada Vale');
    expect(profile.activeCast).toContain('char-ada-vale');
  });

  it('uses cold-open profile pressure as support without inventing another scene layer', () => {
    const profile = compileSceneConstructionProfile({
      id: 's1-1',
      episodeNumber: 1,
      coldOpenProfile: {
        id: 'cold-open:1:s1-1',
        episodeNumber: 1,
        sceneId: 's1-1',
        mode: 'sharp_disruption',
        archetype: 'in_media_res',
        storyCircleBeats: ['you', 'need'],
        storyCircleFulfillment: {
          beats: ['you', 'need'],
          combinedBeats: ['you', 'need'],
          baseline: 'The protagonist hides behind perfect manners.',
          need: 'The protagonist needs to tell the truth.',
          collision: 'Perfect manners collide with the need to tell the truth.',
          sourceContractIds: ['you', 'need'],
        },
        centralTurn: 'A guest asks the one question the protagonist cannot politely evade.',
        microConflict: 'The protagonist wants social cover, but the question strips it away.',
        openQuestion: 'Will the protagonist lie or risk exposure?',
        activeCastLimit: 2,
        beatBudget: { min: 6, recommended: 8, max: 10 },
        exitHook: 'End on the unanswered question.',
        sourceContractIds: ['you', 'need'],
        selectedConcepts: [],
      },
      storyCircleBeatContracts: [
        {
          id: 'you',
          beat: 'you',
          sourceText: 'The protagonist hides behind perfect manners.',
          targetEpisodeNumber: 1,
          requiredRealization: ['scene_turn', 'final_prose'],
          eventAtoms: ['The protagonist hides behind perfect manners.'],
          targetSceneIds: ['s1-1'],
          blockingLevel: 'structural',
        },
        {
          id: 'need',
          beat: 'need',
          sourceText: 'The protagonist needs to tell the truth.',
          targetEpisodeNumber: 1,
          requiredRealization: ['scene_turn', 'final_prose'],
          eventAtoms: ['The protagonist needs to tell the truth.'],
          targetSceneIds: ['s1-1'],
          blockingLevel: 'structural',
        },
      ],
    });

    expect(profile.primaryTurn.source).toBe('coldOpenProfile');
    expect(profile.sourceContractIds).toEqual(expect.arrayContaining(['you', 'need']));
    expect(profile.capacity.beatBudget.recommended).toBeGreaterThanOrEqual(6);
    expect(profile.conflictDiagnostics).toEqual([]);
  });

  it('routes broad plan-level pressure away from SceneWriter prompt obligations', () => {
    const scene: SceneConstructionSceneLike = {
      id: 's2-3',
      turnContract: {
        turnId: 'turn',
        source: 'planner',
        centralTurn: 'Mara refuses the invitation and loses access to the archive.',
        beforeState: 'Mara can still choose comfort.',
        turnEvent: 'Mara refuses the invitation and loses access to the archive.',
        afterState: 'The archive becomes closed to her.',
        handoff: 'She needs another way in.',
      },
      seasonPromiseContracts: [{
        id: 'season-future-thread',
        sourceText: 'This remains a future season arc anchor and possible ending route.',
        contractKind: 'future_open_thread',
        requiredRealization: ['metadata'],
        targetEpisodeNumbers: [2],
        targetSceneIds: ['s2-3'],
        blockingLevel: 'warning',
      }],
      authoredTreatmentFields: [{
        id: 'local-field',
        episodeNumber: 2,
        fieldName: 'Immediate pressure',
        sourceText: 'Mara refuses the invitation and loses access to the archive.',
        contractKind: 'pressure_lane',
        requiredRealization: ['final_prose'],
        targetSceneIds: ['s2-3'],
        blockingLevel: 'treatment',
      }],
    };

    attachSceneConstructionProfiles([scene]);
    const view = buildSceneConstructionPromptView(scene);

    expect(view.authoredTreatmentFields?.map((item) => item.id)).toEqual(['local-field']);
    expect(view.seasonPromiseContracts).toEqual([]);
    expect(scene.seasonPromiseContracts).toHaveLength(1);
  });

  it('reports incompatible hard time obligations before prose generation', () => {
    const issues = collectSceneConstructionProfileIssues([{
      id: 's3-2',
      order: 1,
      requiredBeats: [
        {
          id: 'morning',
          tier: 'authored',
          sourceTurn: 'At dawn, the protagonist unlocks the studio.',
          mustDepict: 'At dawn, the protagonist unlocks the studio.',
        },
        {
          id: 'midnight',
          tier: 'authored',
          sourceTurn: 'At midnight, the protagonist burns the contract.',
          mustDepict: 'At midnight, the protagonist burns the contract.',
        },
      ],
    }]);

    expect(issues.join(' ')).toContain('multiple time cues');
  });

  it('normalizes one primary turn that spans multiple explicit time cues to the first scene-local clause', () => {
    const scene: SceneConstructionSceneLike = {
      id: 's3-3',
      order: 1,
      turnContract: {
        turnId: 'single-turn',
        source: 'planner',
        centralTurn: 'At 4am the narrator publishes the account, and by evening the public response forces a choice.',
        beforeState: 'The account is private testimony.',
        turnEvent: 'The account becomes public pressure.',
        afterState: 'The narrator has to answer for it.',
        handoff: 'Move into the consequence.',
      },
    };
    const profile = compileSceneConstructionProfile(scene);
    scene.sceneConstructionProfile = profile;
    const issues = collectSceneConstructionProfileIssues([scene]);

    expect(profile.primaryTurn.text).toBe('At 4am the narrator publishes the account');
    expect(issues.join(' ')).not.toContain('multiple time cues');
  });

  it('does not count proper-name time words as time cues', () => {
    const issues = collectSceneConstructionProfileIssues([{
      id: 's3-4',
      order: 1,
      turnContract: {
        turnId: 'named-time-turn',
        source: 'planner',
        centralTurn: 'At 4am the narrator writes Dating After Dusk under the codename Mr. Midnight.',
        beforeState: 'The account is private testimony.',
        turnEvent: 'At 4am the narrator writes Dating After Dusk under the codename Mr. Midnight.',
        afterState: 'The narrator has made a public mask.',
        handoff: 'Move into the consequence.',
      },
    }]);

    expect(issues.join(' ')).not.toContain('multiple time cues');
  });

  it('keeps broad multi-time mechanic pressure out of active scene support', () => {
    const profile = compileSceneConstructionProfile({
      id: 's3-5',
      order: 1,
      turnContract: {
        turnId: 'local-turn',
        source: 'planner',
        centralTurn: 'At the rooftop table, the witness notices the stranger by the kitchen.',
        beforeState: 'The room feels anonymous.',
        turnEvent: 'At the rooftop table, the witness notices the stranger by the kitchen.',
        afterState: 'The stranger has become a question.',
        handoff: 'Move into the walk home.',
      },
      mechanicPressure: [{
        id: 'broad-pressure',
        source: 'treatment',
        domain: 'information',
        function: 'plant',
        mechanicRef: {},
        storyPressure: 'At the rooftop table, the witness notices the stranger by the kitchen. Walking home at midnight, the witness is attacked. At 4am the witness publishes the account, and by evening the public response forces a choice.',
        evidenceRequired: ['Keep the full episode chain visible.'],
        visibleResidue: [],
        allowedPayoffs: [],
        blockedPayoffs: [],
      }],
    });

    expect(profile.conflictDiagnostics).toEqual([]);
    expect(profile.obligations.find((item) => item.id === 'broad-pressure')?.slot).toBe('metadata_only');
  });

  it('routes cold-open Story Circle atoms that do not serve the collision out of active prose obligations', () => {
    const scene: SceneConstructionSceneLike = {
      id: 's1-1',
      episodeNumber: 1,
      coldOpenProfile: {
        id: 'cold-open:1:s1-1',
        episodeNumber: 1,
        sceneId: 's1-1',
        mode: 'new_normal',
        archetype: 'status_quo_shift',
        storyCircleBeats: ['you', 'need'],
        storyCircleFulfillment: {
          beats: ['you', 'need'],
          combinedBeats: ['you', 'need'],
          baseline: 'A traveler arrives in a new city carrying visible private hurt.',
          need: 'The traveler needs to author the next move instead of only observing.',
          collision: 'A traveler arrives in a new city carrying visible private hurt and is immediately pressured to author the next move.',
          sourceContractIds: ['episode-circle-you', 'episode-circle-need'],
        },
        centralTurn: 'A traveler arrives in a new city with two suitcases and has to decide whether to cross the threshold.',
        microConflict: 'The traveler wants anonymity, but the threshold demands a visible choice.',
        openQuestion: 'Will the traveler stay hidden or step into the city?',
        activeCastLimit: 2,
        beatBudget: { min: 6, recommended: 8, max: 10 },
        exitHook: 'End on the threshold.',
        sourceContractIds: ['episode-circle-you', 'episode-circle-need', 'arrival', 's1-1-story-circle-you-baseline'],
        selectedConcepts: [],
      },
      requiredBeats: [
        {
          id: 'arrival',
          tier: 'coldopen',
          sourceTurn: 'A traveler arrives in a new city with two suitcases.',
          mustDepict: 'A traveler arrives in a new city with two suitcases.',
        },
        {
          id: 's1-1-story-circle-you-baseline',
          tier: 'authored',
          sourceTurn: 'A wounded observer arrives with two suitcases.',
          mustDepict: 'A wounded observer arrives with two suitcases.',
        },
        {
          id: 's1-1-story-circle-you-social',
          tier: 'authored',
          sourceTurn: 'The traveler forms a new circle at a rooftop table.',
          mustDepict: 'The traveler forms a new circle at a rooftop table.',
        },
        {
          id: 's1-1-story-circle-you-public-account',
          tier: 'authored',
          sourceTurn: 'The traveler starts a public account under a codename.',
          mustDepict: 'The traveler starts a public account under a codename.',
        },
        {
          id: 's1-1-story-circle-you-named-project',
          tier: 'authored',
          sourceTurn: 'The traveler starts The Night Ledger.',
          mustDepict: 'The traveler starts The Night Ledger.',
        },
      ],
      storyCircleBeatContracts: [
        {
          id: 'episode-circle-you',
          beat: 'you',
          sourceText: 'A traveler arrives in a new city carrying visible private hurt.',
          targetEpisodeNumber: 1,
          requiredRealization: ['scene_turn', 'final_prose'],
          eventAtoms: ['A traveler arrives in a new city carrying visible private hurt.'],
          targetSceneIds: ['s1-1'],
          blockingLevel: 'structural',
        },
        {
          id: 'episode-circle-need',
          beat: 'need',
          sourceText: 'The traveler needs to author the next move instead of only observing.',
          targetEpisodeNumber: 1,
          requiredRealization: ['scene_turn', 'final_prose'],
          eventAtoms: ['The traveler needs to author the next move.'],
          targetSceneIds: ['s1-1'],
          blockingLevel: 'structural',
        },
      ],
    };
    const profile = compileSceneConstructionProfile(scene);
    scene.sceneConstructionProfile = profile;
    const view = buildSceneConstructionPromptView(scene);

    expect(profile.conflictDiagnostics).toEqual([]);
    expect(profile.obligations.find((item) => item.id === 's1-1-story-circle-you-baseline')?.slot).toBe('must_support');
    expect(profile.obligations.find((item) => item.id === 's1-1-story-circle-you-social')?.slot).toBe('route_later');
    expect(profile.obligations.find((item) => item.id === 's1-1-story-circle-you-public-account')?.slot).toBe('route_later');
    expect(profile.obligations.find((item) => item.id === 's1-1-story-circle-you-named-project')?.slot).toBe('route_later');
    expect(view.requiredBeats?.map((beat) => beat.id)).toEqual(['arrival', 's1-1-story-circle-you-baseline']);
  });

  it('normalizes broad cold-open turn contracts and routes later event cues out of the opening scene', () => {
    const scene: SceneConstructionSceneLike = {
      id: 's1-1',
      episodeNumber: 1,
      coldOpenProfile: {
        id: 'cold-open:1:s1-1',
        episodeNumber: 1,
        sceneId: 's1-1',
        mode: 'new_normal',
        archetype: 'status_quo_shift',
        storyCircleBeats: ['you', 'need'],
        storyCircleFulfillment: {
          beats: ['you', 'need'],
          combinedBeats: ['you', 'need'],
          baseline: 'A traveler arrives in a new city with two suitcases.',
          need: 'The traveler needs to stop hiding behind observation.',
          collision: 'Arrival in a new city pressures the traveler to stop hiding.',
          sourceContractIds: ['episode-circle-you', 'episode-circle-need'],
        },
        centralTurn: 'A traveler arrives in a new city, starting a private club and a public account from a safe distance.',
        microConflict: 'The traveler wants anonymity, but the new city demands a visible choice.',
        openQuestion: 'Will the traveler cross the threshold?',
        activeCastLimit: 2,
        beatBudget: { min: 6, recommended: 8, max: 10 },
        exitHook: 'End at the threshold.',
        sourceContractIds: ['arrival', 'club', 'account', 'episode-circle-you', 'episode-circle-need'],
        selectedConcepts: [],
      },
      turnContract: {
        turnId: 's1-1-turn',
        source: 'planner',
        centralTurn: 'A traveler arrives in a new city, starting a private club and a public account from a safe distance.',
        beforeState: 'The traveler is unknown.',
        turnEvent: 'A traveler arrives in a new city, starting a private club and a public account from a safe distance.',
        afterState: 'The city becomes possible.',
        handoff: 'Move to the later social scene.',
      },
      requiredBeats: [
        {
          id: 'arrival',
          tier: 'coldopen',
          sourceTurn: 'A traveler arrives in a new city with two suitcases.',
          mustDepict: 'A traveler arrives in a new city with two suitcases.',
        },
        {
          id: 'club',
          tier: 'authored',
          sourceTurn: 'The traveler forms a private club at a rooftop table.',
          mustDepict: 'The traveler forms a private club at a rooftop table.',
        },
        {
          id: 'account',
          tier: 'authored',
          sourceTurn: 'The traveler starts a public account under a codename.',
          mustDepict: 'The traveler starts a public account under a codename.',
        },
      ],
      authoredTreatmentFields: [{
        id: 'episode-chain',
        episodeNumber: 1,
        fieldName: 'Episode movement',
        sourceText: 'The traveler arrives in a new city, then forms a private club at a rooftop table, then starts a public account under a codename.',
        contractKind: 'pressure_lane',
        requiredRealization: ['final_prose'],
        targetSceneIds: ['s1-1'],
        blockingLevel: 'treatment',
      }],
    };

    const profile = compileSceneConstructionProfile(scene);
    scene.sceneConstructionProfile = profile;
    const view = buildSceneConstructionPromptView(scene);

    expect(profile.primaryTurn.text).toBe('A traveler arrives in a new city');
    expect(profile.obligations.find((item) => item.id === 'club')?.slot).toBe('route_later');
    expect(profile.obligations.find((item) => item.id === 'account')?.slot).toBe('route_later');
    expect(profile.obligations.find((item) => item.id === 'episode-chain')?.slot).toBe('metadata_only');
    expect(view.requiredBeats?.map((beat) => beat.id)).toEqual(['arrival']);
    expect(view.authoredTreatmentFields).toEqual([]);
  });

  it('routes incompatible cold-open choice pressure out of authoring', () => {
    const scene: SceneConstructionSceneLike = {
      id: 's1-1',
      episodeNumber: 1,
      coldOpenProfile: {
        id: 'cold-open:1:s1-1',
        episodeNumber: 1,
        sceneId: 's1-1',
        mode: 'new_normal',
        archetype: 'status_quo_shift',
        storyCircleBeats: ['you', 'need'],
        storyCircleFulfillment: {
          beats: ['you', 'need'],
          combinedBeats: ['you', 'need'],
          baseline: 'A traveler reaches a locked apartment with visible private hurt.',
          need: 'The traveler needs to cross the threshold instead of only observing.',
          collision: 'The locked threshold forces the traveler to stop only observing.',
          sourceContractIds: ['episode-circle-you', 'episode-circle-need'],
        },
        centralTurn: 'A traveler arrives at a locked apartment with two suitcases.',
        microConflict: 'The traveler wants anonymity, but the locked door demands action.',
        openQuestion: 'Will the traveler cross the threshold?',
        activeCastLimit: 1,
        beatBudget: { min: 6, recommended: 8, max: 10 },
        exitHook: 'End on the locked door opening.',
        sourceContractIds: ['arrival'],
        selectedConcepts: [],
      },
      choicePoint: {
        description: 'Choose how to form a new circle at a rooftop table.',
        stakes: {
          want: 'Find allies at the rooftop table.',
          cost: 'Skip the locked apartment threshold.',
          identity: 'Become someone who builds a public circle before entering the apartment.',
        },
      },
    };

    const profile = compileSceneConstructionProfile(scene);
    scene.sceneConstructionProfile = profile;
    const view = buildSceneConstructionPromptView(scene);

    expect(profile.obligations.find((item) => item.source === 'choicePressure')?.slot).toBe('route_later');
    expect(view.choicePoint).toBeUndefined();
  });

  it('preserves generation-critical choice points even without active choice-pressure obligations', () => {
    const scene: SceneConstructionSceneLike = {
      id: 's1-4',
      episodeNumber: 1,
      turnContract: {
        turnId: 's1-4-turn',
        source: 'planner',
        centralTurn: 'At dawn the protagonist publishes the first public dispatch.',
        beforeState: 'The dispatch is still private.',
        turnEvent: 'At dawn the protagonist publishes the first public dispatch.',
        afterState: 'The dispatch becomes public pressure.',
        handoff: 'The public consequence carries into the next scene.',
      },
      choicePoint: {
        type: 'dilemma',
        description: 'Choose how to confront the stranger at the remote station.',
        stakes: {
          want: 'Confront the stranger at the station.',
          cost: 'Lose the dispatch.',
          identity: 'Choose confrontation instead of authorship.',
        },
        optionHints: [],
        setsTreatmentSeeds: ['treatment_seed_ep1_2'],
      },
    };

    const profile = compileSceneConstructionProfile(scene);
    scene.sceneConstructionProfile = profile;
    const view = buildSceneConstructionPromptView(scene);

    expect(profile.obligations.find((item) => item.source === 'choicePressure')?.slot).toBe('route_later');
    expect(view.choicePoint?.type).toBe('dilemma');
    expect(view.choicePoint?.setsTreatmentSeeds).toEqual(['treatment_seed_ep1_2']);
  });

  it('fails active multi-location construction before prose generation', () => {
    const issues = collectSceneConstructionProfileIssues([{
      id: 's1-2',
      order: 1,
      locations: ['Apartment'],
      turnContract: {
        turnId: 'home-turn',
        source: 'planner',
        centralTurn: 'At the apartment, the protagonist opens the inherited letter.',
        beforeState: 'The letter is still sealed.',
        turnEvent: 'At the apartment, the protagonist opens the inherited letter.',
        afterState: 'The address inside becomes a problem.',
        handoff: 'Move toward the social venue.',
      },
      requiredBeats: [{
        id: 'venue-meet',
        tier: 'authored',
        sourceTurn: 'At the rooftop bar, the protagonist forms a new circle.',
        mustDepict: 'At the rooftop bar, the protagonist forms a new circle.',
      }],
    }]);

    expect(issues.join(' ')).toContain('major location cue');
  });

  it('does not count alternate planned scene locations as active prose locations', () => {
    const issues = collectSceneConstructionProfileIssues([{
      id: 's1-2',
      order: 1,
      locations: ['Rooftop Bar', 'Apartment', 'Bookshop', 'Estate', 'Garden'],
      turnContract: {
        turnId: 'local-turn',
        source: 'planner',
        centralTurn: 'At a rooftop bar, the protagonist notices the stranger near the kitchen.',
        beforeState: 'The room feels anonymous.',
        turnEvent: 'At a rooftop bar, the protagonist notices the stranger near the kitchen.',
        afterState: 'The stranger has become a question.',
        handoff: 'Move into the walk home.',
      },
      mechanicPressure: [{
        id: 'relationship-texture',
        source: 'treatment',
        domain: 'relationship',
        function: 'plant',
        mechanicRef: {},
        storyPressure: 'Show guarded warmth and reciprocity before naming the bond.',
        evidenceRequired: ['One small exchange changes how the protagonist reads the room.'],
        visibleResidue: [],
        allowedPayoffs: [],
        blockedPayoffs: [],
      }],
    }]);

    expect(issues.join(' ')).not.toContain('major location cue');
  });

  it('does not fail multi-location construction from same-turn support context alone', () => {
    const profile = compileSceneConstructionProfile({
      id: 's1-venue',
      order: 1,
      location: 'Rooftop Bar',
      turnContract: {
        turnId: 'venue-turn',
        source: 'planner',
        centralTurn: 'At the rooftop bar, the traveler notices a stranger near the service door.',
        beforeState: 'The room feels anonymous.',
        turnEvent: 'At the rooftop bar, the traveler notices a stranger near the service door.',
        afterState: 'The stranger has become a question.',
        handoff: 'Move into the walk home.',
      },
      authoredTreatmentFields: [{
        id: 'context-route',
        episodeNumber: 1,
        fieldName: 'Context',
        sourceText: 'The traveler came from the station, reaches the rooftop bar, and later walks through the park.',
        contractKind: 'pressure_lane',
        requiredRealization: ['final_prose'],
        targetSceneIds: ['s1-venue'],
        blockingLevel: 'treatment',
      }],
    });

    expect(profile.conflictDiagnostics.join(' ')).not.toContain('major location cue');
  });

  it('counts a qualified single-place location label as one spatial anchor', () => {
    // Live FP (Phase 7 smoke, 2026-07-01): "Rooftop bar in Lipscani" was mined
    // for two cues (rooftop bar + lipscani) and aborted three straight Story
    // Architect attempts even though the scene sits in one place.
    const issues = collectSceneConstructionProfileIssues([{
      id: 's1-2',
      order: 1,
      location: 'Rooftop bar in Lipscani',
      turnContract: {
        turnId: 'venue-turn',
        source: 'planner',
        centralTurn: 'At a rooftop bar she catches the attention of a man in a charcoal suit and a rougher man near the kitchen.',
        beforeState: 'The room feels anonymous.',
        turnEvent: 'At a rooftop bar she catches the attention of a man in a charcoal suit and a rougher man near the kitchen.',
        afterState: 'The stranger has become a question.',
        handoff: 'Move into the walk home.',
      },
      requiredBeats: [{
        id: 'venue-meet',
        tier: 'authored',
        sourceTurn: 'At a rooftop bar she catches the attention of a man in a charcoal suit and a rougher man near the kitchen.',
        mustDepict: 'At a rooftop bar she catches the attention of a man in a charcoal suit and a rougher man near the kitchen.',
      }],
    }]);

    expect(issues.join(' ')).not.toContain('major location cue');
  });

  it('does not mine an itinerary-style location label for extra major locations', () => {
    const issues = collectSceneConstructionProfileIssues([{
      id: 's1-2',
      order: 1,
      location: 'Rooftop bar, then the walk home through Cismigiu to her Lipscani apartment threshold',
      turnContract: {
        turnId: 'venue-turn',
        source: 'planner',
        centralTurn: 'At a rooftop bar she catches the attention of a man in a charcoal suit and a rougher man near the kitchen.',
        beforeState: 'The room feels anonymous.',
        turnEvent: 'At a rooftop bar she catches the attention of a man in a charcoal suit and a rougher man near the kitchen.',
        afterState: 'The stranger has become a question.',
        handoff: 'Move into the walk home.',
      },
    }]);

    expect(issues.join(' ')).not.toContain('major location cue');
  });

  it('names the conflicting cues so architect retry feedback is actionable', () => {
    const issues = collectSceneConstructionProfileIssues([{
      id: 's1-2',
      order: 1,
      locations: ['Apartment'],
      turnContract: {
        turnId: 'home-turn',
        source: 'planner',
        centralTurn: 'At the apartment, the protagonist opens the inherited letter.',
        beforeState: 'The letter is still sealed.',
        turnEvent: 'At the apartment, the protagonist opens the inherited letter.',
        afterState: 'The address inside becomes a problem.',
        handoff: 'Move toward the social venue.',
      },
      requiredBeats: [{
        id: 'venue-meet',
        tier: 'authored',
        sourceTurn: 'At the rooftop bar, the protagonist forms a new circle.',
        mustDepict: 'At the rooftop bar, the protagonist forms a new circle.',
      }],
    }]);

    const joined = issues.join(' ');
    expect(joined).toContain('major location cue');
    expect(joined).toContain('apartment');
    expect(joined).toContain('rooftop bar');
  });

  it('does not count city containers or aliases as multi-location overload', () => {
    const issues = collectSceneConstructionProfileIssues([{
      id: 's1-park',
      order: 1,
      locations: ['Cismigiu Gardens'],
      turnContract: {
        turnId: 'park-turn',
        source: 'planner',
        centralTurn: 'In Bucharest, the protagonist walks through Cismigiu.',
        beforeState: 'The city feels anonymous.',
        turnEvent: 'In Bucharest, the protagonist walks through Cismigiu.',
        afterState: 'The park feels watchful.',
        handoff: 'Carry the unease forward.',
      },
      requiredBeats: [{
        id: 'park-signal',
        tier: 'authored',
        sourceTurn: 'Through Cismigiu Gardens, a shadow crosses the path.',
        mustDepict: 'Through Cismigiu Gardens, a shadow crosses the path.',
      }],
    }]);

    expect(issues.join(' ')).not.toContain('major location cue');
  });

  it('routes broad multi-event support out of active required prompt view', () => {
    const scene: SceneConstructionSceneLike = {
      id: 's1-arrival',
      episodeNumber: 1,
      turnContract: {
        turnId: 'arrival-turn',
        source: 'planner',
        centralTurn: 'The traveler arrives in the city with two suitcases.',
        beforeState: 'The traveler is still outside the city.',
        turnEvent: 'The traveler arrives in the city with two suitcases.',
        afterState: 'The city has become personal.',
        handoff: 'Move toward the social threshold.',
      },
      mechanicPressure: [{
        id: 'broad-episode-pressure',
        source: 'treatment',
        domain: 'information',
        function: 'plant',
        mechanicRef: {},
        storyPressure: 'The traveler arrives, meets a circle at a rooftop bar, is attacked in the park, writes a post at 4am, and goes viral by evening.',
        evidenceRequired: ['show the public signal on-page'],
        visibleResidue: [],
        allowedPayoffs: [],
        blockedPayoffs: [],
      }],
    };

    const profile = compileSceneConstructionProfile(scene);
    scene.sceneConstructionProfile = profile;
    const view = buildSceneConstructionPromptView(scene);

    expect(profile.obligations.find((item) => item.id === 'broad-episode-pressure')?.slot).toBe('metadata_only');
    expect(view.mechanicPressure ?? []).toEqual([]);
  });

  it('keeps cold-open premise pressure out of hard required-beat enforcement', () => {
    const scene: SceneConstructionSceneLike = {
      id: 's1-1',
      episodeNumber: 1,
      coldOpenProfile: {
        id: 'cold-open:1:s1-1',
        episodeNumber: 1,
        sceneId: 's1-1',
        mode: 'new_normal',
        archetype: 'status_quo_shift',
        storyCircleBeats: ['you', 'need'],
        storyCircleFulfillment: {
          beats: ['you', 'need'],
          combinedBeats: ['you', 'need'],
          baseline: 'A traveler arrives with a visible private wound.',
          need: 'The traveler needs to stop only observing.',
          collision: 'Arrival pressure forces the traveler to stop only observing.',
          sourceContractIds: ['episode-circle-you', 'episode-circle-need'],
        },
        centralTurn: 'A traveler arrives at the station with two suitcases.',
        microConflict: 'The traveler wants anonymity, but the station demands a visible choice.',
        openQuestion: 'Will the traveler stay hidden or cross the threshold?',
        activeCastLimit: 2,
        beatBudget: { min: 6, recommended: 8, max: 10 },
        exitHook: 'End at the threshold.',
        sourceContractIds: ['arrival', 'premise-pressure', 'episode-circle-you', 'episode-circle-need'],
        selectedConcepts: [],
      },
      requiredBeats: [
        {
          id: 'arrival',
          tier: 'coldopen',
          sourceTurn: 'A traveler arrives at the station with two suitcases.',
          mustDepict: 'A traveler arrives at the station with two suitcases.',
        },
        {
          id: 'premise-pressure',
          tier: 'coldopen',
          sourceTurn: "Starting 'The Night Ledger'. Their mask is the witty observer; their rut is letting other people define them. The recurring pressure is their need to rebuild a life.",
          mustDepict: "Starting 'The Night Ledger'. Their mask is the witty observer; their rut is letting other people define them. The recurring pressure is their need to rebuild a life.",
        },
      ],
      storyCircleBeatContracts: [
        {
          id: 'episode-circle-you',
          beat: 'you',
          sourceText: 'A traveler arrives with a visible private wound.',
          targetEpisodeNumber: 1,
          requiredRealization: ['scene_turn', 'final_prose'],
          eventAtoms: ['A traveler arrives with a visible private wound.'],
          targetSceneIds: ['s1-1'],
          blockingLevel: 'structural',
        },
        {
          id: 'episode-circle-need',
          beat: 'need',
          sourceText: 'The traveler needs to stop only observing.',
          targetEpisodeNumber: 1,
          requiredRealization: ['scene_turn', 'final_prose'],
          eventAtoms: ['The traveler needs to stop only observing.'],
          targetSceneIds: ['s1-1'],
          blockingLevel: 'structural',
        },
      ],
    };

    const profile = compileSceneConstructionProfile(scene);
    scene.sceneConstructionProfile = profile;
    const view = buildSceneConstructionPromptView(scene);

    expect(profile.obligations.find((item) => item.id === 'premise-pressure')?.slot).toBe('texture');
    expect(view.requiredBeats?.map((beat) => beat.id)).toEqual(['arrival']);
    expect(view.storyCircleBeatContracts?.map((contract) => contract.id)).toEqual(
      expect.arrayContaining(['episode-circle-you', 'episode-circle-need']),
    );
  });

  it('mutates resumed scene contracts so routed broad beats do not reach preflight', () => {
    const scene: SceneConstructionSceneLike = {
      id: 's1-1',
      episodeNumber: 1,
      order: 1,
      turnContract: {
        turnId: 'arrival-turn',
        source: 'planner',
        centralTurn: 'A traveler arrives at the inherited apartment with two suitcases.',
        beforeState: 'The traveler is still outside the threshold.',
        turnEvent: 'A traveler arrives at the inherited apartment with two suitcases.',
        afterState: 'The threshold becomes unavoidable.',
        handoff: 'Move to the social threshold later.',
      },
      requiredBeats: [
        {
          id: 'arrival',
          tier: 'authored',
          sourceTurn: 'A traveler arrives at the inherited apartment with two suitcases.',
          mustDepict: 'A traveler arrives at the inherited apartment with two suitcases.',
        },
        {
          id: 'project-logline',
          tier: 'authored',
          sourceTurn: 'She starts Dating After Dusk.',
          mustDepict: 'She starts Dating After Dusk.',
        },
      ],
    };

    const result = applySceneConstructionProfilesToScenes([scene], { episodeNumber: 1 });

    expect(result.applications[0].drainedRequiredBeatIds).toContain('project-logline');
    expect(scene.requiredBeats?.map((beat) => beat.id)).toEqual(['arrival']);
    expect(scene.nonCopyableContext?.map((item) => item.id)).toContain('demoted-required-beat:project-logline');
  });

  it('keeps playable authored episode turns required instead of demoting them to context', () => {
    const scene: SceneConstructionSceneLike = {
      id: 's1-2',
      episodeNumber: 1,
      order: 2,
      turnContract: {
        turnId: 'explore-turn',
        source: 'planner',
        centralTurn: 'She explores the streets of Bucharest.',
        beforeState: 'She has unpacked and is restless in the apartment.',
        turnEvent: 'She explores the streets of Bucharest.',
        afterState: 'The city feels alive and unfamiliar.',
        handoff: 'She reaches the bookshop.',
      },
      requiredBeats: [
        {
          id: 's1-2-rb1',
          tier: 'authored',
          sourceTurn: 'She explores the streets of Bucharest.',
          mustDepict: 'She explores the streets of Bucharest.',
        },
      ],
    };

    const result = applySceneConstructionProfilesToScenes([scene], { episodeNumber: 1 });

    expect(result.applications[0].drainedRequiredBeatIds).not.toContain('s1-2-rb1');
    expect(scene.requiredBeats?.map((beat) => beat.id)).toContain('s1-2-rb1');
  });

  it('drains non-opening cold-open required beats from resumed blueprints', () => {
    const scenes: SceneConstructionSceneLike[] = [
      {
        id: 's1-cold-open',
        episodeNumber: 1,
        order: 0,
        coldOpenProfile: {
          id: 'cold-open:1:s1-cold-open',
          episodeNumber: 1,
          sceneId: 's1-cold-open',
          mode: 'new_normal',
          archetype: 'status_quo_shift',
          storyCircleBeats: ['you', 'need'],
          storyCircleFulfillment: {
            beats: ['you', 'need'],
            baseline: 'A traveler arrives wounded.',
            need: 'The traveler needs to act.',
            collision: 'Arrival forces action.',
            sourceContractIds: ['you', 'need'],
          },
          centralTurn: 'A traveler reaches the city threshold.',
          microConflict: 'The traveler wants anonymity, but the threshold demands action.',
          openQuestion: 'Will the traveler cross?',
          activeCastLimit: 1,
          beatBudget: { min: 6, recommended: 8, max: 10 },
          exitHook: 'End on the threshold.',
          sourceContractIds: ['you', 'need'],
          selectedConcepts: [],
        },
        requiredBeats: [{
          id: 'opening-arrival',
          tier: 'coldopen',
          sourceTurn: 'A traveler reaches the city threshold.',
          mustDepict: 'A traveler reaches the city threshold.',
        }],
      },
      {
        id: 's1-later',
        episodeNumber: 1,
        order: 1,
        turnContract: {
          turnId: 'later-turn',
          source: 'planner',
          centralTurn: 'A guide opens the next door.',
          beforeState: 'The traveler is alone.',
          turnEvent: 'A guide opens the next door.',
          afterState: 'The traveler has a way forward.',
          handoff: 'Enter the next scene.',
        },
        requiredBeats: [{
          id: 'duplicate-cold-open',
          tier: 'coldopen',
          sourceTurn: 'A traveler reaches the city threshold.',
          mustDepict: 'A traveler reaches the city threshold.',
        }],
      },
    ];

    const result = applySceneConstructionProfilesToScenes(scenes, { episodeNumber: 1 });

    expect(result.applications[1].drainedRequiredBeatIds).toContain('duplicate-cold-open');
    expect(scenes[1].requiredBeats).toEqual([]);
    expect(scenes[1].nonCopyableContext?.map((item) => item.id)).toContain('demoted-required-beat:duplicate-cold-open');
  });

  it('renders one focused construction contract for the prompt', () => {
    const profile = compileSceneConstructionProfile({
      id: 's1-1',
      turnContract: {
        turnId: 'turn',
        source: 'planner',
        centralTurn: 'The witness burns the clean page before answering.',
        beforeState: 'The record feels safe.',
        turnEvent: 'The witness burns the clean page before answering.',
        afterState: 'The record can no longer protect anyone.',
        handoff: 'The next answer matters.',
      },
      mechanicPressure: [{
        id: 'info-pressure',
        source: 'treatment',
        domain: 'information',
        function: 'plant',
        mechanicRef: {},
        storyPressure: 'The burned page makes testimony costly.',
        evidenceRequired: ['The witness burns the page.'],
        visibleResidue: ['The protagonist must listen instead of write.'],
        allowedPayoffs: [],
        blockedPayoffs: [],
      }],
    });
    const out = buildSceneConstructionProfileSection({ sceneConstructionProfile: profile });

    expect(out).toContain('SCENE CONSTRUCTION CONTRACT');
    expect(out).toContain('Primary turn');
    expect(out).toContain('Active obligations serving this turn');
    expect(out).toContain('one dramatic center');
  });
});

describe('duplicate-text obligation flooding (bite-me 2026-07-03T18-26-54 s1-3 regression)', () => {
  it('demotes same-text treatment atoms to metadata_only so they do not occupy active slots', () => {
    // The same treatment event atomized from N source sections arrives as N
    // distinct atom ids with identical text; only the first may hold an
    // active slot.
    const scene = {
      id: 's1-3',
      episodeNumber: 1,
      kind: 'standard',
      title: 'Rooftop',
      dramaticPurpose: 'At a rooftop bar she catches the attention of a man in a charcoal suit.',
      turnContract: {
        turnId: 's1-3-turn', source: 'treatment',
        centralTurn: 'At a rooftop bar she catches the attention of a man in a charcoal suit.',
        turnEvent: 'At a rooftop bar she catches the attention of a man in a charcoal suit.',
        beforeState: 'x', afterState: 'x', handoff: 'x',
      },
      treatmentAtomIds: ['a1', 'a2', 'a3', 'a4'],
      nonCopyableContext: [
        { id: 'a1', eventText: 'Kylie forms the Dusk Club with Mika, Stela over velvet booths' },
        { id: 'a2', eventText: 'Kylie forms the Dusk Club with Mika, Stela over velvet booths' },
        { id: 'a3', eventText: 'Kylie forms the Dusk Club with Mika, Stela over velvet booths' },
        { id: 'a4', eventText: 'Kylie forms the Dusk Club with Mika, Stela over velvet booths' },
      ],
    } as never;

    attachSceneConstructionProfiles([scene]);
    const profile = (scene as { sceneConstructionProfile?: { obligations: Array<{ slot: string; text: string; mergedInto?: string }> } }).sceneConstructionProfile;
    const duskActive = (profile?.obligations ?? []).filter(
      (o) => /dusk club/i.test(o.text) && (o.slot === 'must_stage' || o.slot === 'must_support') && !o.mergedInto,
    );
    expect(duskActive).toHaveLength(1);

    const section = buildSceneConstructionProfileSection(scene as never);
    const mentions = (section.match(/Dusk Club/gi) ?? []).length;
    expect(mentions).toBeLessThanOrEqual(1);
  });

  it('fuzzy-merges near-duplicate arrival suitcase atoms and demotes opening wound atoms (bite-me 2026-07-08 s1-1)', () => {
    const profile = compileSceneConstructionProfile({
      id: 's1-1',
      episodeNumber: 1,
      kind: 'standard',
      coldOpenProfile: {
        id: 'cold-open:1:s1-1',
        episodeNumber: 1,
        sceneId: 's1-1',
        mode: 'sharp_disruption',
        archetype: 'in_media_res',
        storyCircleBeats: ['you'],
        storyCircleFulfillment: {
          beats: ['you'],
          combinedBeats: ['you'],
          baseline: 'Kylie arrives.',
          disruption: 'Kylie arrives in Bucharest.',
          collision: 'She explores the streets of Bucharest',
          sourceContractIds: [],
        },
        activeCastLimit: 2,
        centralTurn: 'She explores the streets of Bucharest',
        exitHook: 'The city does not stay merely scenic.',
        sourceContractIds: [],
      },
      turnContract: {
        turnId: 's1-1-turn',
        source: 'treatment',
        centralTurn: 'She explores the streets of Bucharest',
        turnEvent: 'She explores the streets of Bucharest',
        beforeState: 'Before.',
        afterState: 'After.',
        handoff: 'Handoff.',
      },
      requiredBeats: [{
        id: 's1-1-hook1',
        tier: 'coldopen',
        sourceTurn: 'Kylie Marinescu arrives in Bucharest',
        mustDepict: 'Kylie Marinescu arrives in Bucharest',
      }, {
        id: 's1-1-rb2',
        tier: 'authored',
        sourceTurn: 'She explores the streets of Bucharest',
        mustDepict: 'She explores the streets of Bucharest',
      }],
      treatmentAtomIds: [
        's1-1-char-character-char-kylie-marinescu-wound-pressure-5-atom-2',
        's1-1-ep1-information-movement-3-kylie-arrives-atom-1',
        's1-1-story-circle-you-part-1-atom-1',
      ],
      nonCopyableContext: [
        {
          id: 's1-1-char-character-char-kylie-marinescu-wound-pressure-5-atom-2',
          eventText: "Her grandmother Veronica's unexplained escape from Bucharest also left an unfinished family story.",
        },
        {
          id: 's1-1-ep1-information-movement-3-kylie-arrives-atom-1',
          eventText: "Kylie arrives in Bucharest with two suitcases and her grandmother's address.",
        },
        {
          id: 's1-1-story-circle-you-part-1-atom-1',
          eventText: "Kylie Marinescu arrives in Bucharest with two suitcases, her grandmother's address",
        },
      ],
      authoredTreatmentFields: [{
        id: 'ep1-information-movement-3',
        sourceText: "Kylie arrives in Bucharest with two suitcases and her grandmother's address.",
        requiredRealization: ['scene_turn', 'final_prose'],
      }],
      characterTreatmentContracts: [{
        id: 'character-char-kylie-marinescu-wound-pressure-5',
        contractKind: 'wound_pressure',
        sourceText: 'A publicly cancelled engagement. Her grandmother Veronica left an unfinished family story.',
        targetSceneIds: ['s1-1'],
        requiredRealization: ['scene_turn'],
        blockingLevel: 'structural',
      }],
    } as never);

    expect(profile.capacity.hardUnits).toBeLessThanOrEqual(profile.capacity.maxHardUnits);
    const hardAtoms = profile.obligations.filter(
      (item) => item.source === 'treatmentAtom' && item.hardUnits >= 1 && item.slot === 'must_stage',
    );
    expect(hardAtoms).toHaveLength(0);
  });

  it('preserves relationshipPacing contracts through construction-profile compaction', () => {
    const mikaContract = {
      id: 's1-3-rel-mika',
      source: 'planner' as const,
      npcId: 'char-mika-dragan',
      startStage: 'acquaintance' as const,
      targetStage: 'acquaintance' as const,
      allowedLabels: ['guarded warmth'],
      blockedLabels: ['friend'],
      requiredEvidence: ['show reciprocity'],
      minScenesSinceIntroduction: 0,
      maxDeltaThisScene: 8,
      mechanicDimensions: ['trust', 'respect'] as Array<'trust' | 'respect'>,
    };
    const stelaContract = {
      id: 's1-3-rel-stela',
      source: 'planner' as const,
      npcId: 'char-stela-pavel',
      startStage: 'spark' as const,
      targetStage: 'acquaintance' as const,
      allowedLabels: ['invitation'],
      blockedLabels: ['friend'],
      requiredEvidence: ['show behavior before naming the bond'],
      minScenesSinceIntroduction: 0,
      maxDeltaThisScene: 8,
      mechanicDimensions: ['trust'] as Array<'trust'>,
    };
    const scene: SceneConstructionSceneLike = {
      id: 's1-3',
      episodeNumber: 1,
      order: 3,
      npcsPresent: ['char-mika-dragan', 'char-stela-pavel'],
      turnContract: {
        turnId: 's1-3-turn',
        source: 'planner',
        centralTurn: 'Kylie confesses the blog to Mika at the table.',
        beforeState: 'The secret is still private.',
        turnEvent: 'Kylie confesses the blog to Mika at the table.',
        afterState: 'Mika knows the truth.',
        handoff: 'The night continues.',
      },
      relationshipPacing: [mikaContract, stelaContract],
      requiredBeats: [{
        id: 'confession',
        tier: 'authored',
        sourceTurn: 'Kylie confesses the blog to Mika at the table.',
        mustDepict: 'Kylie confesses the blog to Mika at the table.',
      }],
    };

    applySceneConstructionProfilesToScenes([scene], { episodeNumber: 1 });
    const view = buildSceneConstructionPromptView(scene);

    expect(scene.relationshipPacing).toEqual([mikaContract, stelaContract]);
    expect(view.relationshipPacing).toEqual([mikaContract, stelaContract]);
  });
});
