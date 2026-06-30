import { describe, expect, it } from 'vitest';
import type { Story } from '../../types/story';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { SourceMaterialAnalysis, StoryEndingTarget } from '../../types/sourceAnalysis';
import type { CharacterTreatmentRealizationContract, PlannedScene, SeasonScenePlan } from '../../types/scenePlan';
import { extractTreatmentFromMarkdown } from '../utils/treatmentExtraction';
import {
  assignCharacterTreatmentContractsToScenes,
  buildCharacterTreatmentContracts,
} from '../utils/characterTreatmentContracts';
import { CharacterTreatmentRealizationValidator } from './CharacterTreatmentRealizationValidator';

const endingWitness: StoryEndingTarget = {
  id: 'ending-witness',
  name: 'The Witness',
  summary: 'Kylie chooses herself, keeps the blog, and tells the story straight.',
  emotionalRegister: 'triumphant-warm',
  themePayoff: 'Her voice belongs to her.',
  stateDrivers: [{ type: 'identity', label: 'Kylie keeps her voice and refuses possession.' }],
  targetConditions: ['Kylie refuses to surrender the blog.'],
  sourceConfidence: 'explicit',
};

function protagonistGuidance() {
  const treatment = extractTreatmentFromMarkdown(`
# Bite Me story treatment

## 2. Season Promise And Dramatic Engine
- **Season dramatic question:** Can Kylie author her own story?

### Protagonist

- **Name and pronouns:** Kylie Marinescu (she/her)
- **Role in the world:** 34, American food writer turned blogger; quarter-Romanian on her father's side. Her grandmother Veronica escaped Bucharest in 1962 and never explained why.
- **Want:** Build a blog with her name on it instead of her ex's.
- **Need:** To author her own life on her own terms.
- **Lie:** Being chosen by a beautiful man is the same as being known and safe.
- **Wound:** The cancelled engagement broke her sense of being known publicly.
- **Truth:** Her voice belongs to her.
- **Arc mode:** Positive transformation from observer to author.
- **Starting identity:** The observer who orders second, watches the room, and writes later.
- **Possible end states:**
  - The Witness — chooses herself; the blog triples readership.
  - The Consort — accepts permanence with Victor; the blog goes dark.
- **Climax choice:** Kylie decides whose hand she takes and whether she gives Victor the blog.
- **Pressure points:** Her grandmother's flight from Romania; her niece Sadie; the unfinished memoir.
- **Visual identity:** Honey-blonde hair, tortoiseshell glasses to write, slip dresses under a trench.

## Episode Outline
### Episode 1: Doorway
- **Story Circle role:** you
- **Episode promise:** Kylie tries to start over.
- **Cliffhanger question:** Who is watching her?
`);
  return treatment.seasonGuidance!.protagonistGuidance!;
}

function contracts(): CharacterTreatmentRealizationContract[] {
  return buildCharacterTreatmentContracts({
    guidance: protagonistGuidance(),
    protagonist: {
      id: 'kylie',
      name: 'Kylie Marinescu',
      description: 'American food writer turned blogger.',
      fashionStyle: { styleSummary: 'Slip dresses, trench, and writing glasses.' },
    },
    characterArchitecture: {
      protagonist: {
        lie: 'Being chosen is being safe.',
        originPressure: 'Public humiliation after Daniel.',
        truth: 'Her voice belongs to her.',
        want: 'Build the blog.',
        need: 'Author her own life.',
        arcMode: 'positive',
        climaxChoice: {
          choiceQuestion: 'Will Kylie give Victor the blog?',
          integrateTruthOption: 'Keep her voice.',
          recommitLieOption: 'Surrender to Victor.',
          activeChoiceMechanism: 'Refusal.',
        },
      },
      supportingCharacters: [],
    },
    endings: [endingWitness],
    totalEpisodes: 3,
    treatmentSourced: true,
  });
}

function plannedScene(id: string, episodeNumber: number, order: number, text: string): PlannedScene {
  return {
    id,
    episodeNumber,
    order,
    kind: 'standard',
    title: text,
    dramaticPurpose: text,
    narrativeRole: episodeNumber === 3 ? 'release' : order === 0 ? 'setup' : 'turn',
    locations: ['Bucharest'],
    npcsInvolved: [],
    setsUp: [],
    paysOff: [],
    stakes: text,
    hasChoice: true,
    choiceType: 'dilemma',
    consequenceTier: episodeNumber === 3 ? 'branch' : 'tint',
    budgetWeight: 1,
    turnContract: {
      turnId: `${id}-turn`,
      source: 'treatment',
      centralTurn: text,
      beforeState: 'Kylie begins guarded.',
      turnEvent: text,
      afterState: 'Kylie is under changed pressure.',
      handoff: 'The pressure follows her forward.',
    },
  };
}

