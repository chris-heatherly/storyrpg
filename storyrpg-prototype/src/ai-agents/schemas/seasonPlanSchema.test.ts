import { describe, expect, it } from 'vitest';

import {
  buildSeasonArcEnrichmentJsonSchema,
  buildSeasonPlanJsonSchema,
} from './seasonPlanSchema';

describe('seasonPlanSchema', () => {
  it('uses explicit episode records instead of disagreeing map and array shapes', () => {
    const schema = buildSeasonPlanJsonSchema({ expectedArcCount: 3, expectedEpisodeCount: 8 });
    const properties = (schema.schema as any).properties;

    expect(properties.arcs).toMatchObject({ type: 'array', minItems: 3, maxItems: 3 });
    expect(properties.arcs.items.required).toEqual(expect.arrayContaining([
      'id',
      'episodeRange',
      'arcQuestion',
      'episodeTurnouts',
    ]));
    expect(properties.episodeEncounters).toMatchObject({ type: 'array', minItems: 8, maxItems: 8 });
    expect(properties.episodeEncounters.items.required).toEqual(['episodeNumber', 'encounters']);
    expect(properties.episodeEndingRoutes.items.required).toEqual(['episodeNumber', 'routes']);
  });

  it('requires an exact keyed arc set for focused enrichment repair', () => {
    const schema = buildSeasonArcEnrichmentJsonSchema(3);
    const arcs = (schema.schema as any).properties.arcs;

    expect(arcs.minItems).toBe(3);
    expect(arcs.maxItems).toBe(3);
    expect(arcs.items.properties.id).toMatchObject({ type: 'string', minLength: 1 });
  });
});
