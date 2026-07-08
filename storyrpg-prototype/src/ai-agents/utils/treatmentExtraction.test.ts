import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { extractTreatmentFromMarkdown } from './treatmentExtraction';

const TREATMENT_WITH_LITERAL_FACTS = `# Branching-Narrative Season Treatment

## 9. Episode Outline

### Episode 1: Mr. Midnight
- Story Circle role: you
- Episode promise: Kylie learns the blog can change her life.
- Synopsis: Kylie publishes the Mr. Midnight post; by 6pm it has 80,000 reads and brand deals start appearing in her inbox.
- Cliffhanger question: who left the black roses?

### Episode 3: The Name on the Chain
- Story Circle role: go
- Episode promise: the club glamour starts leaking family history.
- Synopsis: Marinescu recognizes Kylie's grandmother Veronica by her maiden name and the gold chain in Kylie's bag.
- Cliffhanger question: why does Victor vanish from the photograph?
`;

describe('extractTreatmentFromMarkdown literal episode anchors', () => {
  it('preserves authored social-proof numbers and named lineage facts without making them scene-driving episode turns', () => {
    const treatment = extractTreatmentFromMarkdown(TREATMENT_WITH_LITERAL_FACTS);

    expect(treatment.episodes[1]?.episodeTurns ?? []).not.toContain(
      'by 6pm it has 80,000 reads and brand deals start appearing in her inbox.',
    );
    expect(treatment.episodes[3]?.episodeTurns ?? []).not.toContain(
      "Marinescu recognizes Kylie's grandmother Veronica by her maiden name and the gold chain in Kylie's bag.",
    );
    expect(treatment.episodes[1]?.consequenceSeeds).toContain(
      'by 6pm it has 80,000 reads and brand deals start appearing in her inbox.',
    );
    expect(treatment.episodes[3]?.consequenceSeeds).toContain(
      "Marinescu recognizes Kylie's grandmother Veronica by her maiden name and the gold chain in Kylie's bag.",
    );
    expect(treatment.episodes[1]?.informationMovement).toContain('80,000 reads');
    expect(treatment.episodes[3]?.informationMovement).toContain('Veronica');
  });
});

describe('extractTreatmentFromMarkdown MVP treatment format', () => {
  it('preserves Bite Me episode 1 authored event order from the supplied MVP treatment', () => {
    const markdown = readFileSync(
      resolve(process.cwd(), '../treatments/Bite_Me_MVP_Treatment.md'),
      'utf8',
    );
    const treatment = extractTreatmentFromMarkdown(markdown);
    const turns = treatment.episodes[1]?.episodeTurns ?? [];
    const joined = turns.join('\n');
    const indexOf = (pattern: RegExp): number => turns.findIndex((turn) => pattern.test(turn));

    const valcescuIndex = indexOf(/V[âa]lcescu|key\s*card|Mika/i);
    const stelaIndex = indexOf(/Stela|bookshop|quartz/i);
    const rooftopIndex = indexOf(/rooftop|Victor/i);
    const parkIndex = indexOf(/Ci[sș]migiu|park|attack|rescues?/i);
    const blogIndex = indexOf(/4\s*a\.?m\.?|blog|viral|80,?000/i);

    expect(treatment.isTreatment).toBe(true);
    expect(treatment.metadata.formatVersion).toBe('story-treatment-mvp');
    expect(joined).toContain('Vâlcescu');
    expect(joined).toContain('Stela');
    expect(joined).toContain('Victor');
    expect(joined).toContain('80,000');
    expect([valcescuIndex, stelaIndex, rooftopIndex, parkIndex, blogIndex].every((index) => index >= 0)).toBe(true);
    expect(valcescuIndex).toBeLessThan(stelaIndex);
    expect(stelaIndex).toBeLessThan(rooftopIndex);
    expect(rooftopIndex).toBeLessThan(parkIndex);
    expect(parkIndex).toBeLessThan(blogIndex);
  });
});

