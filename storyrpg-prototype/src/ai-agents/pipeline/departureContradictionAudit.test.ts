import { describe, expect, it } from 'vitest';
import type { Story } from '../../types';
import { auditDepartureContradictions } from './departureContradictionAudit';

function story(scenes: unknown[]): Story {
  return { id: 's', title: 'S', episodes: [{ id: 'ep1', number: 1, scenes }] } as unknown as Story;
}

describe('auditDepartureContradictions', () => {
  it('flags a bridge beat announcing home that routes to a venue (run 14-50-23 s1-4)', () => {
    const findings = auditDepartureContradictions(story([
      {
        id: 's1-4', name: 'Valescu Club', timeline: { location: 'Valescu Club' },
        beats: [
          { id: 'b1', text: 'The pact forms over raised glasses.' },
          { id: 'b1-bridge', text: 'They agree the rules are simple, and you decide to walk home and process the night.', nextSceneId: 's1-5' },
        ],
      },
      { id: 's1-5', name: 'Rooftop Bar', timeline: { location: 'Rooftop Bar' }, beats: [{ id: 'b2', text: 'The air up here is cooler.' }] },
    ]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ sceneId: 's1-4', beatId: 'b1-bridge', nextSceneId: 's1-5' });
  });

  it('accepts "walk home" when the next scene IS the walk home (Cismigiu encounter)', () => {
    const findings = auditDepartureContradictions(story([
      {
        id: 's1-5', name: 'Rooftop Bar', timeline: { location: 'Rooftop Bar' },
        beats: [{ id: 'b1', text: 'Stela quietly gets the check. The walk home awaits.', nextSceneId: 'treatment-enc-1-1' }],
      },
      {
        id: 'treatment-enc-1-1',
        name: 'Walking home through Cismigiu, she is attacked and rescued by the…',
        timeline: { location: 'Cismigiu Gardens' },
        beats: [],
      },
    ]));
    expect(findings).toEqual([]);
  });

  it('accepts a home departure that actually routes home', () => {
    const findings = auditDepartureContradictions(story([
      { id: 'enc', name: 'Gardens', timeline: { location: 'Cismigiu Gardens' }, beats: [{ id: 'b1', text: 'He walks you home in silence.', nextSceneId: 's1-6' }] },
      { id: 's1-6', name: 'The 4am post', timeline: { location: "Kylie's Lipscani Apartment" }, beats: [{ id: 'b2', text: 'The quiet of your apartment.' }] },
    ]));
    expect(findings).toEqual([]);
  });

  it('ignores closing beats with no departure announcement', () => {
    const findings = auditDepartureContradictions(story([
      { id: 's1', name: 'Club', beats: [{ id: 'b1', text: 'The night hums on.', nextSceneId: 's2' }] },
      { id: 's2', name: 'Rooftop', beats: [] },
    ]));
    expect(findings).toEqual([]);
  });
});
