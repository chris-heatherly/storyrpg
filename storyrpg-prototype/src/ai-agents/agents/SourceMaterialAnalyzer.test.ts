import { describe, expect, it, vi, afterEach } from 'vitest';
import { BaseAgent } from './BaseAgent';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  containsSchemaPlaceholder,
  detectExplicitWritingStyleInstruction,
  normalizeAdaptationGuidance,
  normalizeCharacterFashionStyle,
  normalizeDirectLanguageFragments,
  normalizeSchemaAbstraction,
  normalizeSchemaVariableName,
  normalizeWritingStyleGuide,
  SourceMaterialAnalyzer,
} from './SourceMaterialAnalyzer';
import type { StoryAnchors, StorySchemaAbstraction } from '../../types/sourceAnalysis';
import { extractTreatmentFromMarkdown, looksLikeTreatmentMarkdown } from '../utils/treatmentExtraction';
import { checkStoryCircleCoverage } from '../utils/storyCircleDistribution';

const anchors: StoryAnchors = {
  stakes: 'The mountain village and the protagonist dignity.',
  goal: 'Find a cure before winter closes the pass.',
  incitingIncident: 'The village well turns black overnight.',
  climax: 'The protagonist confronts the keeper of the pass during the storm.',
};

describe('SourceMaterialAnalyzer schema abstraction helpers', () => {
  it('normalizes schema variable names to PascalCase without braces', () => {
    expect(normalizeSchemaVariableName('{emotional anchor location}')).toBe('EmotionalAnchorLocation');
    expect(normalizeSchemaVariableName('false-victory')).toBe('FalseVictory');
    expect(normalizeSchemaVariableName('')).toBe('StoryVariable');
  });

  it('detects external-style placeholders so they can be kept out of player prose', () => {
    expect(containsSchemaPlaceholder('{Goal}')).toBe(true);
    expect(containsSchemaPlaceholder('The Goal is named without braces.')).toBe(false);
  });

  it('adds required anchor variables and strips placeholder braces from metadata text', () => {
    const abstraction: StorySchemaAbstraction = {
      archetype: 'Temptation and Moral Cost',
      adaptationMode: 'inspired_by',
      schemaVariables: [
        {
          name: '{protagonist role}',
          description: 'The person chasing {Goal}.',
          examples: ['{Protagonist}'],
        },
      ],
      generalizationGuidance: ['Preserve {Temptation}, not the original setting.'],
      reusablePatternSummary: 'A pressured hero risks their {CoreValue}.',
    };

    const normalized = normalizeSchemaAbstraction(abstraction, anchors)!;

    expect(normalized.schemaVariables.map((variable) => variable.name)).toEqual(
      expect.arrayContaining(['ProtagonistRole', 'Stakes', 'Goal', 'IncitingIncident', 'Climax']),
    );
    expect(normalized.schemaVariables[0].description).toBe('The person chasing Goal.');
    expect(normalized.schemaVariables[0].examples).toEqual(['Protagonist']);
    expect(normalized.generalizationGuidance[0]).toBe('Preserve Temptation, not the original setting.');
  });

  it('falls back to inspired_by when the mode is outside StoryRPG values', () => {
    const normalized = normalizeSchemaAbstraction(
      {
        archetype: 'Unknown',
        adaptationMode: 'schema_chapters' as any,
        schemaVariables: [],
        generalizationGuidance: [],
        reusablePatternSummary: '',
      },
      anchors,
    )!;

    expect(normalized.adaptationMode).toBe('inspired_by');
  });
});

