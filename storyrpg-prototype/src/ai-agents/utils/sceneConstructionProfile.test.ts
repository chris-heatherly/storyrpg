import { describe, expect, it } from 'vitest';

import type { SceneConstructionSceneLike } from './sceneConstructionProfile';
import {
  attachSceneConstructionProfiles,
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

  it('allows one primary turn to span time without inventing a split conflict', () => {
    const issues = collectSceneConstructionProfileIssues([{
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
    }]);

    expect(issues.join(' ')).not.toContain('multiple time cues');
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
    expect(view.requiredBeats?.map((beat) => beat.id)).toEqual(['arrival', 's1-1-story-circle-you-baseline']);
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
