import { describe, expect, it } from 'vitest';
import type { Story } from '../../types';
import { buildContinuityBlogPublishRepairHandler, repairBlogPublishContinuity } from './continuityBlogPublishRepairHandler';

function story(): Story {
  return {
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
      scenes: [{
        id: 's1-6',
        name: 'Drafting the Post',
        startingBeatId: 's1-6-beat-5',
        beats: [
          { id: 's1-6-beat-4', text: 'You type: Mr. Midnight.' },
          { id: 's1-6-beat-5', text: "You hit 'Publish'. The screen refreshes. 'Dating After Dusk' is live." },
          { id: 's1-6-beat-6', text: 'When you wake, the post has eighty-thousand reads.' },
        ],
        choices: [{ id: 'choice-keep', text: 'Keep writing.', nextSceneId: 's1-9' }],
      }],
    }],
  } as unknown as Story;
}

describe('buildContinuityBlogPublishRepairHandler', () => {
  it('converts a premature publish and viral readout into draft prose only', async () => {
    const s = story();
    const result = await buildContinuityBlogPublishRepairHandler()({
      story: s,
      blockingIssues: [{
        validator: 'ContinuityChecker',
        type: 'continuity_error',
        sceneId: 's1-6',
        message: "Continuity contradiction: Kylie publishes the blog post 'Dating After Dusk' in scene s1-6, beat s1-6-beat-5.",
      }],
    });

    const scene = result.story.episodes[0].scenes[0];
    expect(result.changed).toBe(true);
    expect(scene.beats[1].text).toContain("save a private draft titled 'Mr. Midnight");
    expect(scene.beats[1].text).not.toMatch(/\bhit\s+['"]?publish|is live/i);
    expect(scene.beats[2].text).toContain('draft is still waiting');
    expect(scene.choices?.[0].nextSceneId).toBe('s1-9');
  });

  it('uses structured scene and beat ids when continuity wording omits the beat', async () => {
    const s = story();
    const result = await buildContinuityBlogPublishRepairHandler()({
      story: s,
      blockingIssues: [{
        validator: 'ContinuityChecker',
        type: 'continuity_error',
        sceneId: 's1-6',
        beatId: 's1-6-beat-5',
        message: "Continuity timeline_error: Kylie publishes her blog post 'Dating After Dusk' with the name 'Mr. Midnight' in scene s1-6. However, scene s1-9 depicts her publishing it again.",
      }],
    });

    const scene = result.story.episodes[0].scenes[0];
    expect(result.changed).toBe(true);
    expect(scene.beats[1].text).toContain("save a private draft titled 'Mr. Midnight");
    expect(scene.beats[2].text).toContain('draft is still waiting');
  });

  it('clarifies ambiguous draft wording that QA can misread as two post titles', async () => {
    const s = story();
    s.episodes[0].scenes[0].beats![1].text = "You stop short of publishing. Instead, you save the draft under Dating After Dusk: 'Mr. Midnight,' the title bright and dangerous on the screen.";
    const result = await buildContinuityBlogPublishRepairHandler()({
      story: s,
      blockingIssues: [{
        validator: 'ContinuityChecker',
        type: 'continuity_error',
        sceneId: 's1-6',
        beatId: 's1-6-beat-5',
        message: "Continuity contradiction: Kylie publishes her blog post 'Dating After Dusk' with the title 'Mr. Midnight.'",
      }],
    });

    const beatText = result.story.episodes[0].scenes[0].beats![1].text || '';
    expect(result.changed).toBe(true);
    expect(beatText).toContain("save a private draft titled 'Mr. Midnight");
    expect(beatText).toContain("titled 'Mr. Midnight");
    expect(beatText).not.toContain('Dating After Dusk');
  });

  it('clarifies later publication prose so the blog name is not treated as the post title', async () => {
    const s = story();
    s.episodes[0].scenes[0].beats!.push({
      id: 's1-9-beat-5',
      text: "You type the title—*Dating After Dusk*. The post—*Mr. Midnight*. The mouse cursor trembles over the 'Publish' button.",
    });
    const result = await buildContinuityBlogPublishRepairHandler()({
      story: s,
      blockingIssues: [{
        validator: 'ContinuityChecker',
        type: 'continuity_error',
        sceneId: 's1-6',
        beatId: 's1-6-beat-5',
        message: "Continuity contradiction: Kylie publishes her blog post 'Dating After Dusk' with the title 'Mr. Midnight.'",
      }],
    });

    const clarified = result.story.episodes[0].scenes[0].beats!.find((beat) => beat.id === 's1-9-beat-5')?.text || '';
    expect(result.changed).toBe(true);
    expect(clarified).toContain('You open Dating After Dusk');
    expect(clarified).toContain('post title: *Mr. Midnight*');
    expect(clarified).not.toContain('The post—');
  });

  it('repairs duplicate publish continuity even before a blocker is emitted', () => {
    const s = story();
    s.episodes[0].scenes.push({
      id: 's1-9',
      name: 'Publish',
      startingBeatId: 's1-9-beat-5',
      beats: [{
        id: 's1-9-beat-5',
        text: "Title: Dating After Dusk. Post: 'Mr. Midnight.' Your cursor hovers over the 'Publish' button.",
      }],
      choices: [],
    });

    const touched = repairBlogPublishContinuity(s);
    const beats = s.episodes[0].scenes[0].beats!;

    expect(touched).toBeGreaterThanOrEqual(3);
    expect(beats[1].text).toContain("save a private draft titled 'Mr. Midnight");
    expect(beats[2].text).toContain('draft is still waiting');
    expect(s.episodes[0].scenes[1].beats?.[0].text).toContain('post title');
  });

  it('repairs generated push-live wording before the later publish scene', () => {
    const s = story();
    s.episodes[0].scenes[0].beats![1].text = "Your finger hovers over the button. Not 'Save Draft.' 'Publish.' A single click to send this impossible night out into the world, a message in a bottle cast into the digital ocean. You close your eyes, take a breath, and push it live. The post is up. Exhausted, you finally fall into bed as first light touches the rooftops of Bucharest.";
    s.episodes[0].scenes[0].beats![2].text = "The morning light is fractured by the insistent, frantic buzz of your phone on the nightstand. You grab it. The lock screen is a waterfall of notifications—likes, shares, comments. A dozen texts from Mika, all caps. The 'Dating After Dusk' post didn't just get read; it goes viral. It's everywhere. Your pulse hammers as you see the view count climbing into the thousands.";
    s.episodes[0].scenes.push({
      id: 's1-9',
      name: 'Publish',
      startingBeatId: 's1-9-beat-5',
      beats: [
        {
          id: 's1-9-beat-5',
          text: "The draft sits finished in the 'Dating After Dusk' editor. Title: 'Mr. Midnight.' Your mouse cursor trembles over the 'Publish' button.",
        },
        {
          id: 's1-9-beat-6',
          text: "You click. The page refreshes, and the single word appears: 'Published.'",
        },
      ],
      choices: [],
    });

    const touched = repairBlogPublishContinuity(s);
    const draftSceneBeats = s.episodes[0].scenes[0].beats!;
    const publishSceneBeats = s.episodes[0].scenes[1].beats!;

    expect(touched).toBeGreaterThanOrEqual(2);
    expect(draftSceneBeats[1].text).toContain("save a private draft titled 'Mr. Midnight");
    expect(draftSceneBeats[1].text).not.toMatch(/\bpush\s+it\s+live|post\s+is\s+up|Publish/i);
    expect(draftSceneBeats[2].text).toContain('draft is still waiting');
    expect(draftSceneBeats[2].text).not.toMatch(/\bviral|view count|notifications/i);
    expect(publishSceneBeats[1].text).toContain('Published');
  });

  it('repairs an orphan viral readout after a publish beat was already changed to draft', () => {
    const s = story();
    s.episodes[0].scenes[0].beats![1].text = "You stop before the final click. Instead, you save a private draft titled 'Mr. Midnight,' the words bright and dangerous on the screen.";
    s.episodes[0].scenes[0].beats![2].text = "You fumble for your laptop, open the blog dashboard. The traffic analytic isn't a line, it's a sheer cliff face. Your post has gone viral. Comments are pouring in, hundreds a minute.";
    s.episodes[0].scenes.push({
      id: 's1-9',
      name: 'Publish',
      startingBeatId: 's1-9-beat-5',
      beats: [{
        id: 's1-9-beat-5',
        text: "Beneath the title—'Mr. Midnight'—the cursor pulses over the word 'Publish'.",
      }],
      choices: [],
    });

    const touched = repairBlogPublishContinuity(s);
    const beats = s.episodes[0].scenes[0].beats!;

    expect(touched).toBeGreaterThanOrEqual(1);
    expect(beats[1].text).toContain('private draft');
    expect(beats[2].text).toContain('draft is still waiting');
    expect(beats[2].text).not.toMatch(/\bviral|traffic analytic|comments are pouring/i);
  });

  it('ignores unrelated continuity findings', async () => {
    const s = story();
    const result = await buildContinuityBlogPublishRepairHandler()({
      story: s,
      blockingIssues: [{
        validator: 'ContinuityChecker',
        type: 'continuity_error',
        sceneId: 's1-6',
        message: 'Continuity contradiction: a character knows a future secret.',
      }],
    });

    expect(result.changed).toBe(false);
  });
});