describe('SourceMaterialAnalyzer treatment extraction', () => {
  const treatment = readFileSync(join(__dirname, '../fixtures/bite-me-treatment.md'), 'utf8');
  const refreshedTreatment = readFileSync(join(__dirname, '../fixtures/refreshed-treatment.md'), 'utf8');

  it('extracts treatment episode guidance and exactly three endings', () => {
    const extracted = extractTreatmentFromMarkdown(treatment);

    expect(extracted.isTreatment).toBe(true);
    expect(Object.keys(extracted.episodes)).toHaveLength(8);
    expect(extracted.episodes[1]?.episodePromise).toContain('first fabulous night');
    expect(extracted.episodes[1]?.majorChoicePressures).toEqual(
      expect.arrayContaining([expect.stringContaining('Accept Mika')]),
    );
    expect(extracted.episodes[1]?.alternativePaths).toEqual(
      expect.arrayContaining([expect.stringContaining('quartz')]),
    );
    expect(extracted.episodes[1]?.consequenceSeeds).toEqual(
      expect.arrayContaining([expect.stringContaining('black roses')]),
    );
    expect(extracted.episodes[1]?.authoredCliffhanger).toContain('horrible dream');
    expect(extracted.episodes[5]?.authoredCliffhanger).toContain('stag-crest ring');
    expect(extracted.branches.map((branch) => branch.name)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('The Quartz'),
        expect.stringContaining('The Blog War'),
        expect.stringContaining('Mika'),
        expect.stringContaining('The Mountain Confession'),
      ]),
    );
    expect(extracted.endings).toHaveLength(3);
    expect(extracted.endings.map((ending) => ending.name)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('The Consort'),
        expect.stringContaining('The Mountain Wife'),
        expect.stringContaining('The Witness'),
      ]),
    );
    expect(extracted.endings[0]?.targetConditions.join(' ')).toContain('Victor-aligned');
  });

  it('extracts refreshed treatment fields with flexible headings and episode title formats', () => {
    const extracted = extractTreatmentFromMarkdown(refreshedTreatment);

    expect(extracted.isTreatment).toBe(true);
    expect(extracted.metadata.formatVersion).toBe('storyrpg-treatment-v2');
    expect(extracted.metadata.confidence).toBe('high');
    expect(Object.keys(extracted.episodes)).toHaveLength(2);
    expect(extracted.episodes[1]?.authoredTitle).toBe('The Lantern Job');
    expect(extracted.episodes[1]?.normalizedStructuralRoles).toEqual(['hook', 'plotTurn1']);
    expect(extracted.episodes[1]?.episodeTurns).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Mara arrives'),
        expect.stringContaining('lantern speaks'),
      ]),
    );
    expect(extracted.episodes[1]?.encounterCentralConflict).toContain('miracle worth protecting');
    expect(extracted.episodes[1]?.encounterAftermath).toContain('salt burns');
    expect(extracted.episodes[1]?.endingPressure).toContain('shadow points inland');
    expect(extracted.episodes[1]?.capabilityGrowthGuidance?.join(' ')).toContain('costlier clue');
    expect(extracted.episodes[2]?.authoredTitle).toBe('Breakwater Oath');
    expect(extracted.episodes[2]?.normalizedStructuralRoles).toEqual(['pinch1']);
    expect(extracted.branches[0]?.name).toContain('The Ledger Confession');
    expect(extracted.endings).toHaveLength(3);
    expect(extracted.endings.map((ending) => ending.name)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('The Keeper'),
        expect.stringContaining('The Open Door'),
        expect.stringContaining('The Burned Harbor'),
      ]),
    );
  });

  it('extracts regular-episode treatment fields from the updated prompt shape', () => {
    const regularTreatment = `
# Harbor Debt Treatment

## 2. Season Promise And Dramatic Engine

The season asks whether Mara can expose the harbor syndicate without becoming another keeper of secrets.

## 5. Stakes Architecture

- Material: Mara can lose her license and the ledger.
- Relational: Jonas may stop trusting her.
- Identity: Mara may become the kind of fixer she despises.

## 6. Information Ledger

- ID: info-ledger
- Audience/player knowledge state: selective
- Introduced episode: 1
- Setup touch episodes: 1, 2
- Planned reveal or payoff episode: 4

## 8. Arc Plan

Arc 1 asks whether the ledger is evidence or bait.

## 9. Episode Outline

### Episode 1: The Ledger Opens

- **Act:** Act 1
- **Arc:** The Harbor Debt
- **Structural role:** Hook + Plot Turn 1
- **Episode dramatic question:** Will Mara take the ledger case when it threatens Jonas?
- **Cold open function:** Hook + promise + material stakes.
- **A pressure lane:** Mara follows the missing ledger.
- **B pressure lane:** Jonas asks her to protect his brother.
- **C seed:** A red wax seal appears on the pier.
- **Episode turns:**
  - Mara finds the ledger in a fish crate.
  - Jonas lies about recognizing the seal.
- **Synopsis:** Mara takes a case that points back to someone she loves.
- **Opening situation:** The harbor auction turns hostile.
- **Encounter anchor:** The auction confrontation over the ledger.
- **How the encounter manifests the central conflict:** Mara must decide whether truth is worth burning Jonas.
- **Stakes layers present in the major scene/encounter:** Material: the ledger; Relational: Jonas's trust; Identity: Mara's honesty.
- **Theme angle:** What does truth cost when silence protects someone?
- **Lie pressure:** Mara believes safety comes from controlling every secret.
- **Encounter buildup:** Jonas warns her not to bid.
- **Major choice pressure:** Expose Jonas's lie or keep the ledger hidden.
- **Alternative paths:** Exposure earns public leverage but damages Jonas; secrecy preserves intimacy but loses time.
- **Information movement:** Plant the seal and touch the missing brother question.
- **Consequence seeds:** The red seal; Jonas's broken trust.
- **Ending turnout:** The ledger page names Mara's father.
- **End-state change:** Mara cannot investigate from the outside anymore.

## 11. Cross-Episode Branches And Consequence Chains

### Branch A - Jonas's Trust

If Mara exposes Jonas in Episode 1, Episode 2 begins with guarded access. If she protects him, Episode 2 begins with private help and public suspicion.

## 14. Alternate Endings

### Ending 1 - "The Witness"
- **Summary:** Mara exposes the syndicate and leaves the harbor.
- **Emotional register:** Bittersweet release.
- **Theme payoff:** Truth frees her only when she stops owning it alone.
- **State drivers:** Identity choice pattern; relationship with Jonas.
- **Target conditions:** Choose exposure with compassion.

### Ending 2 - "The Fixer"
- **Summary:** Mara controls the ledger and becomes the new broker.
- **Emotional register:** Corrupted victory.
- **Theme payoff:** Control preserves safety but kills trust.
- **State drivers:** Choice pattern around secrecy.
- **Target conditions:** Hide evidence repeatedly.

### Ending 3 - "The Debt Paid"
- **Summary:** Mara sacrifices her license to save Jonas and publish the names.
- **Emotional register:** Redemptive cost.
- **Theme payoff:** Love can pay truth's price without owning the outcome.
- **State drivers:** Relationship; resource loss.
- **Target conditions:** Protect Jonas while refusing the syndicate.
`;

    const extracted = extractTreatmentFromMarkdown(regularTreatment);

    expect(extracted.isTreatment).toBe(true);
    expect(extracted.seasonGuidance?.informationLedger).toContain('info-ledger');
    expect(extracted.seasonGuidance?.arcPlan).toContain('ledger is evidence or bait');
    expect(extracted.episodes[1]?.dramaticQuestion).toContain('Will Mara take');
    expect(extracted.episodes[1]?.aPressure).toContain('missing ledger');
    expect(extracted.episodes[1]?.bPressure).toContain('Jonas');
    expect(extracted.episodes[1]?.cSeed).toContain('red wax');
    expect(extracted.episodes[1]?.stakesLayers?.join(' ')).toContain('Identity');
    expect(extracted.episodes[1]?.themePressure).toContain('truth cost');
    expect(extracted.episodes[1]?.liePressure).toContain('controlling every secret');
    expect(extracted.episodes[1]?.informationMovement).toContain('Plant the seal');
    expect(extracted.episodes[1]?.endingTurnout).toContain('Mara');
    expect(extracted.episodes[1]?.endStateChange).toContain('outside');
    expect(extracted.endings).toHaveLength(3);
  });

  it('replaces invalid LLM Story Circle duplicates with the default spine for treatment analysis', () => {
    const analyzer: any = new SourceMaterialAnalyzer({
      provider: 'anthropic',
      model: 'test',
      apiKey: 'test',
      maxTokens: 1000,
      temperature: 0,
    });
    const treatment = readFileSync(join(__dirname, '../fixtures/bite-me-treatment.md'), 'utf8');
    const structure = {
      genre: 'paranormal romance',
      tone: 'glossy',
      themes: ['voice'],
      setting: { timePeriod: 'now', location: 'Bucharest', worldDetails: 'nightlife' },
      protagonist: { name: 'Kylie Marinescu', description: 'A food writer.', arc: 'Claims her voice.' },
      majorCharacters: [],
      keyLocations: [],
      directLanguageFragments: { dialogue: [], prose: [], terminology: [] },
      adaptationGuidance: { narrativeVoice: 'witty', keyThemesToPreserve: ['voice'], iconicMoments: [] },
      storyArcs: [{ name: 'Voice', description: 'Kylie keeps her voice.', chapters: 'season' }],
      majorPlotPoints: [],
      estimatedScope: { complexity: 'complex', estimatedEpisodes: 8, reasoning: 'treatment' },
      writingStyleGuide: { source: 'inferred_from_material', summary: 'witty' },
      endingAnalysis: { detectedMode: 'multiple', reasoning: 'routes', explicitEndings: [] },
    };
    const defaultBeats = ['you', 'need', 'go', 'search', 'find', 'take', 'return', 'change'];
    const breakdown = {
      totalEpisodes: 8,
      breakdownNotes: 'LLM duplicated the starting-world beat in the finale.',
      episodes: defaultBeats.map((beat, index) => ({
        episodeNumber: index + 1,
        title: `Episode ${index + 1}`,
        synopsis: `Synopsis ${index + 1}`,
        sourceChapters: `Episode ${index + 1}`,
        plotPoints: [`Beat ${index + 1}`],
        mainCharacters: ['Kylie Marinescu'],
        locations: ['Bucharest'],
        narrativeArc: { setup: 'setup', conflict: 'conflict', resolution: 'resolution' },
        storyCircleRole: index === 7
          ? [
              { beat: 'you', roleKind: 'primary', source: 'llm' },
              { beat: 'change', roleKind: 'primary', source: 'llm' },
            ]
          : [{ beat, roleKind: 'primary', source: 'llm' }],
      })),
    };

    const analysis = analyzer.assembleAnalysis(
      { title: 'Bite Me', sourceText: treatment, preferences: {} },
      structure,
      breakdown,
    );

    expect(checkStoryCircleCoverage(analysis.episodeBreakdown)).toEqual([]);
    expect(analysis.episodeBreakdown[7].storyCircleRole).toEqual([
      { beat: 'change', roleKind: 'primary', source: 'distribution' },
    ]);
  });

  it('extracts authored regular-episode variants without swallowing the finale', () => {
    const endSongStyleTreatment = `
# Twilight Song Treatment

A StoryRPG branching-narrative season treatment.

## 7. 3-Act / 7-Point Season Spine

- Hook: The escort mission breaks.
- Climax: The final grove choice.

## 9. Episode Outline

### Episode 1 — "Dissonance in the Pass"
- **Act:** I. **Arc:** 1. **Structural role:** HOOK (anchor episode).
- **Dramatic question:** Can a perfect Sentinel keep his contempt intact?
- **Cold open function:** Dawn over the pass establishes the Lie.
- **A lane:** The ambush and duel.
- **B lane:** A mortal ally proves braver than expected.
- **C lane:** The antagonist calls him old friend.
- **Turns:** (1) Dissonance rises. (2) Ambush erupts. (3) The ally wounds a raider.
- **Synopsis:** The escort mission becomes personal.
- **Encounter anchor:** The pass ambush.
- **Major choices (Want/Cost/Identity):**
  - Hold formation or break to defend the vulnerable.
  - Pursue the antagonist or secure the wounded.
- **Alternative paths / reconvergence:** Guard survival changes later resources; all paths reconverge after the bloodline reveal.
- **Consequence seeds:** Guard count; first impression.
- **Ending turnout:** The antagonist promises to return.
- **End-state change:** The mission is no longer routine.

### Episode 10 — "The Last Keeper"
- **Act:** III. **Arc:** 3. **Structural role:** Aftermath / final-pressure buffer.
- **Dramatic question:** Will the protagonist defend the truth against his own people?
- **Turns:** (1) Sanctuary. (2) Raid. (3) Flight.
- **Encounter anchor:** The raid on the enclave.
- **Major choices:** Parley or flee; spend essence or conserve it.
- **Alternative paths / reconvergence:** Ending weights shift; paths reconverge at the grove.
- **Consequence seeds:** The wound; the pursuit.
- **Ending turnout:** Both armies hunt them.

### Episode 11 — "Endsong" (FINALE)
- **Act:** III. **Arc:** 3. **Structural role:** CLIMAX + RESOLUTION (finale; resolves and integrates).
- **Dramatic question:** What will the protagonist freely give?
- **Turns:** (1) Last refuge. (2) Armies converge. (3) The climax choice. (4) Epilogue.
- **Encounter anchor:** The convergence at the grove and the choice over the artifact.
- **Major choices (the ending-locking node):**
  - Destroy the artifact and die together.
  - Preserve the artifact and flee.
  - Seize the artifact's power.
- **Alternative paths / reconvergence:** Three endings converge on the epilogue frame.
- **Consequence seeds:** The echo; the pendant.
- **Ending turnout:** The surviving image changes by ending.
- **End-state change:** The season question is answered.

## 11. Cross-Episode Branches And Consequence Chains

**Branch 1 — The Romance Trust Spine (created Ep1; pays off Ep11).**
- *What creates it:* Disclosure versus withholding.
- *Where it reconverges:* The final grove in Episode 11.
- *Residue:* Dialogue, trust, and ending eligibility.

**Branch 2 — The Keeper's Wound (created Ep10; pays off Ep11).**
- *What creates it:* Essence spending in Episode 10.
- *Where it reconverges:* Episode 11.
- *Residue:* Mortal vulnerability and available power.

## 14. Alternate Endings (exactly 3)

### Ending A — "The Echo" (canonical)
- **Summary:** The lovers destroy the artifact and become a remembered song.
- **Emotional register:** Bittersweet.
- **Theme payoff:** Love outlasts survival.
- **State drivers:** Trust and sacrifice.
- **Target conditions:** Choose connection repeatedly.

### Ending B — "The Keeper"
- **Summary:** The lovers survive in hiding with the truth preserved.
- **Emotional register:** Hopeful but uneasy.
- **Theme payoff:** Connection can choose life.
- **State drivers:** Trust and restraint.
- **Target conditions:** Choose preservation repeatedly.

### Ending C — "The Crown"
- **Summary:** The protagonist claims power and becomes what he feared.
- **Emotional register:** Tragic.
- **Theme payoff:** Control curdles love.
- **State drivers:** Control and vengeance.
- **Target conditions:** Choose domination repeatedly.
`;

    const extracted = extractTreatmentFromMarkdown(endSongStyleTreatment);

    expect(extracted.isTreatment).toBe(true);
    expect(Object.keys(extracted.episodes).map(Number)).toEqual([1, 10, 11]);
    expect(extracted.episodes[1]?.normalizedStructuralRoles).toEqual(['hook']);
    expect(extracted.episodes[1]?.episodeTurns).toHaveLength(3);
    expect(extracted.episodes[1]?.aPressure).toContain('ambush');
    expect(extracted.episodes[1]?.bPressure).toContain('mortal ally');
    expect(extracted.episodes[1]?.cSeed).toContain('old friend');
    expect(extracted.episodes[1]?.majorChoicePressures?.join(' ')).toContain('Pursue the antagonist');
    expect(extracted.episodes[11]?.authoredTitle).toBe('Endsong');
    expect(extracted.episodes[11]?.normalizedStructuralRoles).toEqual(['climax', 'resolution']);
    expect(extracted.branches.map((branch) => branch.name)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Romance Trust Spine'),
        expect.stringContaining('Keeper'),
      ]),
    );
    expect(extracted.endings).toHaveLength(3);
  });

  it('extracts parser-stable cliffhanger fields without swallowing later top-level lists', () => {
    const cliffhangerTreatment = `
# Harbor Debt Treatment

## 9. Episode Outline

### Episode 1: The Ledger Opens
- Act: Act 1
- Arc: Harbor Debt
- Structural role: buffer (rising buffer toward Pinch 1)
- Structural note: This escalates toward the first pinch without carrying the pinch anchor.
- Episode dramatic question: Will Mara protect Jonas or the ledger?
- Episode turns:
  - Mara finds the ledger in a fish crate.
  - Jonas lies about the red seal.
- Major choice pressure:
  - Expose Jonas in public.
  - Hide the ledger and owe the auctioneer.
- Alternative paths:
  - Exposure creates public suspicion and guarded access.
  - Secrecy preserves intimacy but creates private debt.
- Information movement: Plant the red seal and open the missing brother question.
- Consequence seeds:
  - Jonas's broken trust.
  - The auctioneer's debt marker.
- Ending turnout: The ledger page names Mara's father.
- Resolved episode tension: Mara chooses to take the ledger case.
- Cliffhanger hook: The red seal appears on her father's locked file.
- Cliffhanger question: Why did Mara's father sign the syndicate ledger?
- Next episode pressure: The question forces Mara into the closed registry.
- Cliffhanger setup: The seal appears twice before the final file.
- Cliffhanger type: revelation
- Emotional charge: intimate dread
- End-state change: Mara cannot investigate from outside anymore.

### Episode 2: The Closed Registry
- Act: Act 1
- Arc: Harbor Debt
- Structural role: Pinch 1
- Episode dramatic question: Can Mara get the record before Jonas does?
- Ending turnout: The registry door shuts behind her.
- Resolution / aftermath: The record is found and paid for.

## 11. Cross-Episode Branches And Consequence Chains

### Branch A: Jonas Trust
- Origin episode: E1
- Reconvergence episode: E3
- Summary: Exposure and secrecy alter registry access.

### Branch B: Auction Debt
- What creates it: The debt marker created in Episodes 1-2.
- Where it reconverges: The harbor hearing in Episode 4.
- Residue: The auctioneer asks for a favor.

## 14. Alternate Endings

### Ending 1: The Witness
- Summary: Mara publishes the ledger.
- Emotional register: Bittersweet.
- Theme payoff: Truth frees her when shared.
- State drivers: Identity.
- Target conditions in plain language: Choose exposure with compassion.

### Ending 2: The Fixer
- Summary: Mara controls the ledger.
- Emotional register: Corrupted victory.
- Theme payoff: Control preserves safety but kills trust.
- State drivers: Choice pattern.
- Target conditions in plain language: Hide evidence repeatedly.

### Ending 3: The Debt Paid
- Summary: Mara sacrifices her license.
- Emotional register: Redemptive cost.
- Theme payoff: Love pays truth's price.
- State drivers: Relationship.
- Target conditions in plain language: Protect Jonas while refusing the syndicate.
`;

    const extracted = extractTreatmentFromMarkdown(cliffhangerTreatment);

    expect(extracted.isTreatment).toBe(true);
    expect(extracted.episodes[1]?.normalizedStructuralRoles).toEqual(['rising']);
    expect(extracted.episodes[1]?.structuralNote).toContain('escalates toward');
    expect(extracted.episodes[1]?.episodeTurns).toEqual([
      expect.stringContaining('fish crate'),
      expect.stringContaining('red seal'),
    ]);
    expect(extracted.episodes[1]?.majorChoicePressures).toHaveLength(2);
    expect(extracted.episodes[1]?.alternativePaths).toHaveLength(2);
    expect(extracted.episodes[1]?.consequenceSeeds).toHaveLength(2);
    expect(extracted.episodes[1]?.cliffhangerHook).toContain('locked file');
    expect(extracted.episodes[1]?.cliffhangerQuestion).toContain('Why did Mara');
    expect(extracted.episodes[1]?.nextEpisodePressure).toContain('closed registry');
    expect(extracted.episodes[1]?.cliffhangerType).toBe('revelation');
    expect(extracted.episodes[1]?.emotionalCharge).toBe('intimate dread');
    expect(extracted.branches[0]?.originEpisode).toBe(1);
    expect(extracted.branches[0]?.reconvergenceEpisode).toBe(3);
    expect(extracted.branches[1]?.originEpisode).toBe(1);
    expect(extracted.branches[1]?.reconvergenceEpisode).toBe(4);
    expect(extracted.endings[0]?.targetConditions.join(' ')).toContain('compassion');
    expect(extracted.metadata.warnings.join(' ')).not.toContain('Episode 1 is missing a cliffhanger question');
  });

  it('merges Section 10 scene planning notes into episode guidance and residue contracts', () => {
    const treatment = `
# Bite Me Treatment

## 9. Episode Outline

### Episode 1: Dating After Dusk
- **Episode promise:** Kylie tries to start over in Bucharest.
- **Structural role:** hook

## 10. Scene Planning Notes

- Scene: The Rooftop Dusk Club Lock-In (Episode 1)
  - Entry goal: Kylie wants one easy, glamorous night with her two new friends to prove she can start over in a city that doesn't know her ex's name.
  - Obstacle: Two men watch her from across the room — Victor in charcoal, the rougher man by the kitchen — and Mika goes very still for a half-second before steering Kylie toward food.
  - Forced choice: Follow Mika's lead away from the charcoal-suited man, or excuse yourself and walk over.
  - Exit shift: From a tourist ordering second and watching the room to a woman who has just been seen, and who liked it.
  - Power shift: Mika quietly takes control of the night (the door, the dress, the steering); Kylie reads it as friendship, not handling.
  - Subtext gap: The friends toast to never dating a man with a podcast; underneath, Kylie is testing whether she's allowed to want anyone at all again.
  - Stakes layers: Relational, Identity.
  - Connects by: Choice residue — walking over to Victor forces Mika to invent a reason she warned Kylie off, opening the first catchable Mika lie; holding the kitchen man's look moves Radu's confession earlier.
`;

    const extracted = extractTreatmentFromMarkdown(treatment);
    const ep1 = extracted.episodes[1];

    expect(extracted.isTreatment).toBe(true);
    expect(extracted.seasonGuidance?.scenePlanningGuidance?.scenes[0]?.sceneTitle).toContain('Rooftop Dusk Club');
    expect(ep1?.scenePlanningTargets?.join(' ')).toContain('Rooftop Dusk Club');
    expect(ep1?.entryGoal).toContain('one easy, glamorous night');
    expect(ep1?.obstacle).toContain('Victor in charcoal');
    expect(ep1?.forcedChoice).toContain("Follow Mika's lead");
    expect(ep1?.majorChoicePressures?.join(' ')).toContain('excuse yourself and walk over');
    expect(ep1?.powerShift).toContain('Mika quietly takes control');
    expect(ep1?.bPressure).toContain('Mika quietly takes control');
    expect(ep1?.subtextGap).toContain('allowed to want anyone');
    expect(ep1?.liePressure).toContain('allowed to want anyone');
    expect(ep1?.stakesLayers).toEqual(expect.arrayContaining(['Relational', 'Identity.']));
    expect(ep1?.connectsBy).toContain('catchable Mika lie');
    expect(ep1?.alternativePaths?.join(' ')).toContain('walking over to Victor');
    expect(ep1?.consequenceSeeds?.join(' ')).toContain("Radu's confession earlier");
    expect(ep1?.informationMovement).toContain('catchable Mika lie');
  });

  it('extracts episode treatment fields and marks the treatment as episodes', () => {
    const episodeTreatment = `
# Harbor Debt Episode Treatment

## 1. Story Premise

This is the EPISODE version.

## 6. Information Ledger

- ID: info-seal
- Introduced episode: 1
- Setup touch episodes: 2, 4
- Planned reveal or payoff episode: 7

## 9. Episode Outline

### Episode 1: The Auction Bell

- **Act:** Act 1
- **Arc:** The Harbor Debt
- **Structural role:** Hook
- **Episode dramatic question:** Will Mara make herself visible to save the ledger?
- **Opening image / hook function:** The auction bell rings with no one touching it.
- **Entry goal:** Buy the fish crate quietly.
- **Obstacle:** The syndicate bids with Jonas's family ring.
- Forced choice: Publicly challenge the bid or let the crate disappear.
- **Exit shift:** Mara leaves exposed as a bidder and implicated as a daughter.
- **Stakes layers present:** Material: ledger access; Relational: Jonas's trust; Identity: whether Mara hides or stands visible.
- **Theme pressure:** What does truth demand in public?
- **Lie pressure:** Mara believes invisibility keeps people safe.
- **A pressure:** Secure the ledger.
- **B pressure:** Preserve Jonas's trust.
- **C seed:** The red wax seal.
- **Information movement:** Plant the seal and open the brother question.
- **Meaningful choice pressure:** Challenge the bid or use Jonas's secret.
- **Alternative path or branchlet:** Challenge creates public suspicion; secrecy creates private debt.
- **Consequence residue:** The auctioneer now knows Mara's father's name.
- **Visual anchor:** A red seal stuck to a wet ledger page.
- **Why the next episode exists because of this one:** The named father forces Mara to visit the closed registry.

## 10. Cross-Episode Branches And Consequence Chains

### Branch A - Public Bid

The public challenge changes episode 3's access and reconverges at the registry.

## 13. Alternate Endings

### Ending 1 - "The Witness"
- **Summary:** Mara publishes the names.
- **Emotional register:** Bittersweet.
- **Theme payoff:** Truth shared is less poisonous.
- **State drivers:** Identity.
- **Target conditions:** Choose public truth.

### Ending 2 - "The Fixer"
- **Summary:** Mara controls the names.
- **Emotional register:** Corrupted.
- **Theme payoff:** Control repeats the wound.
- **State drivers:** Choice pattern.
- **Target conditions:** Hide evidence.

### Ending 3 - "The Debt Paid"
- **Summary:** Mara loses the license but saves Jonas.
- **Emotional register:** Redemptive.
- **Theme payoff:** Love accepts cost.
- **State drivers:** Relationship.
- **Target conditions:** Protect Jonas and expose the syndicate.
`;

    const extracted = extractTreatmentFromMarkdown(episodeTreatment);

    expect(extracted.isTreatment).toBe(true);
    expect(extracted.seasonGuidance?.informationLedger).toContain('info-seal');
    expect(extracted.episodes[1]?.dramaticQuestion).toContain('make herself visible');
    expect(extracted.episodes[1]?.entryGoal).toContain('fish crate');
    expect(extracted.episodes[1]?.obstacle).toContain('family ring');
    expect(extracted.episodes[1]?.forcedChoice).toContain('challenge');
    expect(extracted.episodes[1]?.exitShift).toContain('exposed');
    expect(extracted.episodes[1]?.consequenceResidue).toContain('father');
    expect(extracted.episodes[1]?.nextEpisodeCausality).toContain('closed registry');
    expect(extracted.episodes[1]?.visualAnchor).toContain('red seal');
    expect(extracted.branches[0]?.name).toContain('Public Bid');
    expect(extracted.endings).toHaveLength(3);
  });

  it('extracts episode guidance from common workshop heading variants', () => {
    const variantTreatment = `
# Harbor Debt Treatment

## Episode Outline

#### Episode 1 — The Auction Bell

- **Dramatic question:** Will Mara stand up in public?
- **Act/Arc:** Act 1 / Arc 1.
- Forced choice: Challenge the bid or let the crate vanish.
- Exit shift: Mara leaves publicly exposed.
- Meaningful choices: Challenge publicly; bargain privately.
- Why the next episode exists because of this one: The exposed bid sends Mara to the registry.

#### Scene 2 - The Closed Registry

- Entry goal: Get the birth record.
- Obstacle: Jonas has already pulled the page.
- Consequence residue: Mara owes the archivist a favor.

## Alternate Endings

### Ending 1 - "The Witness"
- Summary: Mara publishes the names.
### Ending 2 - "The Fixer"
- Summary: Mara controls the names.
### Ending 3 - "The Debt Paid"
- Summary: Mara pays the cost.
`;

    const extracted = extractTreatmentFromMarkdown(variantTreatment);

    expect(extracted.isTreatment).toBe(true);
    expect(Object.keys(extracted.episodes)).toHaveLength(2);
    expect(extracted.episodes[1]?.authoredTitle).toBe('The Auction Bell');
    expect(extracted.episodes[1]?.dramaticQuestion).toContain('stand up');
    expect(extracted.episodes[1]?.forcedChoice).toContain('Challenge');
    expect(extracted.episodes[1]?.majorChoicePressures?.join(' ')).toContain('bargain privately');
    expect(extracted.episodes[1]?.nextEpisodeCausality).toContain('registry');
    expect(extracted.episodes[2]?.authoredTitle).toBe('The Closed Registry');
    expect(extracted.episodes[2]?.entryGoal).toContain('birth record');
  });

  it('extracts episode guidance when filled treatment uses number-and-title bullets', () => {
    const bulletTreatment = `
# Harbor Debt Episode Treatment

## Episode Outline

- **Episode number and title:** 1 - The Auction Bell
- **Episode dramatic question:** Will Mara make herself visible?
- **Entry goal:** Buy the fish crate quietly.
- **Obstacle:** The syndicate bids with Jonas's ring.
- **Forced choice:** Challenge the bid or let the crate vanish.
- **Exit shift:** Mara leaves exposed.
- **Why the next episode exists because of this one:** The named father sends Mara to the registry.

- Episode number and title: Episode 2 — The Closed Registry
- Entry goal: Get the birth record.
- Obstacle: Jonas has already pulled the page.
- Consequence residue: Mara owes the archivist a favor.

## Alternate Endings

### Ending 1 - "The Witness"
- Summary: Mara publishes the names.
### Ending 2 - "The Fixer"
- Summary: Mara controls the names.
### Ending 3 - "The Debt Paid"
- Summary: Mara pays the cost.
`;

    const extracted = extractTreatmentFromMarkdown(bulletTreatment);

    expect(extracted.isTreatment).toBe(true);
    expect(Object.keys(extracted.episodes)).toHaveLength(2);
    expect(extracted.episodes[1]?.authoredTitle).toBe('The Auction Bell');
    expect(extracted.episodes[1]?.entryGoal).toContain('fish crate');
    expect(extracted.episodes[1]?.nextEpisodeCausality).toContain('registry');
    expect(extracted.episodes[2]?.authoredTitle).toBe('The Closed Registry');
    expect(extracted.episodes[2]?.consequenceResidue).toContain('favor');
  });

  it('does not treat the prompt guide itself as a filled treatment', () => {
    const promptGuide = `
# StoryRPG Treatment Prompt Guide

Use this guide to create a planning document. It is not itself a filled story treatment.

## Episode Outline

For each episode, provide a title, dramatic question, entry goal, obstacle, forced choice, exit shift, and consequence residue.
`;
    const extracted = extractTreatmentFromMarkdown(promptGuide);

    expect(extracted.isTreatment).toBe(false);
    expect(extracted.metadata.detected).toBe(false);
  });

  it('detects malformed treatment-like input and blocks silent generic fallback', () => {
    const malformedTreatment = `
# Bite Me Story Treatment

## 1. Episode Outline

### Ep One - Dating After Dusk
- **Episode promise:** Can Kylie survive her first fabulous night?
- **Major choice pressure:** Accept Mika's key card or keep distance.
- **Cliffhanger:** Stela texts that she had a horrible dream and is coming over with herbs.

## 2. Alternate Endings

### Ending One - "The Consort"
- **Summary:** Kylie chooses Victor.
`;
    const analyzer = new SourceMaterialAnalyzer({
      provider: 'anthropic',
      model: 'test',
      apiKey: 'test',
      maxTokens: 1000,
      temperature: 0,
    });
    const structure: any = {
      genre: 'paranormal romance',
      tone: 'dangerous',
      themes: [],
      setting: { timePeriod: 'present', location: 'Bucharest', worldDetails: '' },
      protagonist: { name: 'Kylie', description: 'A blogger.', arc: 'Claims her voice.' },
      majorCharacters: [],
      keyLocations: [],
      directLanguageFragments: { dialogue: [], prose: [], terminology: [] },
      storyArcs: [],
      majorPlotPoints: [],
      estimatedScope: { complexity: 'moderate', estimatedEpisodes: 1, reasoning: 'test' },
      endingAnalysis: { detectedMode: 'single', reasoning: 'fallback', explicitEndings: [] },
    };
    const breakdown: any = {
      episodes: [{
        episodeNumber: 1,
        title: 'Episode 1',
        synopsis: 'Synopsis',
        sourceChapters: '1',
        plotPoints: ['Plot'],
        mainCharacters: ['Kylie'],
        locations: ['Bucharest'],
        narrativeArc: { setup: 'setup', conflict: 'conflict', resolution: 'resolution' },
        structuralRole: ['hook'],
      }],
      totalEpisodes: 1,
      breakdownNotes: 'test',
    };

    expect(looksLikeTreatmentMarkdown(malformedTreatment)).toBe(true);
    expect(() => (analyzer as any).assembleAnalysis(
      { title: 'Bite Me', sourceText: malformedTreatment },
      structure,
      breakdown,
    )).toThrow(/Treatment extraction failed/);
  });

  it('overlays treatment guidance and endings onto assembled source analysis', () => {
    const analyzer = new SourceMaterialAnalyzer({
      provider: 'anthropic',
      model: 'test',
      apiKey: 'test',
      maxTokens: 1000,
      temperature: 0,
    });

    const structure: any = {
      genre: 'paranormal romance',
      tone: 'glamorous and dangerous',
      themes: ['voice', 'friendship'],
      setting: { timePeriod: 'present', location: 'Bucharest', worldDetails: 'Nightlife with supernatural pressure' },
      protagonist: { name: 'Kylie', description: 'A blogger.', arc: 'Claims her voice.' },
      majorCharacters: [],
      keyLocations: [],
      directLanguageFragments: { dialogue: [], prose: [], terminology: [] },
      storyArcs: [{ name: 'Dusk', description: 'Kylie learns the city.', chapters: 'all' }],
      majorPlotPoints: [
        { description: 'Kylie is attacked and rescued.', type: 'inciting_incident', importance: 'critical', approximatePosition: 'early' },
        { description: 'Kylie confronts Victor.', type: 'climax', importance: 'critical', approximatePosition: 'late' },
      ],
      estimatedScope: { complexity: 'moderate', estimatedEpisodes: 8, reasoning: 'treatment has eight episodes' },
      endingAnalysis: { detectedMode: 'single', reasoning: 'fallback', explicitEndings: [] },
    };
    const breakdown: any = {
      episodes: Array.from({ length: 8 }, (_, index) => ({
        episodeNumber: index + 1,
        title: `Episode ${index + 1}`,
        synopsis: `Synopsis ${index + 1}`,
        sourceChapters: `${index + 1}`,
        plotPoints: [`Plot ${index + 1}`],
        mainCharacters: ['Kylie'],
        locations: ['Bucharest'],
        narrativeArc: { setup: 'setup', conflict: 'conflict', resolution: 'resolution' },
        structuralRole: index === 4 ? ['midpoint'] : index === 7 ? ['climax', 'resolution'] : ['rising'],
      })),
      totalEpisodes: 8,
      breakdownNotes: 'eight episodes',
    };

    const analysis = (analyzer as any).assembleAnalysis(
      { title: 'Bite Me', sourceText: treatment },
      structure,
      breakdown,
    );

    expect(analysis.resolvedEndingMode).toBe('multiple');
    expect(analysis.resolvedEndings).toHaveLength(3);
    expect(analysis.episodeBreakdown[0].treatmentGuidance.authoredCliffhanger).toContain('horrible dream');
    expect(analysis.episodeBreakdown[4].treatmentGuidance.encounterAnchors[0]).toContain('mirror moment');
    expect(analysis.treatmentBranches.map((branch: any) => branch.name)).toEqual(
      expect.arrayContaining([expect.stringContaining('The Blog War')]),
    );
  });

  it('extracts structured branch-chain and alternate-ending fields from authored treatment text', () => {
    const extracted = extractTreatmentFromMarkdown(`
# Bite Me

## 11. Cross-Episode Branches And Consequence Chains

### Branch A: The Quartz (Sanctuary vs. Open Threshold)

- **Origin episode:** Episode 1.
- **What creates it:** At Lumina Books, Kylie either accepts the rose quartz Stela presses into her palm (canonical), declines it politely, or buys it for cash and tosses it in her bag without looking.
- **How it changes a later episode:** With the quartz accepted and the candle ritual completed in Episode 4, the apartment holds at Episode 6. With the quartz refused or lost, Victor walks into Kylie's apartment uninvited in Episode 6.
- **Reconvergence episode:** Episode 5.
- **What residue remains after reconvergence:** Whether the Lipscani apartment is full sanctuary, partial sanctuary, or compromised carries forward.
- **What state it changes:** Access (apartment as warded sanctuary), resource (Stela's protection footing), and ending eligibility — the quartz must be accepted and kept for both the Mountain Wife and the Witness endings.

## 14. Alternate Endings

### Ending 1: The Consort

- **Name:** The Consort ("The Last Sunrise")
- **Summary:** Kylie accepts Victor's offer at Casa Stelarum on the Hunter's Moon and winds down Dating After Dusk.
- **Emotional register:** Tragic-glamorous.
- **Theme payoff:** The Lie wins, beautifully.
- **State drivers:** Victor-aligned choices across the season. The quartz refused or lost (Branch A), leaving the apartment unwarded.
- **Target conditions:** Victor-aligned pattern across at least five of the eight episode-level major choices. The quartz must be refused or lost.
- **What repeated choice pattern this ending pays off:** A pattern of being courted over being known.
- **Final voiceover line:** Some women are loved. Some women are owned.

### Episode 1: Dating After Dusk
- **Structural role:** hook
- **Episode promise:** Kylie chooses whether to accept Stela's quartz.
`);

    const quartz = extracted.branches[0];
    expect(quartz.name).toContain('The Quartz');
    expect(quartz.originEpisode).toBe(1);
    expect(quartz.createdBy).toContain('accepts the rose quartz');
    expect(quartz.laterEpisodeChange).toContain('Episode 6');
    expect(quartz.reconvergenceEpisode).toBe(5);
    expect(quartz.reconvergenceResidue).toContain('full sanctuary');
    expect(quartz.stateChanges).toEqual(expect.arrayContaining([
      expect.stringContaining('Access'),
      expect.stringContaining('resource'),
      expect.stringContaining('ending eligibility'),
    ]));
    expect(quartz.pathVariants?.map((variant) => variant.label)).toEqual(expect.arrayContaining([
      'accepted',
      'refused',
      'lost',
    ]));

    const consort = extracted.endings[0];
    expect(consort.name).toContain('The Consort');
    expect(consort.targetConditions).toEqual(expect.arrayContaining([
      expect.stringContaining('Victor-aligned pattern'),
      expect.stringContaining('quartz must be refused or lost'),
    ]));
    expect(consort.repeatedChoicePattern).toContain('being courted over being known');
    expect(consort.finalVoiceoverLine).toContain('Some women are loved');
    expect(consort.sourceText).toContain('Ending 1');
  });

  it('stamps a swept off-page relation with a marker description so it is never staged present', () => {
    const analyzer = new SourceMaterialAnalyzer({ provider: 'anthropic', model: 'test', apiKey: 'test', maxTokens: 100, temperature: 0 });
    const classify = (name: string, src?: string) => (analyzer as any).classifyOffPageDescription(name, src);

    // Remote relation in the treatment → marker description carrying the off-page word.
    const remote = classify('Sadie', "Her niece Sadie (7) in Boston, whose photo sits on her desk.");
    expect(remote).toMatch(/off-page/i);
    expect(remote).toMatch(/niece/i); // the marker the present-cast filter keys on

    // A present character → empty description (stageable).
    expect(classify('Mika', 'Mika runs the door at the Vâlcescu Club.')).toBe('');
    // No source text / name absent → empty.
    expect(classify('Sadie', undefined)).toBe('');
    expect(classify('Ghost', 'Nobody by that name appears here.')).toBe('');
  });

  it('marks refreshed treatments as authored treatment input and preserves treatment episode count, titles, and guidance', () => {
    const analyzer = new SourceMaterialAnalyzer({
      provider: 'anthropic',
      model: 'test',
      apiKey: 'test',
      maxTokens: 1000,
      temperature: 0,
    });

    const structure: any = {
      genre: 'supernatural mystery',
      tone: 'salt-stung dread',
      themes: ['grief', 'truth'],
      setting: { timePeriod: 'present', location: 'harbor town', worldDetails: 'A lighthouse that answers grief' },
      protagonist: { name: 'Mara', description: 'A new lighthouse keeper.', arc: 'Learns truth must release grief.' },
      majorCharacters: [],
      keyLocations: [],
      directLanguageFragments: { dialogue: [], prose: [], terminology: [] },
      storyArcs: [{ name: 'The Light', description: 'Mara learns what the lighthouse imprisons.', chapters: 'all' }],
      majorPlotPoints: [
        { description: 'The lantern answers with her sister voice.', type: 'inciting_incident', importance: 'critical', approximatePosition: 'early' },
        { description: 'Mara opens the storm door.', type: 'climax', importance: 'critical', approximatePosition: 'late' },
      ],
      estimatedScope: { complexity: 'moderate', estimatedEpisodes: 1, reasoning: 'LLM undercounted' },
      endingAnalysis: { detectedMode: 'single', reasoning: 'fallback', explicitEndings: [] },
    };
    const breakdown: any = {
      episodes: [{
        episodeNumber: 1,
        title: 'Wrong LLM Title',
        synopsis: 'Mara arrives.',
        sourceChapters: '1',
        plotPoints: ['Mara arrives'],
        mainCharacters: ['Mara'],
        locations: ['Lighthouse'],
        narrativeArc: { setup: 'setup', conflict: 'conflict', resolution: 'resolution' },
        structuralRole: ['rising'],
      }],
      totalEpisodes: 1,
      breakdownNotes: 'undercounted',
    };

    const analysis = (analyzer as any).assembleAnalysis(
      { title: 'Harbor Light', sourceText: refreshedTreatment },
      structure,
      breakdown,
    );

    expect(analysis.sourceFormat).toBe('story_treatment');
    expect(analysis.treatmentMetadata.detected).toBe(true);
    expect(analysis.treatmentMetadata.formatVersion).toBe('storyrpg-treatment-v2');
    expect(analysis.totalEstimatedEpisodes).toBe(2);
    expect(analysis.episodeBreakdown.map((episode: any) => episode.title)).toEqual([
      'The Lantern Job',
      'Breakwater Oath',
    ]);
    expect(analysis.episodeBreakdown[0].structuralRole).toEqual(expect.arrayContaining(['hook', 'plotTurn1']));
    expect(analysis.episodeBreakdown[1].structuralRole).toEqual(expect.arrayContaining(['pinch1']));
    expect(analysis.episodeBreakdown[0].treatmentGuidance.encounterCentralConflict).toContain('miracle worth protecting');
    expect(analysis.resolvedEndings).toHaveLength(3);
  });

  it('extracts treatment episode guidance from a prompt when no source text was uploaded', () => {
    const analyzer = new SourceMaterialAnalyzer({
      provider: 'anthropic',
      model: 'test',
      apiKey: 'test',
      maxTokens: 1000,
      temperature: 0,
    });

    const structure: any = {
      genre: 'supernatural mystery',
      tone: 'salt-stung dread',
      themes: ['grief', 'truth'],
      setting: { timePeriod: 'present', location: 'harbor town', worldDetails: 'A lighthouse that answers grief' },
      protagonist: { name: 'Mara', description: 'A new lighthouse keeper.', arc: 'Learns truth must release grief.' },
      majorCharacters: [],
      keyLocations: [],
      directLanguageFragments: { dialogue: [], prose: [], terminology: [] },
      storyArcs: [{ name: 'The Light', description: 'Mara learns what the lighthouse imprisons.', chapters: 'all' }],
      majorPlotPoints: [
        { description: 'The lantern answers with her sister voice.', type: 'inciting_incident', importance: 'critical', approximatePosition: 'early' },
        { description: 'Mara opens the storm door.', type: 'climax', importance: 'critical', approximatePosition: 'late' },
      ],
      estimatedScope: { complexity: 'moderate', estimatedEpisodes: 1, reasoning: 'LLM undercounted' },
      endingAnalysis: { detectedMode: 'single', reasoning: 'fallback', explicitEndings: [] },
    };
    const breakdown: any = {
      episodes: [{
        episodeNumber: 1,
        title: 'Wrong LLM Title',
        synopsis: 'Mara arrives.',
        sourceChapters: '1',
        plotPoints: ['Mara arrives'],
        mainCharacters: ['Mara'],
        locations: ['Lighthouse'],
        narrativeArc: { setup: 'setup', conflict: 'conflict', resolution: 'resolution' },
        structuralRole: ['rising'],
      }],
      totalEpisodes: 1,
      breakdownNotes: 'undercounted',
    };

    const analysis = (analyzer as any).assembleAnalysis(
      {
        title: 'Harbor Light',
        sourceText: '',
        userPrompt: `Use this treatment as source of truth.\n\n${refreshedTreatment}`,
      },
      structure,
      breakdown,
    );

    expect(analysis.sourceFormat).toBe('story_treatment');
    expect(analysis.totalEstimatedEpisodes).toBe(2);
    expect(analysis.episodeBreakdown.map((episode: any) => episode.title)).toEqual([
      'The Lantern Job',
      'Breakwater Oath',
    ]);
    expect(analysis.episodeBreakdown[0].treatmentGuidance.encounterCentralConflict).toContain('miracle worth protecting');
  });
});

