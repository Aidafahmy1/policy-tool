import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const MANUAL_GENERATION_PROMPT = `You are an expert business process consultant generating a professional process manual.

THINK DEEPLY about the process before generating output. Analyze the flowchart structure, understand the roles, and make intelligent RACI assignments.

OUTPUT THIS EXACT JSON STRUCTURE:

{
  "processName": "EXACT process name as provided",
  "processLevel": "Subsidiary Level Process",
  "processObjectives": "2-3 sentences describing the specific objectives of THIS process. Be specific — if S&OP, write about demand-supply alignment; if procurement, write about purchasing efficiency.",
  "processScope": "Describe when this process runs (annual/quarterly/monthly), what triggers it, who participates, and what it covers.",
  "stakeholders": ["Role1", "Role2", "Role3"],
  "authorityMatrixDefinition": {
    "R": "Responsible - The doer(s) who physically execute the task or produce the deliverable.",
    "A": "Accountable - The single owner who is ultimately accountable for the outcome and must approve/sign-off.",
    "C": "Consulted - Two-way communication with stakeholders whose input and feedback directly affects the outcome.",
    "I": "Informed - One-way communication to stakeholders who need to be kept in the loop but do not contribute directly."
  },
  "processSteps": [
    {
      "stepNumber": 1,
      "stepName": "Exact step name",
      "description": "Detailed description of what happens in this step.",
      "responsible": "Role that performs this step (the swimlane it sits in)",
      "accountable": "Senior role who approves/owns this step's outcome",
      "consulted": "Roles whose input is needed, or '-' if none",
      "informed": "Roles who need to know about this step, or '-' if none",
      "inputs": "-",
      "outputs": "-"
    }
  ]
}

=== RACI ASSIGNMENT LOGIC ===

For EACH step, determine RACI by analyzing the flowchart structure:

1. RESPONSIBLE (R) = The swimlane/role where the step physically sits in the flowchart. This is the person DOING the work.

2. ACCOUNTABLE (A) = The most senior role who oversees the area of this step. Logic:
   - If the step is an approval/review/sign-off → the reviewer IS the Accountable
   - If the step is operational work → the manager/director above the Responsible role is Accountable
   - If a "Group CEO" or "GM" swimlane exists → they are often Accountable for key decision/approval steps
   - Each step must have exactly ONE Accountable role
   - The Accountable CAN be the same as Responsible for senior-level steps

3. CONSULTED (C) = Roles that provide input BEFORE the step is executed. Logic:
   - Look at incoming arrows from other swimlanes — those roles may be Consulted
   - Subject matter experts whose domain knowledge affects the step
   - If no other role provides input → use "-"

4. INFORMED (I) = Roles that are notified AFTER the step is completed. Logic:
   - Look at outgoing arrows to other swimlanes — those roles may be Informed
   - Management roles that need visibility but don't participate
   - If no one needs notification → use "-"

=== CRITICAL RULES ===

- stakeholders MUST be a simple array of strings — ONLY the swimlane titles/role names
- Use the EXACT process name, stakeholder names, and step names provided
- Include ALL process steps — do not skip any
- Never leave any RACI field empty — always a role name or "-"
- Inputs/Outputs: ONLY from explicit document shapes in the diagram. If no document shape → "-"
- Decision points: description MUST state "If Yes, the process proceeds to Step [N]. If No, the process returns to Step [N]." with exact step numbers
- processObjectives and processScope must be SPECIFIC to the process type (S&OP, procurement, HR, etc.)

Return ONLY valid JSON. No markdown, no explanation, no code blocks.`;

