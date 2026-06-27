import { describe, expect, it } from 'vitest';

const { sanitizeJobState, scrubPlanningRegisterProse } = require('./sanitizeJobState');

describe('sanitizeJobState planning-register scrub', () => {
  it('rewrites choice-response planning prose in nested worker state', () => {
    const raw =
      "The bell over the door to Lumina Books chimes softly as you step inside.\n\n" +
      "The next beat visibly responds to the authored choice: At the door of Valcescu Club on night two: accept Mika's key card to the side entrance, or thank her politely and leave it.";

    const sanitized = sanitizeJobState({
      checkpoint: {
        output: {
          text: raw,
          designNotes: 'Deterministic fallback: preserves authored choice pressure when ChoiceAuthor does not produce a usable choice set.',
        },
      },
    });

    expect(sanitized.checkpoint.output.text).not.toContain('The next beat visibly responds');
    expect(sanitized.checkpoint.output.text).toContain("The memory of Mika's key card");
    expect(sanitized.checkpoint.output.designNotes).toContain('preserves treatment pressure');
  });

  it('rewrites treatment-residue planning prose in nested worker state', () => {
    const sanitized = sanitizeJobState({
      checkpoint: {
        output: {
          reminderPlan: {
            immediate: 'Show immediate residue from the authored path: Walking over to Victor at the rooftop forces Mika to invent a reason she warned you off, opening a small Mika lie you can catch in a later episode.',
            shortTerm: 'Keep this authored residue visible after reconvergence: Mika keeps watching the exits.',
            later: "Carry forward treatment residue: The key card to Valcescu Club's side entrance.",
          },
        },
      },
    });

    const plan = sanitized.checkpoint.output.reminderPlan;
    expect(plan.immediate).toContain('The aftermath changes');
    expect(plan.shortTerm).toContain('The consequence stays visible');
    expect(plan.later).toContain('Let the consequence return');
    expect(JSON.stringify(plan)).not.toMatch(/Show immediate residue|authored path|authored residue|reconvergence|later episode|Carry forward treatment residue/i);
  });

  it('rewrites hook/promise/stakes treatment cards in nested worker state', () => {
    const sanitized = sanitizeJobState({
      checkpoint: {
        output: {
          dramaticPurpose: 'Hook — Kylie unpacks in a Belle Époque walk-up as the sun sets through the Lipscani window; promise — Reinvention, glamour, a city that owes her a better story; stakes — a FaceTime to her niece Sadie ("are there vampires in Romania?").',
        },
      },
    });

    const purpose = sanitized.checkpoint.output.dramaticPurpose;
    expect(purpose).toContain('When the screen goes dark');
    expect(purpose).toContain('Bucharest keeps its secrets');
    expect(purpose).not.toMatch(/\bHook\s*—|\bpromise\s*—|\bstakes\s*—/i);
    expect(scrubPlanningRegisterProse('Hook — Kylie unpacks in the apartment.')).toBe('Kylie unpacks in the apartment.');
  });

  it('strips cold-open wrapper planning prose in nested worker state', () => {
    const raw = 'Cold-open prelude: Kylie unpacks in a Belle Époque walk-up; a FaceTime to Sadie asks about vampires.\n\nThen continue into the planned scene: Mika adopts Kylie at the door of Vâlcescu Club on night two.';
    const sanitized = sanitizeJobState({
      checkpoint: {
        output: {
          geography: raw,
        },
      },
    });

    expect(sanitized.checkpoint.output.geography).toBe('Mika adopts Kylie at the door of Vâlcescu Club on night two.');
    expect(sanitized.checkpoint.output.geography).not.toMatch(/Cold-open prelude|Then continue into the planned scene/i);
  });

  it('rewrites sequence-staging directives in persisted state', () => {
    const sanitized = sanitizeJobState({
      checkpoint: {
        output: {
          activity: 'Stage the pressure through visible action, reaction, object movement, distance, or dialogue around Hook — Kylie unpacks in the apartment; promise — reinvention; stakes — Sadie asks about vampires.',
        },
      },
    });

    expect(sanitized.checkpoint.output.activity).toContain('The room answers through posture');
    expect(sanitized.checkpoint.output.activity).toContain('Kylie unpacks in the apartment');
    expect(sanitized.checkpoint.output.activity).not.toMatch(/Stage the pressure|Hook\s*—|promise\s*—|stakes\s*—/i);
    expect(scrubPlanningRegisterProse('The room answers through posture around Hook — Kylie unpacks in the Lipscani apartment.')).toBe('The room answers through posture around Kylie unpacks in the Lipscani apartment.');
  });

  it('strips abstract choice-response mechanics summaries from worker state', () => {
    const sanitized = sanitizeJobState({
      checkpoint: {
        output: {
          reminder: 'The response changes access, trust, information, or danger around At a Lipscani bookshop, Stela presses a chunk of rose.. at Lumina....',
        },
      },
    });

    expect(sanitized.checkpoint.output.reminder).toBe('At a Lipscani bookshop, Stela presses a chunk of rose at Lumina.');
    expect(sanitized.checkpoint.output.reminder).not.toContain('access, trust, information, or danger');
  });

  it('rewrites visible skill-practice feedback in persisted state', () => {
    const sanitized = sanitizeJobState({
      checkpoint: {
        output: {
          feedback: 'You feel more practiced in persuasion as caution lingers at the edge of your next breath.',
        },
      },
    });

    expect(sanitized.checkpoint.output.feedback).toBe('Your next words come a little steadier as caution lingers at the edge of your next breath.');
    expect(sanitized.checkpoint.output.feedback).not.toContain('persuasion');
  });

  it('leaves ordinary prose untouched', () => {
    const text = 'The bell over the door chimes softly as you step inside.';
    expect(scrubPlanningRegisterProse(text)).toBe(text);
  });
});
