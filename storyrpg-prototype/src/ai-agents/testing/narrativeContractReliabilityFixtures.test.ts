import { describe, expect, it } from 'vitest';
import {
  BITE_ME_R82_FAILURE_FIXTURE,
  BITE_ME_R83_FAILURE_FIXTURE,
  BITE_ME_R84_FAILURE_FIXTURE,
  BITE_ME_R85_FAILURE_FIXTURE,
  BITE_ME_R86_FAILURE_FIXTURE,
} from './narrativeContractReliabilityFixtures';

describe('Bite Me reliability fixtures', () => {
  it('keeps the topology regression and current realization failures distinct', () => {
    expect(BITE_ME_R82_FAILURE_FIXTURE.blockers.some((blocker) => blocker.code === 'runtime_topology_drift')).toBe(true);
    expect(BITE_ME_R83_FAILURE_FIXTURE.blockers.some((blocker) => (blocker.code as string) === 'runtime_topology_drift')).toBe(false);
    expect(BITE_ME_R83_FAILURE_FIXTURE.blockers.find((blocker) => blocker.code === 'relationship_pacing')).toMatchObject({ sceneId: 's1-2' });
  });

  it('records the owner-stage failures that the new gates must prevent', () => {
    expect(BITE_ME_R84_FAILURE_FIXTURE.blockers[0].code).toBe('missing_scene_validation_lock');
    expect(BITE_ME_R85_FAILURE_FIXTURE.blockers[0].owner).toBe('choice');
    expect(BITE_ME_R86_FAILURE_FIXTURE.blockers.map((blocker) => blocker.code)).toEqual(expect.arrayContaining([
      'treatment_event_ledger_violation',
      'source_synopsis_leak',
      'scene_spatial_unit',
      'group_membership_pacing',
    ]));
  });
});