export async function POST(request: NextRequest) {
  try {
    const { messages, mermaidCode, orgStructure, swimlaneData, processName } = await request.json();

    // Build context for manual generation
    let contextMessage = `Generate a process manual for the EXACT process described below.\n\n`;
    
    // If we have swimlane data, use that as primary source
    if (swimlaneData && swimlaneData.lanes) {
      const exactProcessName = processName || swimlaneData.title || 'Business Process';
      contextMessage += `===== PROCESS INFORMATION =====\n\n`;
      contextMessage += `PROCESS NAME: "${exactProcessName}"\n\n`;
      
      // List stakeholders
      contextMessage += `STAKEHOLDERS (swimlane roles — use these EXACTLY):\n`;
      for (const lane of swimlaneData.lanes) {
        contextMessage += `- "${lane.name}"\n`;
      }
      
      // List steps WITH their swimlane (= Responsible role)
      contextMessage += `\nPROCESS STEPS:\n`;
      contextMessage += `(Format: Step# | Step Name | Swimlane/Role = Responsible | Shape Type)\n`;
      let stepNum = 1;
      const stepIdToNum: Record<string, number> = {};
      const stepIdToLane: Record<string, string> = {};
      for (const lane of swimlaneData.lanes) {
        if (lane.steps && lane.steps.length > 0) {
          for (const step of lane.steps) {
            if (step.type !== 'start' && step.type !== 'end') {
              stepIdToNum[step.id] = stepNum;
              stepIdToLane[step.id] = lane.name;
              contextMessage += `${stepNum}. "${step.label}" | Swimlane: "${lane.name}" | Type: ${step.type}${step.type === 'decision' ? ' (Yes/No)' : ''}${step.type === 'document' ? ' (this IS a document shape)' : ''}\n`;
              stepNum++;
            }
          }
        }
      }
      
      // Show connections with step numbers and labels
      contextMessage += `\nFLOW CONNECTIONS (arrows between steps):\n`;
      if (swimlaneData.connections) {
        for (const conn of swimlaneData.connections) {
          const fromNum = stepIdToNum[conn.from];
          const toNum = stepIdToNum[conn.to];
          const fromLane = stepIdToLane[conn.from] || '?';
          const toLane = stepIdToLane[conn.to] || '?';
          if (fromNum && toNum) {
            contextMessage += `- Step ${fromNum} (${fromLane}) → Step ${toNum} (${toLane})${conn.label ? ` [${conn.label}]` : ''}\n`;
          }
        }
      }
      
      contextMessage += `\n===== RACI GUIDANCE =====\n`;
      contextMessage += `For each step above:\n`;
      contextMessage += `- "responsible" = the Swimlane role listed next to it (the role doing the work)\n`;
      contextMessage += `- "accountable" = the most senior role from the stakeholders list who oversees that area\n`;
      contextMessage += `- "consulted" = other roles whose swimlanes have arrows connecting to/from this step\n`;
      contextMessage += `- "informed" = remaining roles that should know about this step's outcome\n\n`;
      contextMessage += `REMINDER: The manual MUST be about "${exactProcessName}" specifically.\n\n`;
    } else if (mermaidCode) {
      contextMessage += `PROCESS DIAGRAM (Mermaid code):\n\`\`\`\n${mermaidCode}\n\`\`\`\n\n`;
    }

    if (orgStructure) {
      contextMessage += `ORGANIZATION STRUCTURE:\n${orgStructure}\n\nUse this org structure to assign specific people to roles in the process.\n\n`;
    }

    if (messages && messages.length > 0) {
      contextMessage += `CONVERSATION HISTORY:\n`;
      for (const msg of messages) {
        contextMessage += `${msg.role.toUpperCase()}: ${msg.content}\n\n`;
      }
    }

    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-5',
      max_tokens: 32000,
      thinking: {
        type: 'enabled',
        budget_tokens: 16000,
      },
      system: MANUAL_GENERATION_PROMPT,
      messages: [
        {
          role: 'user',
          content: contextMessage,
        },
      ],
    });
    const response = await stream.finalMessage();

    const textBlock = response.content.find((c) => c.type === 'text');
    const text = textBlock?.type === 'text' ? textBlock.text : '';

    // Parse JSON from response
    let manualData;
    try {
      // Try to extract JSON if wrapped in code blocks
      const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        manualData = JSON.parse(codeBlockMatch[1].trim());
      } else {
        // Try to find JSON object in the response
        const jsonStart = text.indexOf('{');
        const jsonEnd = text.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          manualData = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
        } else {
          manualData = JSON.parse(text.trim());
        }
      }
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.error('Response was:', text.substring(0, 500));
      return NextResponse.json(
        { error: 'Failed to parse manual data' },
        { status: 500 }
      );
    }

    return NextResponse.json({ manual: manualData });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Manual generation error:', errMsg);
    console.error('Full error:', error);
    return NextResponse.json(
      { error: `Failed to generate manual: ${errMsg}` },
      { status: 500 }
    );
  }
}