describe('SourceMaterialAnalyzer writing style helpers', () => {
  it('detects explicit prose style instructions in the user prompt', () => {
    expect(
      detectExplicitWritingStyleInstruction('A detective story in rain-slick streets. Write in spare noir prose.')
    ).toBe('Write in spare noir prose.');

    expect(
      detectExplicitWritingStyleInstruction('Use a literary, close third-person style with brittle dialogue.')
    ).toBe('Use a literary, close third-person style with brittle dialogue.');
  });

  it('ignores ordinary plot and tone prompts without prose-style instructions', () => {
    expect(
      detectExplicitWritingStyleInstruction('A dark fantasy about a knight investigating a haunted abbey.')
    ).toBeUndefined();
  });

  it('ignores visual art style instructions', () => {
    expect(
      detectExplicitWritingStyleInstruction('A mystery about a haunted pier. Art style should be watercolor noir.')
    ).toBeUndefined();
  });

  it('prefers explicit prompt style over inferred guide metadata', () => {
    const guide = normalizeWritingStyleGuide(
      { source: 'inferred_from_material', summary: 'Use lyrical mythic prose.' },
      'Write in spare noir prose.',
      { genre: 'fantasy', tone: 'mythic' },
    );

    expect(guide.source).toBe('explicit_prompt');
    expect(guide.evidence).toEqual(['Write in spare noir prose.']);
  });

  it('preserves direct language fragments and adaptation guidance during normalization', () => {
    expect(
      normalizeDirectLanguageFragments({
        dialogue: ['Never tell me the odds.'],
        prose: ['The city breathed smoke.'],
        terminology: ['jump drive'],
      })
    ).toEqual({
      dialogue: ['Never tell me the odds.'],
      prose: ['The city breathed smoke.'],
      terminology: ['jump drive'],
    });

    expect(
      normalizeAdaptationGuidance({
        narrativeVoice: 'Cool, observant, lightly ironic.',
        dialogueStyle: 'Clipped and evasive.',
        toneNotes: 'Tense but dry.',
        keyThemesToPreserve: ['loyalty'],
        iconicMoments: ['the rooftop confession'],
      })
    ).toMatchObject({
      narrativeVoice: 'Cool, observant, lightly ironic.',
      dialogueStyle: 'Clipped and evasive.',
      toneNotes: 'Tense but dry.',
      elementsToPreserve: ['loyalty', 'the rooftop confession'],
    });
  });

  it('normalizes character fashion style metadata', () => {
    expect(
      normalizeCharacterFashionStyle({
        styleSummary: ' Tailored dockside noir ',
        styleTags: [' trench coat ', ''],
        signatureGarments: ['weathered coat'],
        materials: ['wool'],
        colorPalette: ['charcoal'],
        accessories: ['silver lighter'],
        sourceEvidence: ['coat mentioned twice'],
      })
    ).toEqual({
      styleSummary: 'Tailored dockside noir',
      styleTags: ['trench coat'],
      signatureGarments: ['weathered coat'],
      materials: ['wool'],
      colorPalette: ['charcoal'],
      accessories: ['silver lighter'],
      sourceEvidence: ['coat mentioned twice'],
    });

    expect(normalizeCharacterFashionStyle({ styleSummary: '', styleTags: [] })).toBeUndefined();
  });

  it('assembles a writing style guide and source-fidelity fields for old-safe analysis output', () => {
    const analyzer = new SourceMaterialAnalyzer({
      provider: 'anthropic',
      model: 'test',
      apiKey: 'test',
      maxTokens: 1000,
      temperature: 0,
    });

    const structure = {
      genre: 'mystery',
      tone: 'dry and tense',
      themes: ['truth'],
      setting: { timePeriod: 'now', location: 'Harbor City', worldDetails: 'rain and debt' },
      protagonist: {
        name: 'Mara',
        description: 'A private investigator.',
        arc: 'Learns to trust again.',
        fashionStyle: {
          styleSummary: 'Rumpled investigator layers built around a rain-dark trench coat.',
          styleTags: ['noir detective'],
          signatureGarments: ['rain-dark trench coat'],
          materials: ['gabardine'],
          colorPalette: ['slate', 'black'],
          accessories: ['notebook'],
        },
      },
      majorCharacters: [
        {
          name: 'Boss Vale',
          role: 'antagonist',
          description: 'The harbor boss.',
          importance: 'core',
          fashionStyle: {
            styleSummary: 'Immaculate white suits made threatening by blood-red accents.',
            styleTags: ['crime boss tailoring'],
            signatureGarments: ['white suit'],
            materials: ['linen'],
            colorPalette: ['white', 'red'],
            accessories: ['ruby tie pin'],
            sourceEvidence: ['The boss wore white.'],
          },
        },
      ],
      keyLocations: [],
      directLanguageFragments: {
        dialogue: ['Everyone owes someone.'],
        prose: ['Rain turned the harbor lights into bruises.'],
        terminology: ['dockside'],
      },
      adaptationGuidance: {
        narrativeVoice: 'Hardboiled but intimate.',
        keyThemesToPreserve: ['truth'],
        iconicMoments: ['the pier reveal'],
      },
      storyArcs: [{ name: 'The Missing Ledger', description: 'Mara follows a debt trail.', chapters: 'all' }],
      majorPlotPoints: [
        { description: 'The ledger vanishes.', type: 'inciting_incident', importance: 'critical', approximatePosition: 'early' },
        { description: 'Mara confronts the harbor boss.', type: 'climax', importance: 'critical', approximatePosition: 'late' },
      ],
      estimatedScope: { complexity: 'simple', estimatedEpisodes: 1, reasoning: 'short mystery' },
      writingStyleGuide: {
        source: 'inferred_from_material',
        summary: 'Hardboiled, intimate mystery prose.',
      },
      endingAnalysis: { detectedMode: 'single', reasoning: 'one mystery solution', explicitEndings: [] },
    };

    const breakdown = {
      episodes: [
        {
          episodeNumber: 1,
          title: 'The Missing Ledger',
          synopsis: 'Mara takes the case and finds the boss.',
          sourceChapters: 'all',
          plotPoints: ['The ledger vanishes.', 'Mara confronts the harbor boss.'],
          mainCharacters: ['Mara'],
          locations: ['Harbor City'],
          narrativeArc: { setup: 'The case arrives.', conflict: 'The trail tightens.', resolution: 'The boss is exposed.' },
          structuralRole: ['hook', 'plotTurn1', 'climax', 'resolution'],
        },
      ],
      totalEpisodes: 1,
      breakdownNotes: 'single episode',
    };

    const analysis = (analyzer as any).assembleAnalysis(
      { title: 'Harbor Debt', sourceText: 'Rain and ledgers.', userPrompt: 'A mystery. Write in spare noir prose.' },
      structure,
      breakdown,
    );

    expect(analysis.writingStyleGuide.source).toBe('explicit_prompt');
    expect(analysis.writingStyleGuide.evidence).toEqual(['Write in spare noir prose.']);
    expect(analysis.directLanguageFragments.dialogue).toEqual(['Everyone owes someone.']);
    expect(analysis.adaptationGuidance.narrativeVoice).toBe('Hardboiled but intimate.');
    expect(analysis.protagonist.fashionStyle?.styleTags).toEqual(['noir detective']);
    expect(analysis.majorCharacters[0].fashionStyle?.signatureGarments).toEqual(['white suit']);
  });
});

