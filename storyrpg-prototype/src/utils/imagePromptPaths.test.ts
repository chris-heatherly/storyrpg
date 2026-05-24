import { describe, expect, it } from 'vitest';
import { resolvePromptUrlFromImageUrl } from './imagePromptPaths';

describe('resolvePromptUrlFromImageUrl', () => {
  it('maps flat generated images to flat prompt artifacts', () => {
    expect(
      resolvePromptUrlFromImageUrl(
        'http://localhost:3001/generated-stories/bite-me-redux/images/beat-episode-1-scene-3-beat-4.png'
      )
    ).toBe(
      'http://localhost:3001/generated-stories/bite-me-redux/images/prompts/beat-episode-1-scene-3-beat-4.json'
    );
  });

  it('maps nested storyboard panels to flat prompt artifacts', () => {
    expect(
      resolvePromptUrlFromImageUrl(
        'http://localhost:3001/generated-stories/bite-me-redux/images/storyboard-v2/panels/storyboard-v2-story-beat-episode-1-scene-3-beat-1-uprez-20260521.png'
      )
    ).toBe(
      'http://localhost:3001/generated-stories/bite-me-redux/images/prompts/storyboard-v2-story-beat-episode-1-scene-3-beat-1-uprez-20260521.json'
    );
  });

  it('maps relative generated image paths the same way', () => {
    expect(
      resolvePromptUrlFromImageUrl(
        'generated-stories/bite-me-redux/images/storyboard-v2/panels/storyboard-v2-story-beat-episode-1-scene-3-beat-1.png'
      )
    ).toBe(
      'generated-stories/bite-me-redux/images/prompts/storyboard-v2-story-beat-episode-1-scene-3-beat-1.json'
    );
  });
});