const LITE_TREATMENT = `# StoryRPG Lite Treatment

## 1. Story Premise

- **Title:** The Bell Below
- **Genre:** gothic mystery
- **Tone:** intimate dread
- **High concept pitch:** The Ring meets Chinatown in a drowned town where names can kill.
- **Logline:** A drowned-town archivist must decide whether to ring the bell that can expose the living and wake the dead.
- **Core fantasy:** Read forbidden records, bargain with ghosts, and choose what kind of witness survives.
- **Themes:** memory, complicity, inheritance
- **Audience promise:** Every rescue should feel like it disturbs an older silence.

## 2. Story Circle Season Spine

- **You (Ep1):** Mara keeps the drowned archive catalogued and refuses to read the sealed bell ledger.
- **Need (Ep1):** She needs to admit the archive protects powerful families more than it protects the dead.
- **Go (Ep2):** She rings the bell to save Jonas and the town hears a name it buried.
- **Search (Ep3):** Mara follows ghost testimony through the drained streets.
- **Find (Ep4):** The ledger proves her mother helped write the false history.
- **Take (Ep5):** Jonas is marked as payment for the truth she forced open.
- **Return (Ep6):** Mara brings the ledger to the town hall during the flood vigil.
- **Change (Ep6):** She chooses public witness over private control.

## 3. Story Arcs

### Arc: The Bell Ledger

- **Episode range:** Episodes 1-3
- **Story Circle span:** you through search
- **Arc question:** Can Mara turn private evidence into public courage?
- **Pressure movement:** The archive shifts from sanctuary to loaded weapon.
- **Protagonist polarity:** You vs Go: cataloguing safely versus ringing the bell in public.
- **Key NPC/location pressure:** Jonas and the drowned archive make silence feel merciful.
- **Handoff:** The ghost testimony points toward Mara's mother.

## 4. Protagonist Brief

- **Name and pronouns:** Mara Vale, she/her
- **Role in the world:** Archivist of the drowned town records.
- **Want:** Keep Jonas alive and the archive intact.
- **Need:** Let truth become public even when it ruins her family.
- **Lie or survival posture:** If she controls the record, she controls the damage.
- **Wound or origin pressure:** Her mother taught her that names can kill.
- **Truth or possible transformation:** Witnessing is not ownership.
- **Starting identity:** Careful keeper of dangerous facts.
- **Possible end states:** public witness; private fixer; exile with the ghosts.
- **Visual identity:** Salt-stained coat, copper glasses, ink on her fingers.

## 5. Major NPC Briefs

### NPC: Jonas Reed

- **Role:** ally and threatened witness
- **Want:** Keep his sister's name out of the ledger.
- **Leverage:** He knows where the bell chain was hidden.
- **Secret or contradiction:** He helped forge one page to protect family.
- **Relationship to protagonist:** Childhood friend with frayed trust.
- **How choices can change them:** He can become witness, accomplice, or accuser.
- **Voice / visual notes:** Plainspoken, damp work gloves, avoids looking at the bell.

## 6. World And Location Brief

- **World premise:** A half-flooded town survives by editing which dead are remembered.
- **Time period:** 1920s coastal gothic.
- **Rules that create drama:** Bells call legal ghosts; iron seals testimony; public names carry debt.
- **Key locations:** Drowned archive - purpose: records, mood: tidal hush, choice pressure: expose or hide names.

## 7. Episode Outline

### Episode 1: The Sealed Bell

- **Story Circle role:** you + need
- **High-level description:** Mara finds Jonas breaking into the archive at low tide. The sealed bell ledger names his sister as dead before she died. Mara must decide whether to protect Jonas or preserve the record. The episode ends with the bell chain moving by itself.
- **Major pressure:** Mara must choose between controlled silence and public risk.
- **Likely consequence:** Jonas's trust becomes conditional and the archive is no longer safe.

### Episode 2: The Name It Buried

- **Story Circle role:** go
- **High-level description:** Mara rings the bell to stop a ghost court from taking Jonas. The town hears the hidden name over the harbor. A council patron offers protection if Mara surrenders the ledger.
- **Major pressure:** A private rescue becomes a public accusation.
- **Likely consequence:** The town treats Mara as a threat and Jonas becomes legally exposed.

## 8. Alternate Endings

### Ending 1: The Witness

Mara publishes the ledger and accepts exile from the archive. Jonas lives, but their friendship has to rebuild without secrets. This ending pays off repeated choices toward public truth and shared cost.

### Ending 2: The Keeper

Mara hides the ledger and becomes the new private broker of names. Jonas is safe for now, but every saved person owes her silence. This ending pays off repeated choices toward control and secrecy.

### Ending 3: The Bell-Ringer

Mara rings every hidden name and lets the ghosts judge the town. The living lose their clean histories, and Mara becomes a witness neither side can fully claim. This ending pays off repeated choices toward dangerous collective reckoning.
`;

