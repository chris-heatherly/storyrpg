import { describe, expect, it } from 'vitest';
import { npcSignatureDetails } from './npcSignatureDetails';
import type { CharacterProfile } from '../agents/CharacterDesigner';

describe('npcSignatureDetails (B1)', () => {
  it('collects distinctive features, attire, capped tics, and one signature line', () => {
    const profile = {
      distinctiveFeatures: ['platinum bob', 'stag-crest signet ring'],
      typicalAttire: 'charcoal silk suits',
      voiceProfile: {
        verbalTics: ['iubita mea', 'draga', 'a third tic never included'],
        signatureLines: ['The night is a menu, my dear.', 'second line never included'],
      },
    } as unknown as CharacterProfile;
    expect(npcSignatureDetails(profile)).toEqual([
      'platinum bob',
      'stag-crest signet ring',
      'typical attire: charcoal silk suits',
      'verbal tic: "iubita mea"',
      // Cap of 5: the second tic makes 5; the signature line is dropped.
      'verbal tic: "draga"',
    ]);
  });

  it('returns undefined for missing profile or empty details', () => {
    expect(npcSignatureDetails(undefined)).toBeUndefined();
    expect(npcSignatureDetails({ distinctiveFeatures: [], typicalAttire: ' ' } as unknown as CharacterProfile)).toBeUndefined();
  });
});
