import { describe, expect, it } from 'vitest';
import { filterAnalysisForEpisodeRange, refreshAnalysisFromTreatmentDocument } from './treatmentRefresh';

describe('filterAnalysisForEpisodeRange', () => {
  it('normalizes episode aliases and removes duplicate parenthetical character refs', () => {
    const events: string[] = [];
    const analysis: any = {
      sourceTitle: 'Bite Me',
      totalEstimatedEpisodes: 8,
      episodeBreakdown: [
        {
          episodeNumber: 1,
          title: 'Dating After Dusk',
          locations: [
            "Kylie's Lipscani Apartment",
            'Vâlcescu Club (Exterior)',
            'Lumina Books',
            'Rooftop Bar',
            'Cișmigiu Gardens',
          ],
          mainCharacters: ['Kylie Marinescu', 'Mika Drăgan', 'Stela Pavel', 'Victor Vâlcescu', 'Radu Stoian'],
          supportingCharacters: [],
        },
        {
          episodeNumber: 2,
          title: 'Mr. Midnight',
          locations: ["Kylie's Lipscani Apartment", 'Vâlcescu Club', 'Mountain Road / Roadside Diner'],
          mainCharacters: ['Kylie Marinescu', 'Victor Vâlcescu', 'Radu Stoian', 'Mika Drăgan', 'Stela Pavel'],
          supportingCharacters: [],
        },
        {
          episodeNumber: 3,
          title: 'The Weekend',
          locations: [
            'Casa Stelarum (Rose Garden, Ballroom, Powder Room, Hedge Maze, Breakfast Table)',
            "Kylie's Lipscani Apartment (Doorstep and Courtyard)",
          ],
          mainCharacters: [
            'Kylie Marinescu',
            'Victor Vâlcescu',
            'Mika Drăgan',
            'Ileana',
            'Stela Pavel (via text)',
            'Radu Stoian (off-screen presence)',
          ],
          supportingCharacters: [],
        },
      ],
      keyLocations: [
        { id: 'loc-vâlcescu-club', name: 'Vâlcescu Club', description: '', importance: 'major', firstAppearance: 1 },
        { id: 'loc-cișmigiu-gardens', name: 'Cișmigiu Gardens', description: '', importance: 'major', firstAppearance: 1 },
        { id: 'loc-casa-stelarum', name: 'Casa Stelarum', description: '', importance: 'major', firstAppearance: 3 },
        { id: 'loc-lumina-books', name: 'Lumina Books', description: '', importance: 'major', firstAppearance: 1 },
        { id: "loc-kylie's-apartment", name: "Kylie's Apartment", description: '', importance: 'major', firstAppearance: 4 },
      ],
      majorCharacters: [
        { id: 'char-victor-vlcescu', name: 'Victor Vâlcescu', role: 'antagonist', importance: 'core', firstAppearance: 1 },
        { id: 'char-radu-stoian', name: 'Radu Stoian', role: 'love_interest', importance: 'core', firstAppearance: 1 },
        { id: 'char-mika-drgan', name: 'Mika Drăgan', role: 'rival', importance: 'core', firstAppearance: 1 },
        { id: 'char-stela-pavel', name: 'Stela Pavel', role: 'ally', importance: 'core', firstAppearance: 1 },
        { id: 'char-ileana', name: 'Ileana', role: 'neutral', importance: 'supporting', firstAppearance: 3 },
        { id: 'char-stela-pavel-via-text', name: 'Stela Pavel (via text)', role: 'neutral', importance: 'supporting', firstAppearance: 3 },
        { id: 'char-radu-stoian-off-screen-presence', name: 'Radu Stoian (off-screen presence)', role: 'neutral', importance: 'supporting', firstAppearance: 3 },
      ],
    };

    const filtered = filterAnalysisForEpisodeRange(
      analysis,
      { start: 1, end: 3 },
      [1, 2, 3],
      (event) => events.push(event.message || ''),
    );

    expect(filtered.keyLocations.map((location: any) => location.name)).toEqual([
      'Vâlcescu Club',
      'Cișmigiu Gardens',
      'Casa Stelarum',
      'Lumina Books',
      "Kylie's Apartment",
    ]);
    expect(filtered.majorCharacters.map((character: any) => character.name)).toEqual([
      'Victor Vâlcescu',
      'Radu Stoian',
      'Mika Drăgan',
      'Stela Pavel',
      'Ileana',
    ]);
    expect(events.find((event) => event.startsWith('Filtered characters:'))).not.toContain('via text');
    expect(events.find((event) => event.startsWith('Filtered characters:'))).not.toContain('off-screen presence');
  });
});