describe('SourceMaterialAnalyzer per-episode breakdown fan-out', () => {
  const makeAnalyzer = () =>
    new SourceMaterialAnalyzer({
      provider: 'anthropic',
      model: 'test',
      apiKey: 'test',
      maxTokens: 1000,
      temperature: 0,
    });

  const makeStructure = (estimatedEpisodes: number): any => ({
    genre: 'mystery',
    tone: 'dry and tense',
    themes: ['truth'],
    setting: { timePeriod: 'now', location: 'Harbor City', worldDetails: 'rain and debt' },
    protagonist: { name: 'Mara', description: 'A private investigator.', arc: 'Learns to trust again.' },
    majorCharacters: [],
    keyLocations: [],
    directLanguageFragments: { dialogue: [], prose: [], terminology: [] },
    storyArcs: [{ name: 'The Missing Ledger', description: 'Mara follows a debt trail.', chapters: 'all' }],
    majorPlotPoints: [
      { description: 'The ledger vanishes.', type: 'inciting_incident', importance: 'critical', approximatePosition: 'early' },
      { description: 'Mara confronts the harbor boss.', type: 'climax', importance: 'critical', approximatePosition: 'late' },
    ],
    estimatedScope: { complexity: 'moderate', estimatedEpisodes, reasoning: 'test' },
    endingAnalysis: { detectedMode: 'single', reasoning: 'one mystery solution', explicitEndings: [] },
  });

  const preferences = { targetScenes: 6, targetChoices: 4, pacing: 'moderate' };

  it('fans a >=6 episode season out into one call per episode and assembles in order', async () => {
    const analyzer = makeAnalyzer();
    const estimatedEpisodes = 6;

    // Each call returns a single-episode object. We echo back the episodeNumber
    // embedded in the prompt so we can assert order-preservation independently
    // of the order the (concurrent) calls actually settle in.
    const callSpy = vi
      .spyOn(analyzer as any, 'callLLM')
      .mockImplementation(async (...args: unknown[]) => {
        const messages = args[0] as Array<{ content: string }>;
        const prompt = messages[0].content;
        const match = prompt.match(/Episode number: (\d+) of/);
        const n = match ? Number(match[1]) : 0;
        return JSON.stringify({
          episodeNumber: n,
          title: `Title ${n}`,
          synopsis: `Synopsis ${n}`,
          sourceChapters: `${n}`,
          plotPoints: [`Plot ${n}`],
          mainCharacters: ['Mara'],
          locations: ['Harbor City'],
          narrativeArc: { setup: 's', conflict: 'c', resolution: 'r' },
          structuralRole: ['rising'],
        });
      });

    const breakdown = await (analyzer as any).createEpisodeBreakdown(
      'Rain and ledgers.',
      makeStructure(estimatedEpisodes),
      preferences,
    );

    // N episodes -> N focused calls.
    expect(callSpy).toHaveBeenCalledTimes(estimatedEpisodes);
    expect(breakdown.totalEpisodes).toBe(estimatedEpisodes);
    expect(breakdown.episodes).toHaveLength(estimatedEpisodes);
    // Order preserved 1..N regardless of settle order.
    expect(breakdown.episodes.map((ep: any) => ep.episodeNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(breakdown.episodes.map((ep: any) => ep.title)).toEqual([
      'Title 1', 'Title 2', 'Title 3', 'Title 4', 'Title 5', 'Title 6',
    ]);
  });

  it('keeps the single all-at-once call for a 2-episode season', async () => {
    const analyzer = makeAnalyzer();

    const callSpy = vi
      .spyOn(analyzer as any, 'callLLM')
      .mockResolvedValue(
        JSON.stringify({
          episodes: [
            {
              episodeNumber: 1,
              title: 'Title 1',
              synopsis: 'Synopsis 1',
              sourceChapters: '1',
              plotPoints: ['Plot 1'],
              mainCharacters: ['Mara'],
              locations: ['Harbor City'],
              narrativeArc: { setup: 's', conflict: 'c', resolution: 'r' },
              structuralRole: ['hook', 'plotTurn1'],
            },
            {
              episodeNumber: 2,
              title: 'Title 2',
              synopsis: 'Synopsis 2',
              sourceChapters: '2',
              plotPoints: ['Plot 2'],
              mainCharacters: ['Mara'],
              locations: ['Harbor City'],
              narrativeArc: { setup: 's', conflict: 'c', resolution: 'r' },
              structuralRole: ['climax', 'resolution'],
            },
          ],
          totalEpisodes: 2,
          breakdownNotes: 'two episodes',
        }),
      );

    const breakdown = await (analyzer as any).createEpisodeBreakdown(
      'Rain and ledgers.',
      makeStructure(2),
      preferences,
    );

    // Single call (not fanned out) for short seasons.
    expect(callSpy).toHaveBeenCalledTimes(1);
    expect(breakdown.episodes).toHaveLength(2);
    expect(breakdown.episodes.map((ep: any) => ep.episodeNumber)).toEqual([1, 2]);
  });

  it('falls back to the single all-at-once call when per-episode output is unusable', async () => {
    const analyzer = makeAnalyzer();
    const estimatedEpisodes = 6;
    let call = 0;

    // First N per-episode calls return empty objects (no title/synopsis ->
    // dropped by normalizeSingleEpisode). The fallback single call then returns
    // a full breakdown.
    const callSpy = vi
      .spyOn(analyzer as any, 'callLLM')
      .mockImplementation(async () => {
        call++;
        if (call <= estimatedEpisodes) {
          return JSON.stringify({});
        }
        return JSON.stringify({
          episodes: Array.from({ length: estimatedEpisodes }, (_, i) => ({
            episodeNumber: i + 1,
            title: `Fallback ${i + 1}`,
            synopsis: `Synopsis ${i + 1}`,
            sourceChapters: `${i + 1}`,
            plotPoints: [`Plot ${i + 1}`],
            mainCharacters: ['Mara'],
            locations: ['Harbor City'],
            narrativeArc: { setup: 's', conflict: 'c', resolution: 'r' },
            structuralRole: ['rising'],
          })),
          totalEpisodes: estimatedEpisodes,
          breakdownNotes: 'fallback breakdown',
        });
      });

    const breakdown = await (analyzer as any).createEpisodeBreakdown(
      'Rain and ledgers.',
      makeStructure(estimatedEpisodes),
      preferences,
    );

    // N per-episode attempts + 1 fallback call.
    expect(callSpy).toHaveBeenCalledTimes(estimatedEpisodes + 1);
    expect(breakdown.episodes).toHaveLength(estimatedEpisodes);
    expect(breakdown.episodes[0].title).toBe('Fallback 1');
  });

  it('accepts an {episode:{...}} wrapped per-episode response shape', async () => {
    const analyzer = makeAnalyzer();
    const estimatedEpisodes = 6;

    vi.spyOn(analyzer as any, 'callLLM').mockImplementation(async (...args: unknown[]) => {
      const messages = args[0] as Array<{ content: string }>;
      const n = Number(messages[0].content.match(/Episode number: (\d+) of/)?.[1] ?? 0);
      return JSON.stringify({
        episode: {
          episodeNumber: n,
          title: `Wrapped ${n}`,
          synopsis: `Synopsis ${n}`,
          narrativeArc: { setup: 's', conflict: 'c', resolution: 'r' },
        },
      });
    });

    const breakdown = await (analyzer as any).createEpisodeBreakdown(
      'Rain and ledgers.',
      makeStructure(estimatedEpisodes),
      preferences,
    );

    expect(breakdown.episodes).toHaveLength(estimatedEpisodes);
    expect(breakdown.episodes.map((ep: any) => ep.title)).toEqual([
      'Wrapped 1', 'Wrapped 2', 'Wrapped 3', 'Wrapped 4', 'Wrapped 5', 'Wrapped 6',
    ]);
  });
});

describe('SourceMaterialAnalyzer named-character sweep', () => {
  const analyzer: any = new SourceMaterialAnalyzer({
    provider: 'anthropic',
    model: 'test',
    apiKey: 'test',
    maxTokens: 1000,
    temperature: 0,
  });

  const baseStructure = () => ({
    genre: 'drama',
    tone: 'tense',
    themes: ['loyalty'],
    setting: { timePeriod: 'now', location: 'City', worldDetails: 'streets' },
    protagonist: { name: 'Avery', description: 'The lead.', arc: 'Learns to trust.' },
    // Thin cast: the structure pass only volunteered the antagonist.
    majorCharacters: [
      { name: 'Damon', role: 'antagonist', description: 'The rival.', importance: 'core' },
    ],
    characterArchitecture: {
      protagonist: {},
      supportingCharacters: [
        { characterName: 'Ines', pressureRole: 'mentor', screenTimeTier: 'major' },
        { characterName: 'Rey', pressureRole: 'temptation', screenTimeTier: 'supporting' },
      ],
    },
    keyLocations: [],
    directLanguageFragments: { dialogue: [], prose: [], terminology: [] },
    adaptationGuidance: { narrativeVoice: 'plain', keyThemesToPreserve: ['loyalty'], iconicMoments: [] },
    storyArcs: [{ name: 'Arc', description: 'The arc.', chapters: 'all' }],
    majorPlotPoints: [
      { description: 'It begins.', type: 'inciting_incident', importance: 'critical', approximatePosition: 'early' },
      { description: 'It ends.', type: 'climax', importance: 'critical', approximatePosition: 'late' },
    ],
    estimatedScope: { complexity: 'simple', estimatedEpisodes: 1, reasoning: 'short' },
    writingStyleGuide: { source: 'inferred_from_material', summary: 'plain prose' },
    endingAnalysis: { detectedMode: 'single', reasoning: 'one', explicitEndings: [] },
  });

  const baseBreakdown = () => ({
    episodes: [
      {
        episodeNumber: 1,
        title: 'One',
        synopsis: 'Things happen.',
        sourceChapters: 'all',
        plotPoints: ['It begins.', 'It ends.'],
        // Per-episode main characters name a best friend the structure pass omitted.
        mainCharacters: ['Avery', 'Bex', 'Damon'],
        locations: ['City'],
        narrativeArc: { setup: 'a', conflict: 'b', resolution: 'c' },
        structuralRole: ['hook', 'plotTurn1', 'climax', 'resolution'],
      },
    ],
    totalEpisodes: 1,
    breakdownNotes: 'one episode',
  });

  it('adds named characters from supportingCharacters and per-episode mainCharacters that the structure pass omitted', () => {
    const analysis = analyzer.assembleAnalysis(
      { title: 'Sweep', sourceText: 'Some prose.', userPrompt: 'A drama.' },
      baseStructure(),
      baseBreakdown(),
    );

    const names = analysis.majorCharacters.map((c: any) => c.name);
    // Existing entry preserved.
    expect(names).toContain('Damon');
    // Swept in from characterArchitecture.supportingCharacters.
    expect(names).toContain('Ines');
    expect(names).toContain('Rey');
    // Swept in from the per-episode mainCharacters list.
    expect(names).toContain('Bex');
    // The protagonist is never added to majorCharacters.
    expect(names).not.toContain('Avery');

    const ines = analysis.majorCharacters.find((c: any) => c.name === 'Ines');
    expect(ines.id).toBe('char-ines');
    expect(ines.importance).toBe('supporting');
  });

  it('does not duplicate a character already present (case-insensitive) and caps the cast', () => {
    const structure = baseStructure();
    // Damon already exists; the breakdown lists him with different casing.
    structure.majorCharacters[0].name = 'Damon';
    const breakdown = baseBreakdown();
    breakdown.episodes[0].mainCharacters = ['Avery', 'damon', 'Bex', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];

    const analysis = analyzer.assembleAnalysis(
      { title: 'Sweep', sourceText: 'Some prose.', userPrompt: 'A drama.' },
      structure,
      breakdown,
    );

    const damons = analysis.majorCharacters.filter((c: any) => c.name.toLowerCase() === 'damon');
    expect(damons).toHaveLength(1);
    // Cap holds the total at 8.
    expect(analysis.majorCharacters.length).toBeLessThanOrEqual(8);
  });
});

describe('SourceMaterialAnalyzer.parseAnalysisWithCompactRetry (last-resort parse recovery)', () => {
  afterEach(() => BaseAgent.setLlmTransportOverride(null));
  const analyzer: any = new SourceMaterialAnalyzer({ provider: 'anthropic', model: 'test', apiKey: 'test', maxTokens: 1000, temperature: 0 });
  const GOOD = '{"genre":"drama","themes":["voice"]}';

  it('takes the single-call path on a clean first response (no retry)', async () => {
    let calls = 0;
    BaseAgent.setLlmTransportOverride(async () => { calls += 1; return GOOD; });
    const out = await analyzer.parseAnalysisWithCompactRetry('BASE', GOOD, 'structure analysis');
    expect(out.genre).toBe('drama');
    expect(calls).toBe(0);
  });

  it('retries compactly when the first response is truncated, and the retry succeeds', async () => {
    let prompt = '';
    BaseAgent.setLlmTransportOverride(async (req: any) => { prompt = req.messages.map((m: any) => String(m.content)).join('\n'); return GOOD; });
    const truncated = '{"genre":"drama","themes":["voi'; // truncated mid-string → parseJSON recovers + flags truncation → retry
    const out = await analyzer.parseAnalysisWithCompactRetry('BASE_PROMPT', truncated, 'structure analysis');
    expect(out.genre).toBe('drama');
    expect(prompt).toContain('strictly-valid JSON');
    expect(prompt).toContain('BASE_PROMPT');
  });
});