function assignedPlan(selectedContracts = contracts()): SeasonPlan {
  const scenes = [
    plannedScene('s1-1', 1, 0, 'Kylie arrives as an observer who orders second, watches the room, and starts the blog under Veronica pressure.'),
    plannedScene('s2-1', 2, 0, 'Kylie tests the lie that being chosen by a beautiful man means safety.'),
    plannedScene('s3-1', 3, 0, 'Kylie faces the return choice: keep her voice and blog or give Victor the story.'),
  ];
  const plan = {
    totalEpisodes: 3,
    protagonist: { id: 'kylie', name: 'Kylie Marinescu', description: 'American food writer turned blogger.' },
    characterArchitecture: {
      protagonist: {
        lie: 'Being chosen by a beautiful man is the same as being known and safe.',
        originPressure: 'The cancelled engagement broke her public sense of being known.',
        truth: 'Her voice belongs to her.',
        want: 'Build the blog with her name on it.',
        need: 'Author her own life on her own terms.',
        arcMode: 'positive',
        climaxChoice: {
          choiceQuestion: 'Will Kylie give Victor the blog?',
          integrateTruthOption: 'Keep her voice.',
          recommitLieOption: 'Surrender the blog.',
          activeChoiceMechanism: 'Refusal at the finale.',
        },
      },
      supportingCharacters: [],
    },
    arcs: [{
      id: 'arc-voice',
      name: 'Voice',
      description: 'Observer to author.',
      episodeRange: { start: 1, end: 3 },
      keyMoments: [],
      status: 'not_started',
      completionPercentage: 0,
      identityPressureFacet: 'Kylie moves from chosen/safe lie to claiming her voice.',
      finaleAnswer: 'She keeps the blog and authors her own story.',
      episodeTurnouts: [],
    }],
    resolvedEndings: [endingWitness],
    choiceMoments: [{ id: 'final-choice', episode: 3, anchor: 'Give Victor the blog or keep her voice.' }],
    informationLedger: [{ id: 'veronica-flight', label: "Veronica's 1962 flight", introducedEpisode: 1, plannedRevealEpisode: 2 }],
    consequenceChains: [],
    episodes: [1, 2, 3].map((episodeNumber) => ({
      episodeNumber,
      title: `Episode ${episodeNumber}`,
      synopsis: `Episode ${episodeNumber}`,
      storyCircleRole: episodeNumber === 1 ? ['you'] : episodeNumber === 2 ? ['find'] : ['change'],
      status: 'planned',
      dependsOn: [],
      setupsForEpisodes: [],
      resolvesPlotsFrom: [],
      introducesCharacters: [],
    })),
    characterTreatmentContracts: selectedContracts,
  } as unknown as SeasonPlan;
  assignCharacterTreatmentContractsToScenes(plan, scenes);
  plan.scenePlan = {
    scenes,
    byEpisode: { 1: ['s1-1'], 2: ['s2-1'], 3: ['s3-1'] },
    setupPayoffEdges: [],
    characterTreatmentContracts: selectedContracts,
  } as SeasonScenePlan;
  return plan;
}

function analysis(selectedContracts = contracts()): SourceMaterialAnalysis {
  return {
    sourceFormat: 'story_treatment',
    sourceTitle: 'Bite Me',
    protagonist: {
      id: 'kylie',
      name: 'Kylie Marinescu',
      description: 'American food writer turned blogger.',
      arc: 'Observer to author.',
      fashionStyle: { styleSummary: 'Honey-blonde, tortoiseshell glasses, slip dresses, trench.' },
    },
    characterTreatmentContracts: selectedContracts,
    treatmentSeasonGuidance: { protagonistGuidance: protagonistGuidance() },
    characterArchitecture: {
      protagonist: {
        lie: 'Being chosen by a beautiful man is the same as being known and safe.',
        originPressure: 'The cancelled engagement broke her public sense of being known.',
        truth: 'Her voice belongs to her.',
        want: 'Build the blog with her name on it.',
        need: 'Author her own life on her own terms.',
        arcMode: 'positive',
        climaxChoice: {
          choiceQuestion: 'Will Kylie give Victor the blog?',
          integrateTruthOption: 'Keep her voice.',
          recommitLieOption: 'Surrender the blog.',
          activeChoiceMechanism: 'Refusal at the finale.',
        },
      },
      supportingCharacters: [],
    },
    resolvedEndings: [endingWitness],
    episodeBreakdown: [],
    totalEstimatedEpisodes: 3,
  } as unknown as SourceMaterialAnalysis;
}

