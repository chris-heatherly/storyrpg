/** Sanitized failure signatures from the latest Bite Me architecture replays. */
export const BITE_ME_R82_FAILURE_FIXTURE = {
  run: 'r82',
  blockers: [
    { code: 'runtime_topology_drift', expectedScene: 's1-6', actualScene: 'treatment-enc-1-1' },
    { code: 'premise_missing', contract: 'Name and pronouns' },
    { code: 'premise_missing', contract: 'Role in the world' },
    { code: 'premise_missing', contract: 'Wound' },
    { code: 'route_missing', eventId: 'event:ep1-u7', routes: ['partialVictory', 'complicated'] },
    { code: 'relationship_pacing', label: 'friend' },
  ],
} as const;

export const BITE_ME_R83_FAILURE_FIXTURE = {
  run: 'r83',
  blockers: [
    { code: 'premise_missing', contract: 'Wound', missing: ['Veronica', '1962', 'Marinescu line'] },
    { code: 'route_missing', eventId: 'event:ep1-u7', routes: ['victory', 'success'] },
    { code: 'relationship_pacing', label: 'friend', sceneId: 's1-2' },
  ],
} as const;

export const BITE_ME_R84_FAILURE_FIXTURE = {
  run: 'r84',
  blockers: [
    { code: 'missing_scene_validation_lock', sceneId: 'treatment-enc-1-1', owner: 'encounter' },
  ],
} as const;

export const BITE_ME_R85_FAILURE_FIXTURE = {
  run: 'r85',
  blockers: [
    { code: 'unsafe_fallback_prose', sceneId: 's1-2', owner: 'choice', fields: ['reactionText', 'residueHints.description'] },
  ],
} as const;

export const BITE_ME_R86_FAILURE_FIXTURE = {
  run: 'r86',
  blockers: [
    { code: 'treatment_event_ledger_violation', sceneId: 's1-7', eventId: 'event:ep1-u8:aftermath' },
    { code: 'source_synopsis_leak', sceneId: 'treatment-enc-1-1', field: 'encounter.phases[0].description' },
    { code: 'premise_missing', sceneId: 's1-1', contract: 'Wound' },
    { code: 'relationship_pacing', sceneId: 's1-2', label: 'friend' },
    { code: 'scene_spatial_unit', sceneId: 's1-2' },
    { code: 'group_membership_pacing', sceneId: 's1-4', label: 'friends' },
  ],
} as const;