describe('refreshAnalysisFromTreatmentDocument', () => {
  it('refreshes cached analysis from the latest lite treatment fields', () => {
    const sourceText = `
# StoryRPG Lite Treatment

## 1. Story Premise

- **Title:** The Bell Below
- **Genre:** gothic mystery
- **Tone:** intimate dread
- **High concept pitch:** The Ring meets Chinatown in a drowned town where names can kill.
- **Logline:** An archivist must decide whether to ring the bell below town hall.
- **Core fantasy:** Read forbidden records and choose what kind of witness survives.
- **Themes:** memory, complicity, inheritance
- **Audience promise:** Every rescue disturbs an older silence.

## 2. Story Circle Season Spine

- **You (Ep1):** Mara keeps the archive sealed.
- **Need (Ep1):** She must admit the archive protects the powerful.
- **Go (Ep2):** She rings the bell in public.
- **Search (Ep3):** She follows ghost testimony.
- **Find (Ep4):** The ledger implicates her mother.
- **Take (Ep5):** Jonas is marked as payment.
- **Return (Ep6):** Mara brings the ledger to town hall.
- **Change (Ep6):** She chooses public witness.

## 3. Story Arcs

### Arc: The Bell Ledger

- **Episode range:** Episodes 1-3
- **Story Circle span:** you through search
- **Arc question:** Can Mara turn private evidence into public courage?
- **Pressure movement:** The archive shifts from sanctuary to loaded weapon.
- **Protagonist polarity:** You vs Go: cataloguing safely versus ringing the bell in public.
- **Key NPC/location pressure:** Jonas and the drowned archive make silence feel merciful.
- **Handoff:** The ghost testimony points toward Mara's mother.

## 7. Episode Outline

### Episode 1: The Sealed Bell

- **Story Circle role:** you + need
- **High-level description:** Mara finds Jonas breaking into the archive at low tide. The sealed bell ledger names his sister as dead before she died.
- **Major pressure:** Mara must choose between controlled silence and public risk.
- **Likely consequence:** Jonas's trust becomes conditional and the archive is no longer safe.
`;
    const analysis: any = {
      sourceFormat: 'prompt',
      totalEstimatedEpisodes: 1,
      episodeBreakdown: [{
        episodeNumber: 1,
        title: 'Old stale title',
        synopsis: 'Stale cached synopsis.',
        sourceSummary: 'Stale cached summary.',
        narrativeFunction: {
          setup: 'stale setup',
          conflict: 'stale conflict',
          resolution: 'stale resolution',
        },
      }],
      majorCharacters: [{ id: 'mara', name: 'Mara Vale', importance: 'core' }],
    };

    const refreshed = refreshAnalysisFromTreatmentDocument(analysis, sourceText, () => {});
    const episode = refreshed.episodeBreakdown[0];

    expect(refreshed.sourceFormat).toBe('story_treatment');
    expect(refreshed.treatmentSeasonGuidance?.treatmentMode).toBe('lite');
    expect(refreshed.treatmentSeasonGuidance?.highConceptPitch).toBe(
      'The Ring meets Chinatown in a drowned town where names can kill.',
    );
    expect(refreshed.treatmentSeasonGuidance?.arcGuidance?.arcs[0]?.sourceKind).toBe('authored_lite');
    expect(episode.title).toBe('The Sealed Bell');
    expect(episode.synopsis).toContain('Mara finds Jonas');
    expect(episode.sourceSummary).toContain('Mara finds Jonas');
    expect(episode.treatmentGuidance?.sourceKind).toBe('authored_lite');
    expect(episode.treatmentGuidance?.episodePromise).toContain('controlled silence');
    expect(episode.treatmentGuidance?.endingPressure).toContain('archive is no longer safe');
  });

  it('repairs blank neutral character records from treatment character cards and architecture', () => {
    const sourceText = `
# Bite Me — StoryRPG Season Treatment

Story treatment for an interactive season.

## 1. Season Promise And Dramatic Engine

- **Season dramatic question:** Can Kylie keep her voice?

## 2. 3-Act / 7-Point Season Spine

- Hook (Ep1): Kylie arrives.

## 2b. Information Ledger

- Victor's nature: hidden.

### Episode 1: Dating After Dusk

- **Episode promise:** Kylie arrives.

## 3. Character Architecture

### Supporting Characters

- **Name:** Victor Vâlcescu ("Mr. Midnight")
- **Role:** Strigoi (vampire); mysterious savior in ep 1 → confident suitor → season antagonist by ep 6.
- **Name:** Radu Stoian ("The Mountain")
- **Role:** Pricolici (werewolf) of the Stoian pack near Bran; roadside meet-cute → sweet flirtation → real partner if Kylie chooses him.
- **Name:** Mika Drăgan
- **Role:** Succubus contracted to Victor, posing as Kylie's best friend and club handler.
- **Name:** Stela Pavel
- **Role:** Bookshop owner and Romani folk practitioner from a clan of strigoi hunters; secretly wards Kylie.
`;
    const analysis: any = {
      sourceFormat: 'prompt',
      totalEstimatedEpisodes: 1,
      episodeBreakdown: [{ episodeNumber: 1, title: 'Dating After Dusk' }],
      majorCharacters: [
        { id: 'char-victor-vlcescu', name: 'Victor Vâlcescu', role: 'neutral', importance: 'supporting', description: '', firstAppearance: 1 },
        { id: 'char-radu-stoian', name: 'Radu Stoian', role: 'neutral', importance: 'supporting', description: '', firstAppearance: 1 },
        { id: 'char-mika-drgan', name: 'Mika Drăgan', role: 'neutral', importance: 'supporting', description: '', firstAppearance: 1 },
        { id: 'char-stela-pavel', name: 'Stela Pavel', role: 'neutral', importance: 'supporting', description: '', firstAppearance: 1 },
      ],
      characterArchitecture: {
        protagonist: {},
        supportingCharacters: [
          { characterName: 'Victor Vâlcescu', pressureRole: 'temptation', screenTimeTier: 'major' },
          { characterName: 'Radu Stoian', pressureRole: 'foil', screenTimeTier: 'major' },
          { characterName: 'Mika Drăgan', pressureRole: 'mirror', screenTimeTier: 'major' },
          { characterName: 'Stela Pavel', pressureRole: 'ally', screenTimeTier: 'major' },
        ],
      },
    };

    const refreshed = refreshAnalysisFromTreatmentDocument(analysis, sourceText, () => {});

    expect(refreshed.majorCharacters.map((character: any) => ({
      name: character.name,
      role: character.role,
      importance: character.importance,
      hasDescription: character.description.length > 0,
    }))).toEqual([
      { name: 'Victor Vâlcescu', role: 'antagonist', importance: 'core', hasDescription: true },
      { name: 'Radu Stoian', role: 'love_interest', importance: 'core', hasDescription: true },
      { name: 'Mika Drăgan', role: 'rival', importance: 'core', hasDescription: true },
      { name: 'Stela Pavel', role: 'ally', importance: 'core', hasDescription: true },
    ]);
  });
});
