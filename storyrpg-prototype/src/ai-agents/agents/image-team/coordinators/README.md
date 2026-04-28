# Image Team Coordinators

`ImageAgentTeam.ts` is ~4 kLOC and lives under `@ts-nocheck`. It mixes four
distinct concerns: planning, illustration, consistency, and quality. This
directory breaks those into four coordinator classes that `ImageAgentTeam`
will compose.

## Status

| Coordinator | Status | Source methods in `ImageAgentTeam.ts` |
|---|---|---|
| `ImagePlanningCoordinator` | scaffolded | `generateFullSceneVisuals`, `generateColorScript`, `generateColorScriptThumbnails`, `getMoodSpecFromColorScript`, `generateMoodSpecForBeat`, `adjustColorScriptForBranch`, `registerMotifLibrary`, `suggestRhythmRole`, `suggestTransitionType`, `buildPacingSpec`, `suggestEnvironmentPersonality`, `analyzeShotVariety`, `suggestShotType`, `suggestCameraHeight`, `shouldCrossLine`, `buildDefaultCameraSpec`, `validateCameraSpec`, `validateShotTypeForBeat` |
| `ImageIllustrationCoordinator` | scaffolded | `generateSceneImagePrompt`, `generateBeatImagePrompt`, `generateCoverImagePrompt`, `generateCharacterMasterPrompt`, `generateLocationMasterPrompt`, `generateEncounterPrompts`, `generateCharacterReferenceSheet`, `generateCharacterExpressionSheet`, `generateCompleteCharacterReference`, `generateReferenceSheetImages`, `generateCompositeReferenceSheet`, `generateFullCharacterReferences`, `generateIndividualViewImages`, `generateExpressionSheetImages`, `generateSceneOpeningWithTransition`, `generateSceneVisualsWithDiversityCheck` |
| `ImageConsistencyCoordinator` | scaffolded | `hasReferenceSheet`, `getReferenceSheet`, `clearReferenceSheets`, `setReferenceSheetIdentityFingerprint`, `auditIdentityDrift`, `invalidateStaleReferenceSheets`, `validateImageConsistency`, `getCharacterReferenceImages`, `getCompositeReferenceImage`, `getCharacterFaceCrop`, `getCharacterConsistencyInfo`, `runIdentityConsistencyGate` (private), `setIdentityGateConfig`, `resetIdentityRegenerationBudget`, `setLastSceneShot`, `getLastSceneShot`, `clearLastSceneShot` |
| `ImageQualityCoordinator` | scaffolded | `validateImage`, `validateComposition`, `validateConsistency`, `validatePoseDiversity`, `quickDiversityCheck`, `validateTransitions`, `validateExpressions`, `validateEmotionStructure`, `validateExpressionPacing`, `checkEmotionalTransition`, `validatePlanExpressions`, `validateLightingColor`, `validateMoodSpecStructure`, `checkMoodVsColorScript`, `validateVisualStorytelling`, `validateImageSequence`, `validateStorytellingSpec`, `validateTransitionChoice`, `computeContractFidelityMetrics` |

## Migration approach

Because `ImageAgentTeam` fields are heavily cross-referenced (e.g. the
composite reference map is read by consistency and illustration alike),
each coordinator should extract **behavior only**. The fields stay on
`ImageAgentTeam` for now, and coordinators receive them via constructor
injection or a narrow `ImageTeamContext` interface.

Recommended sequence:

1. Move the smallest isolated methods first (e.g. `getExpressionDefinitions`
   — already pure — into `ImagePlanningCoordinator`).
2. After each move, keep `ImageAgentTeam` methods as thin delegators so the
   public surface doesn't shift.
3. Once all methods delegate, flip callers (pipeline, tests) to use the
   coordinators directly, then delete the delegators.
4. Phase 7 will consolidate the LLM validators inside `ImageQualityCoordinator`
   behind a single `VisualQualityJudge`, collapsing nine files into one
   pluggable judge.

## Non-goals of Phase 6

- **No behavior changes.** Pure re-organization.
- **No image or prompt format changes.** Those are Phase 7 (`VisualQualityJudge`).
- **No `@ts-nocheck` removal from `ImageAgentTeam`** until every coordinator
  is fully extracted and the class is thin enough to type cleanly.

## Tests

Each coordinator file must ship with a smoke test that mocks the
underlying agents (e.g. stub `VisualIllustratorAgent.generatePrompt` to
return a fixture) and asserts the coordinator's contract. Today the
smoke tests for `ImageAgentTeam` are absent; a follow-up in Phase 8 will
add them ahead of the extraction to lock in behavior.