describe('extractTreatmentFromMarkdown lite treatment format', () => {
  it('parses lite treatment metadata, anchors, arcs, episodes, and endings', () => {
    const treatment = extractTreatmentFromMarkdown(LITE_TREATMENT);

    expect(treatment.isTreatment).toBe(true);
    expect(treatment.metadata.formatVersion).toBe('story-treatment-lite');
    expect(treatment.seasonGuidance?.treatmentMode).toBe('lite');
    expect(treatment.seasonGuidance?.highConceptPitch).toBe(
      'The Ring meets Chinatown in a drowned town where names can kill.',
    );
    expect(treatment.seasonGuidance?.storyCircleBeatEpisodeAnchors).toEqual({
      you: 1,
      need: 1,
      go: 2,
      search: 3,
      find: 4,
      take: 5,
      return: 6,
      change: 6,
    });

    expect(treatment.seasonGuidance?.arcGuidance?.arcs).toHaveLength(1);
    expect(treatment.seasonGuidance?.arcGuidance?.arcs[0]).toMatchObject({
      title: 'The Bell Ledger',
      episodeRange: { start: 1, end: 3 },
      storyCircleSpanText: 'you through search',
      arcDramaticQuestion: 'Can Mara turn private evidence into public courage?',
      pressureMovement: 'The archive shifts from sanctuary to loaded weapon.',
      protagonistPolarity: 'You vs Go: cataloguing safely versus ringing the bell in public.',
      keyNpcLocationPressure: 'Jonas and the drowned archive make silence feel merciful.',
      handoffPressure: "The ghost testimony points toward Mara's mother.",
      sourceKind: 'authored_lite',
    });

    expect(treatment.episodes[1]?.sourceKind).toBe('authored_lite');
    expect(treatment.episodes[1]?.authoredTitle).toBe('The Sealed Bell');
    expect(treatment.episodes[1]?.rawStoryCircleRole).toBe('you + need');
    expect(treatment.episodes[1]?.synopsis).toContain('Mara finds Jonas');
    expect(treatment.episodes[1]?.episodePromise).toContain('controlled silence');
    expect(treatment.episodes[1]?.encounterCentralConflict).toContain('controlled silence');
    expect(treatment.episodes[1]?.encounterAnchors).toEqual([
      'Mara must choose between controlled silence and public risk.',
    ]);
    expect(treatment.episodes[1]?.endingPressure).toContain('archive is no longer safe');
    expect(treatment.episodes[1]?.consequenceSeeds).toEqual(
      expect.arrayContaining([expect.stringContaining('archive is no longer safe')]),
    );
    expect(treatment.episodes[1]?.episodeTurns?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(treatment.episodes[1]?.episodeTurns?.some((turn) => /explores|finds Jonas|bell chain/i.test(turn))).toBe(true);

    expect(treatment.seasonGuidance?.protagonistGuidance?.visualIdentity).toContain('Salt-stained coat');
    expect(treatment.seasonGuidance?.npcGuidance?.some((npc) =>
      npc.name === 'Jonas Reed' && /damp work gloves/i.test(npc.visualIdentity || ''),
    )).toBe(true);

    expect(treatment.endings).toHaveLength(3);
    expect(treatment.endings.map((ending) => ending.name)).toEqual([
      'The Witness',
      'The Keeper',
      'The Bell-Ringer',
    ]);
    expect(treatment.endings[0]?.repeatedChoicePattern).toBeUndefined();
    expect(treatment.endings[0]?.summary).toContain('publishes the ledger');
  });
});
