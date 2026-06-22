import { describe, expect, it } from 'vitest';
import type { Story } from '../../types/story';
import type { FinalStoryContractReport } from '../validators';
import { MechanicsLeakageValidator } from '../validators/MechanicsLeakageValidator';
import {
  applyTreatmentWarningRepairOutcome,
  reconcileQaReportForCurrentStory,
  repairDiceMetaphorMechanicsLeakage,
  repairVampireDaytimeMealCanon,
} from './finalContract';

function storyWithBeat(text: string): Story {
  return {
    id: 'story-1',
    title: 'Story',
    genre: 'test',
    synopsis: '',
    coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: [],
    episodes: [{
      id: 'ep1',
      number: 1,
      title: 'Episode 1',
      synopsis: '',
      coverImage: '',
      startingSceneId: 's1',
      scenes: [{
        id: 's1',
        name: 'Scene 1',
        startingBeatId: 'b1',
        beats: [{ id: 'b1', text }],
        choices: [],
      }],
    }],
  } as unknown as Story;
}

const passingReport = { passed: true, blockingIssues: [], warnings: [] } as unknown as FinalStoryContractReport;

describe('applyTreatmentWarningRepairOutcome', () => {
  it('discards failed advisory rewrites and preserves the original passing report', () => {
    const target = storyWithBeat('original prose');
    const candidate = storyWithBeat('bad advisory rewrite');

    const result = applyTreatmentWarningRepairOutcome(target, passingReport, {
      story: candidate,
      passed: false,
      report: {
        passed: false,
        blockingIssues: [{ validator: 'RequiredBeatRealizationValidator', message: 'new blocker' }],
      },
    });

    expect(result.committed).toBe(false);
    expect(result.report).toBe(passingReport);
    expect(target.episodes[0].scenes[0].beats?.[0].text).toBe('original prose');
  });

  it('commits advisory rewrites only when revalidation passes', () => {
    const target = storyWithBeat('original prose');
    const candidate = storyWithBeat('improved advisory rewrite');
    const repairedReport = { passed: true, blockingIssues: [], warnings: [] };

    const result = applyTreatmentWarningRepairOutcome(target, passingReport, {
      story: candidate,
      passed: true,
      report: repairedReport,
    });

    expect(result.committed).toBe(true);
    expect(result.report).toBe(repairedReport);
    expect(target.episodes[0].scenes[0].beats?.[0].text).toBe('improved advisory rewrite');
  });
});

describe('reconcileQaReportForCurrentStory', () => {
  it('removes stale blog-publish QA continuity errors after deterministic story repair', () => {
    const story = {
      id: 'bite-me',
      title: 'Bite Me',
      genre: 'paranormal romance',
      synopsis: '',
      coverImage: '',
      initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
      npcs: [],
      episodes: [{
        id: 'ep1',
        number: 1,
        title: 'Dating After Dusk',
        synopsis: '',
        coverImage: '',
        startingSceneId: 's1-6',
        scenes: [
          {
            id: 's1-6',
            name: 'Drafting the Post',
            startingBeatId: 's1-6-beat-5',
            beats: [
              { id: 's1-6-beat-5', text: "You stop before the final click. Instead, you save a private draft titled 'Mr. Midnight,' the words bright and dangerous on the screen." },
              { id: 's1-6-beat-6', text: 'When you wake, your phone has a handful of texts from Mika and a dozen ordinary emails. You open the blog dashboard and the draft is still waiting, unsent but alive enough to make your pulse jump.' },
            ],
            choices: [],
          },
          {
            id: 's1-9',
            name: 'Publish',
            startingBeatId: 's1-9-beat-5',
            beats: [
              { id: 's1-9-beat-5', text: "The post is titled 'Mr. Midnight.' Your blog, Dating After Dusk, waits. Your cursor blinks over the 'Publish' button." },
              { id: 's1-9-beat-6', text: "You click. The page refreshes, the single word 'Published' stark against the white background." },
            ],
            choices: [],
          },
        ],
      }],
    } as unknown as Story;

    const qaReport = {
      continuity: {
        overallScore: 70,
        issueCount: { errors: 1, warnings: 0, suggestions: 0 },
        issues: [{
          severity: 'error',
          type: 'timeline_error',
          location: { sceneId: 's1-6', beatId: 's1-6-beat-5' },
          description: "Kylie publishes the blog post 'Dating After Dusk' in s1-6-beat-5. However, in s1-9-beat-5, she publishes the same blog post again, titled 'Dating After Dusk', with the post 'Mr. Midnight.'",
          suggestedFix: 'Remove the blog publication from s1-6-beat-5 or s1-9-beat-5.',
          conflictsWith: 's1-9-beat-5',
        }],
        passedChecks: [],
        recommendations: [],
      },
      voice: { overallScore: 90, characterScores: [], issues: [], distinctionScore: 90, recommendations: [] },
      stakes: {
        overallScore: 90,
        choiceSetAnalysis: [],
        metrics: { averageStakesScore: 90, falseChoiceCount: 0, dilemmaQuality: 90, varietyScore: 90 },
        issues: [],
        strengths: [],
        recommendations: [],
      },
      overallScore: 83,
      passesQA: false,
      criticalIssues: ['1 continuity error(s)'],
      summary: '',
    };

    const reconciled = reconcileQaReportForCurrentStory(qaReport as never, story);

    expect(reconciled).not.toBe(qaReport);
    expect(reconciled?.continuity.issues).toEqual([]);
    expect(reconciled?.continuity.issueCount.errors).toBe(0);
    expect(reconciled?.criticalIssues).toEqual([]);
    expect(reconciled?.passesQA).toBe(true);
  });
});