function story(texts: Record<string, string>): Story {
  return {
    id: 'story',
    title: 'Bite Me',
    genre: 'paranormal rom-com',
    synopsis: 'Kylie starts over.',
    coverImage: '',
    initialState: {
      attributes: { charm: 0, wit: 0, courage: 0, empathy: 0, resolve: 0, resourcefulness: 0 },
      skills: {},
      tags: [],
      inventory: [],
    },
    npcs: [{
      id: 'kylie',
      name: 'Kylie Marinescu',
      role: 'protagonist',
      pronouns: 'she/her',
      description: 'American food writer turned blogger with a public wound and a blog to claim.',
      want: 'Build the blog with her name on it.',
      flaw: 'She confuses being chosen with being safe.',
      arc: { startState: 'observer', endState: 'author who keeps her voice' },
    }],
    episodes: [1, 2, 3].map((number) => ({
      id: `ep-${number}`,
      number,
      title: `Episode ${number}`,
      synopsis: `Episode ${number}`,
      coverImage: '',
      startingSceneId: `s${number}-1`,
      scenes: [{
        id: `s${number}-1`,
        name: `Scene ${number}`,
        startingBeatId: 'b1',
        leadsTo: [],
        beats: [{ id: 'b1', text: texts[`s${number}-1`] ?? 'Quiet summary without protagonist pressure.' } as never],
      }],
    })),
  } as unknown as Story;
}

describe('CharacterTreatmentRealizationValidator', () => {
  it('extracts protagonist guidance and builds field contracts', () => {
    const guidance = protagonistGuidance();
    expect(guidance.want).toContain('Build a blog');
    expect(guidance.possibleEndStates).toHaveLength(2);
    const built = contracts();
    expect(built.some((contract) => contract.contractKind === 'starting_identity')).toBe(true);
    expect(built.some((contract) => contract.contractKind === 'ending_state')).toBe(true);
    expect(built.filter((contract) => contract.contractKind === 'role_fact').length).toBeGreaterThan(1);
    expect(built.find((contract) => contract.contractKind === 'visual_identity')?.requiredRealization).toEqual(['character_bible', 'visual_profile']);
  });

  it('fails plan-time when treatment contracts are not assigned to concrete artifacts', () => {
    const selected = contracts().filter((contract) => contract.contractKind === 'starting_identity');
    const plan = assignedPlan(selected);
    plan.scenePlan = { scenes: [], byEpisode: {}, setupPayoffEdges: [], characterTreatmentContracts: selected };
    const result = new CharacterTreatmentRealizationValidator().validatePlan({
      seasonPlan: plan,
      sourceAnalysis: analysis(selected),
      treatmentSourced: true,
    });
    expect(result.valid).toBe(false);
    expect(result.issues[0].message).toContain('Starting identity');
  });

  it('fails plan-time when an ending state has no mapped ending target', () => {
    const selected = contracts().filter((contract) => contract.contractKind === 'ending_state').slice(0, 1);
    const plan = assignedPlan(selected);
    plan.resolvedEndings = [];
    for (const contract of selected) contract.targetEndingIds = [];
    const result = new CharacterTreatmentRealizationValidator().validatePlan({
      seasonPlan: plan,
      sourceAnalysis: analysis(selected),
      treatmentSourced: true,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join('\n')).toContain('Possible end states');
  });

  it('fails final-story validation when the opening baseline is not reader-facing', () => {
    const selected = contracts().filter((contract) => contract.contractKind === 'starting_identity');
    const plan = assignedPlan(selected);
    const result = new CharacterTreatmentRealizationValidator().validate({
      story: story({ 's1-1': 'Kylie enters. The night is pretty.' }),
      seasonPlan: plan,
      sourceAnalysis: analysis(selected),
      treatmentSourced: true,
      phase: 'final',
    });
    expect(result.valid).toBe(false);
    expect(result.issues[0].message).toContain('not realized');
  });

  it('passes final-story validation when prose stages baseline, lie pressure, and return choice', () => {
    const selected = contracts().filter((contract) =>
      ['starting_identity', 'lie_pressure', 'climax_choice'].includes(contract.contractKind)
    );
    const plan = assignedPlan(selected);
    const result = new CharacterTreatmentRealizationValidator().validate({
      story: story({
        's1-1': 'Kylie orders second, watches the room, writes later, and turns the blog into the first thing she can claim under her own name.',
        's2-1': 'When Victor chooses her, safety feels like a beautiful trap; the cost of being known is suddenly her voice.',
        's3-1': 'At the final choice, Kylie refuses to give Victor the blog, keeps her voice, and walks into the ending as the author of her own story.',
      }),
      seasonPlan: plan,
      sourceAnalysis: analysis(selected),
      treatmentSourced: true,
      phase: 'final',
    });
    expect(result.valid).toBe(true);
  });

  it('does not require visual identity to be repeated in final prose when visual metadata exists', () => {
    const selected = contracts().filter((contract) => contract.contractKind === 'visual_identity');
    const plan = assignedPlan(selected);
    const result = new CharacterTreatmentRealizationValidator().validate({
      story: story({ 's1-1': 'Kylie starts the night without listing her outfit.' }),
      seasonPlan: plan,
      sourceAnalysis: analysis(selected),
      treatmentSourced: true,
      phase: 'final',
    });
    expect(result.valid).toBe(true);
  });
});
