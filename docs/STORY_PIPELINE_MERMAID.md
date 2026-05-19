# StoryRPG Pipeline Mermaid Chart

**Last Updated:** May 2026

This diagram shows the end-to-end StoryRPG generation pipeline, from the Generator UI through the proxy worker, multi-agent story generation, media generation, QA, output writing, and playback.

```mermaid
flowchart TD
    A[GeneratorScreen: user starts generation] --> B[PipelineClient]
    B --> C[Express proxy server]
    C --> D[Worker process]
    D --> E[Build PipelineConfig]
    E --> F[FullStoryPipeline]

    subgraph Inputs["Inputs and configuration"]
        I1[Story brief or source document]
        I2[Generation settings]
        I3[LLM provider settings]
        I4[Image, audio, video settings]
        I5[Optional approved style-bible anchors]
    end

    I1 --> E
    I2 --> E
    I3 --> E
    I4 --> E
    I5 --> E

    subgraph Planning["Analysis and season planning"]
        P0{Adapting source material?}
        P1[SourceMaterialAnalyzer]
        P2[SeasonPlannerAgent]
        P3[SevenPointCoverageValidator]
        P4[SeasonPlan]
    end

    F --> P0
    P0 -- yes --> P1
    P0 -- no --> P2
    P1 --> P2
    P2 --> P3
    P3 -->|repair feedback if needed| P2
    P3 --> P4

    subgraph Foundation["Story foundation"]
        S1[StyleArchitect: ArtStyleProfile]
        S2[WorldBuilder: WorldBible]
        S3[CharacterDesigner: CharacterBible]
        S4[PhaseValidator: character bible]
        S5[ThreadPlanner: setup/payoff ledger]
        S6[TwistArchitect: reversals and foreshadowing]
        S7[CharacterArcTracker: identity and relationship targets]
    end

    P4 --> S1
    P4 --> S2
    S2 --> S3
    S3 --> S4
    S4 --> S5
    S5 --> S6
    S6 --> S7

    subgraph EpisodeLoop["Per-episode generation loop"]
        E0[Episode context and prior summaries]
        E1[StoryArchitect: EpisodeBlueprint]
        E2[BranchManager: branch analysis and reconvergence]
        E3{Scene type}
        E4[SceneWriter: non-encounter beat prose]
        E5[EncounterArchitect: encounter phases, choices, storylets]
        E6[ChoiceAuthor: choices, consequences, checks]
        E7[Incremental validators]
        E8[Quick structural and best-practice validation]
        E9[Optional SceneCritic rewrite pass]
        E10[Episode assembly]
        E11[Episode summary for continuity]
    end

    S7 --> E0
    E0 --> E1
    E1 --> E2
    E2 --> E3
    E3 -- standard scene --> E4
    E3 -- encounter scene --> E5
    E4 --> E6
    E5 --> E6
    E6 --> E7
    E7 -->|repair feedback if needed| E4
    E7 --> E8
    E8 --> E9
    E9 --> E10
    E8 --> E10
    E10 --> E11
    E11 --> E0

    subgraph NarrativeQA["Narrative QA and validators"]
        Q1[ContinuityChecker]
        Q2[VoiceValidator]
        Q3[StakesAnalyzer]
        Q4[StakesTriangleValidator]
        Q5[FiveFactorValidator]
        Q6[PixarPrinciplesValidator]
        Q7[CliffhangerValidator]
        Q8[ChoiceDistributionValidator]
        Q9[SetupPayoffValidator]
        Q10[TwistQualityValidator]
        Q11[ArcDeltaValidator]
        Q12[DivergenceValidator]
        Q13[Validation report]
    end

    E10 --> Q1
    E10 --> Q2
    E10 --> Q3
    E10 --> Q4
    E10 --> Q5
    E10 --> Q6
    E10 --> Q7
    E10 --> Q8
    E10 --> Q9
    E10 --> Q10
    E10 --> Q11
    E10 --> Q12
    Q1 --> Q13
    Q2 --> Q13
    Q3 --> Q13
    Q4 --> Q13
    Q5 --> Q13
    Q6 --> Q13
    Q7 --> Q13
    Q8 --> Q13
    Q9 --> Q13
    Q10 --> Q13
    Q11 --> Q13
    Q12 --> Q13
    Q13 -->|critical repair feedback| E1

    subgraph Media["Media generation"]
        M1[ImageAgentTeam]
        M2[Style bible anchors]
        M3[Character reference sheets]
        M4[ColorScriptAgent]
        M5[StoryboardAgent]
        M6[VisualIllustratorAgent: scene and beat prompts]
        M7[EncounterImageAgent: encounter prompts]
        M8{Provider supports LoRA training?}
        M9[LoraTrainingAgent]
        M10[ImageGenerationService]
        M11[Image QA and defect gate]
        M12{Video enabled?}
        M13[VideoDirectorAgent]
        M14[VideoGenerationService]
        M15{Narration enabled?}
        M16[NarrationService / ElevenLabs]
    end

    Q13 --> M1
    S1 --> M2
    S3 --> M3
    M1 --> M2
    M1 --> M3
    M1 --> M4
    M1 --> M5
    M5 --> M6
    M5 --> M7
    M3 --> M8
    M8 -- yes --> M9
    M8 -- no --> M10
    M9 --> M10
    M6 --> M10
    M7 --> M10
    M10 --> M11
    M11 -->|regenerate if needed| M10
    M11 --> M12
    M12 -- yes --> M13
    M13 --> M14
    M12 -- no --> M15
    M14 --> M15
    M15 -- yes --> M16

    subgraph Finalization["Final assembly, output, and deterministic QA"]
        O1[Convert generated artifacts to runtime Story model]
        O2[SavingPhase / pipelineOutputWriter]
        O3[Write generated-stories story directory]
        O4[story.json primary package]
        O4b[08-final-story.json legacy mirror]
        O5[Images, audio, video, manifest, prompts, reports]
        O6[Tier 1 asset HTTP validation]
        O7[storyPathAnalyzer coverage plan]
        O8[Tier 2 Playwright multi-path QA]
        O9{Fixable image or asset issue?}
        O10[qaRemediation: regenerate and patch story JSON]
        O11[Generation complete event]
    end

    M11 --> O1
    M14 --> O1
    M16 --> O1
    M15 -- no --> O1
    O1 --> O2
    O2 --> O3
    O3 --> O4
    O3 --> O4b
    O3 --> O5
    O4 --> O6
    O5 --> O6
    O6 --> O7
    O7 --> O8
    O8 --> O9
    O9 -- yes --> O10
    O10 --> O4
    O10 --> O4b
    O10 --> O8
    O9 -- no --> O11

    subgraph Playback["Runtime playback"]
        R1[StoryLibrary discovers generated story]
        R2[Home / EpisodeSelect screens]
        R3[ReadingScreen / StoryReader]
        R4[storyEngine]
        R5[conditionEvaluator]
        R6[resolutionEngine]
        R7[templateProcessor]
        R8[identityEngine]
        R9[gameStore and persisted PlayerState]
        R10[EpisodeRecapScreen / VisualizerScreen]
    end

    O11 --> R1
    R1 --> R2
    R2 --> R3
    R3 --> R4
    R4 --> R5
    R4 --> R6
    R4 --> R7
    R4 --> R8
    R5 --> R9
    R6 --> R9
    R8 --> R9
    R9 --> R3
    R9 --> R10

    subgraph CrossCutting["Cross-cutting controls"]
        X1[BaseAgent retries, JSON repair, circuit breaker]
        X2[Provider semaphores and concurrency limits]
        X3[Pipeline telemetry]
        X4[Phase checkpoints]
        X5[MemoryStore / optional Claude Memory]
        X6[Failure policy: fail_fast or recover]
    end

    X1 -.-> P1
    X1 -.-> S2
    X1 -.-> E1
    X1 -.-> Q1
    X2 -.-> S2
    X2 -.-> E4
    X2 -.-> M10
    X3 -.-> F
    X4 -.-> O2
    X5 -.-> F
    X6 -.-> F
```