describe('repairDiceMetaphorMechanicsLeakage', () => {
  it('rewrites safe dice metaphors without touching story structure', () => {
    const story = storyWithBeat('A tram rattles two streets over, a sound like dice in a wooden cup. You breathe.');
    const beat = story.episodes[0].scenes[0].beats![0];
    expect(new MechanicsLeakageValidator().validate({
      texts: [{ id: beat.id, text: beat.text, sceneId: 's1', beatId: beat.id }],
    }).valid).toBe(false);

    const touched = repairDiceMetaphorMechanicsLeakage(story);

    expect(touched).toBe(1);
    expect(beat.text).toContain('like pebbles in a wooden cup');
    expect(new MechanicsLeakageValidator().validate({
      texts: [{ id: beat.id, text: beat.text, sceneId: 's1', beatId: beat.id }],
    }).valid).toBe(true);
  });
});

describe('repairVampireDaytimeMealCanon', () => {
  it('moves Victor breakfast/brunch prose to night-appropriate supper language', () => {
    const story = storyWithBeat('It always comes back to that last Sunday breakfast with Victor. He waited until the brunch rush had subsided. It was over that breakfast he made his first soft play. He pushed the last of his poached egg around his plate with a silver fork, the motion slow, deliberate.');

    const touched = repairVampireDaytimeMealCanon(story);
    const text = story.episodes[0].scenes[0].beats![0].text;

    expect(touched).toBe(1);
    expect(text).toContain('last Sunday supper with Victor');
    expect(text).toContain('dinner rush');
    expect(text).toContain('over that supper');
    expect(text).toContain('untouched wineglass');
    expect(text).not.toMatch(/\bbreakfast|brunch|poached egg\b/i);
  });

  it('repairs Victor brunch invitations and surrounding daytime cues across a scene', () => {
    const story = storyWithBeat('“Trending.” Mika gestures with her mimosa, the sunlight flashing off her rings. “And here you are, brunch at The Solstice with Victor Ciorba himself.”');
    story.episodes[0].scenes[0].beats!.push({ id: 'b2', text: 'Mika turns back to the brunch crowd.' } as never);

    const touched = repairVampireDaytimeMealCanon(story);
    const text = story.episodes[0].scenes[0].beats!.map((beat) => beat.text).join(' ');

    expect(touched).toBe(2);
    expect(text).toContain('coupe');
    expect(text).toContain('candlelight');
    expect(text).toContain('late supper at The Solstice with Victor Ciorba');
    expect(text).toContain('supper crowd');
    expect(text).not.toMatch(/\bbrunch|mimosa|sunlight\b/i);
  });
});
