import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse, AgentMessage } from '../BaseAgent';

export interface ConsistencyScore {
  score: number; // 0 to 100
  feedback: string;
  isConsistent: boolean;
  issues: string[];
}

export interface ConsistencyRequest {
  targetImage: { data: string; mimeType: string };
  referenceImages: Array<{ data: string; mimeType: string; name: string }>;
  characterName: string;
  characterDescription: string;
}

export class ConsistencyScorerAgent extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Consistency Scorer', config);
  }

  async execute(input: ConsistencyRequest): Promise<AgentResponse<ConsistencyScore>> {
    const messages: AgentMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: this.buildPrompt(input) },
          { 
            type: 'image', 
            source: { 
              type: 'base64', 
              media_type: input.targetImage.mimeType, 
              data: input.targetImage.data 
            } 
          },
          ...input.referenceImages.map(ref => ({
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: ref.mimeType,
              data: ref.data
            }
          }))
        ]
      }
    ];

    try {
      const response = await this.callLLM(messages);
      const score = this.parseJSON<ConsistencyScore>(response);
      return { success: true, data: score, rawResponse: response };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Consistency Scorer

You are an expert at visual character analysis and continuity. Your job is to compare a newly generated image against established reference images and character descriptions to ensure visual consistency.

## Your Tasks
1. Analyze the character in the "target" image.
2. Compare them against the "reference" images provided.
3. Check for consistency in:
   - Facial features and structure
   - Hair color, style, and length
   - Distinguishing marks (scars, tattoos, etc.)
   - Clothing style and color palette (unless a change is narrative-appropriate)
   - General physique and posture
4. Provide a numerical score (0-100) and specific feedback on discrepancies.

## Output Format
Return a JSON object:
{
  "score": number,
  "feedback": "Detailed explanation of consistency or lack thereof",
  "isConsistent": boolean,
  "issues": ["List of specific visual discrepancies"]
}
`;
  }

  private buildPrompt(request: ConsistencyRequest): string {
    return `
Please evaluate the visual consistency of the character **${request.characterName}** in the first image provided (target) compared to the subsequent reference images and the description below.

**Character Description**: ${request.characterDescription}

The first image is the target to be scored. The other images are references.
`;
  }
}
