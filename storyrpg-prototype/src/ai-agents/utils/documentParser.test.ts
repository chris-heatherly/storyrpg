import { describe, expect, it } from 'vitest';
import { parseDocument } from './documentParser';

describe('parseDocument markdown metadata', () => {
  it('prefers an explicit authored title over a generic format heading', () => {
    const result = parseDocument(`# StoryRPG Lite Treatment

- **Title:** Bite Me
- **Genre:** Gothic romantic comedy

## Synopsis
Kylie returns to Bucharest and discovers the night remembers her.`);

    expect(result.success).toBe(true);
    expect(result.document?.title).toBe('Bite Me');
    expect(result.document?.genre).toBe('Gothic romantic comedy');
    expect(result.brief?.story.title).toBe('Bite Me');
  });

  it('represents unparsed identity as missing instead of realistic fallback data', () => {
    const result = parseDocument(`# Numbered Treatment

## 4. Character Focus
The viewpoint belongs to someone established later by source analysis.`);

    expect(result.success).toBe(true);
    expect(result.document?.protagonistName).toBeUndefined();
    expect(result.document?.protagonistPronouns).toBeUndefined();
    expect(result.brief?.protagonist).toMatchObject({ name: '', pronouns: 'they/them' });
  });
});
