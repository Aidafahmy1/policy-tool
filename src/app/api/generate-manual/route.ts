import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Increase timeout for AI API calls (Vercel default is 10s)
export const maxDuration = 120;

// ── Helper: extract steps from swimlane data ────────────────────────────
interface ExtractedStep {
  stepNumber: number;
  stepName: string;
  responsible: string;
  type: string;
  id: string;
  isDocument: boolean;
}

function extractStepsFromSwimlane(swimlaneData: any): {
  steps: ExtractedStep[];
  stakeholders: string[];
  processName: string;
  stepIdToNum: Record<string, number>;
  stepIdToLane: Record<string, string>;
  documentLabels: Set<string>;
} {
  const steps: ExtractedStep[] = [];
  const stakeholders: string[] = [];
  const stepIdToNum: Record<string, number> = {};
  const stepIdToLane: Record<string, string> = {};
  const documentLabels = new Set<string>();

  // Build lookup maps: stepId → step data, stepId → lane name
  const stepMap: Record<string, any> = {};
  const laneMap: Record<string, string> = {};
  for (const lane of swimlaneData.lanes) {
    stakeholders.push(lane.name);
    if (lane.steps) {
      for (const step of lane.steps) {
        stepMap[step.id] = step;
        laneMap[step.id] = lane.name;
      }
    }
  }

  // Build adjacency list from connections
  const adj: Record<string, string[]> = {};
  if (swimlaneData.connections) {
    for (const conn of swimlaneData.connections) {
      if (!adj[conn.from]) adj[conn.from] = [];
      adj[conn.from].push(conn.to);
    }
  }

  // Find start nodes
  const allStepsList = Object.values(stepMap) as any[];
  const startNodes = allStepsList.filter((s: any) => s.type === 'start').map((s: any) => s.id);

  // BFS traversal following the process flow for chronological ordering
  const visited = new Set<string>();
  const queue: string[] = [...startNodes];
  startNodes.forEach((id: string) => visited.add(id));
  let stepNum = 1;

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentStep = stepMap[currentId];
    if (currentStep && currentStep.type === 'document') {
      documentLabels.add(currentStep.label);
    } else if (currentStep) {
      stepIdToNum[currentId] = stepNum;
      stepIdToLane[currentId] = laneMap[currentId];
      steps.push({
        stepNumber: stepNum,
        stepName: currentStep.label,
        responsible: laneMap[currentId],
        type: currentStep.type,
        id: currentId,
        isDocument: false,
      });
      stepNum++;
    }
    // Sort neighbors by x position then lane index for consistent ordering
    const neighbors = (adj[currentId] || [])
      .filter((id: string) => !visited.has(id))
      .map((id: string) => {
        const s = stepMap[id];
        return { id, x: s?.x ?? 999 };
      })
      .sort((a: any, b: any) => a.x - b.x);
    for (const n of neighbors) {
      visited.add(n.id);
      queue.push(n.id);
    }
  }

  // Fallback: add any unreachable steps
  for (const step of allStepsList) {
    if (step.type === 'document' && !documentLabels.has(step.label)) {
      documentLabels.add(step.label);
    } else if (step.type !== 'document' && !stepIdToNum[step.id]) {
      stepIdToNum[step.id] = stepNum;
      stepIdToLane[step.id] = laneMap[step.id];
      steps.push({
        stepNumber: stepNum,
        stepName: step.label,
        responsible: laneMap[step.id],
        type: step.type,
        id: step.id,
        isDocument: false,
      });
      stepNum++;
    }
  }

  return {
    steps,
    stakeholders,
    processName: swimlaneData.title || 'Business Process',
    stepIdToNum,
    stepIdToLane,
    documentLabels,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { messages, mermaidCode, orgStructure, swimlaneData, processName } = await request.json();

    // ── PATH A: We have structured swimlane data ──────────────────────
    if (swimlaneData && swimlaneData.lanes) {
      const extracted = extractStepsFromSwimlane(swimlaneData);
      const exactProcessName = processName || extracted.processName;

      // Build a numbered step list for the AI (context only)
      let stepList = '';
      for (const s of extracted.steps) {
        stepList += `${s.stepNumber}. "${s.stepName}" | Swimlane: "${s.responsible}" | Type: ${s.type}`;
        if (s.type === 'decision') stepList += ' (Yes/No diamond)';
        if (s.isDocument) stepList += ' (DOCUMENT shape — this counts as an input/output)';
        stepList += '\n';
      }

      // Build connection list
      let connList = '';
      if (swimlaneData.connections) {
        for (const conn of swimlaneData.connections) {
          const fromNum = extracted.stepIdToNum[conn.from];
          const toNum = extracted.stepIdToNum[conn.to];
          const fromLane = extracted.stepIdToLane[conn.from] || '?';
          const toLane = extracted.stepIdToLane[conn.to] || '?';
          if (fromNum && toNum) {
            connList += `- Step ${fromNum} (${fromLane}) → Step ${toNum} (${toLane})${conn.label ? ` [${conn.label}]` : ''}\n`;
          }
        }
      }

      // Build the pre-filled JSON skeleton — stepNumber, stepName, responsible are LOCKED
      const skeleton = extracted.steps.map(s => ({
        stepNumber: s.stepNumber,
        stepName: s.stepName,
        description: `__FILL__`,
        responsible: s.responsible,
        accountable: `__FILL__`,
        consulted: `__FILL__`,
        informed: `__FILL__`,
        inputs: s.isDocument ? s.stepName : '-',
        outputs: '-',
      }));

      // Build a lookup for document shapes by their ID
      const docMap: Record<string, string> = {}; // docId → label
      for (const lane of swimlaneData.lanes) {
        if (lane.steps) {
          for (const step of lane.steps) {
            if (step.type === 'document') {
              docMap[step.id] = step.label;
            }
          }
        }
      }

      // For document shapes, figure out which steps feed into/out of them
      if (swimlaneData.connections) {
        for (const conn of swimlaneData.connections) {
          const fromIsDoc = !!docMap[conn.from];
          const toIsDoc = !!docMap[conn.to];
          const fromProcessStep = extracted.steps.find(s => s.id === conn.from);
          const toProcessStep = extracted.steps.find(s => s.id === conn.to);

          if (!fromIsDoc && !toIsDoc) continue; // neither end is a document

          // Arrow: Process → Document  (the process step OUTPUTS this document)
          if (fromProcessStep && toIsDoc) {
            const docName = docMap[conn.to];
            const entry = skeleton.find(e => e.stepNumber === fromProcessStep.stepNumber);
            if (entry) {
              if (entry.outputs === '-') {
                entry.outputs = docName;
              } else if (!entry.outputs.includes(docName)) {
                entry.outputs += ', ' + docName;
              }
            }
          }

          // Arrow: Document → Process  (the process step receives this document as INPUT)
          if (fromIsDoc && toProcessStep) {
            const docName = docMap[conn.from];
            const entry = skeleton.find(e => e.stepNumber === toProcessStep.stepNumber);
            if (entry) {
              if (entry.inputs === '-') {
                entry.inputs = docName;
              } else if (!entry.inputs.includes(docName)) {
                entry.inputs += ', ' + docName;
              }
            }
          }
        }
      }

      // Build org structure context
      let orgContext = '';
      if (orgStructure) {
        orgContext = `\n===== ORGANIZATION STRUCTURE =====\n${orgStructure}\n\n`;
        orgContext += `Use ACTUAL role titles from the org structure for RACI assignments (accountable, consulted, informed).\n`;
        orgContext += `Map swimlane roles to the most relevant org structure roles.\n`;
        orgContext += `Use role titles (e.g., "CFO"), not people's names.\n\n`;
      }

      const systemPrompt = `You are an expert business process consultant. You will receive a pre-built JSON skeleton for a process manual. The stepNumber, stepName, responsible, inputs, and outputs fields are ALREADY CORRECT and LOCKED — do NOT change them.

Your ONLY job is to fill in the fields marked "__FILL__":
- "description": A detailed 1-3 sentence description of what happens in this step. For "start" type steps, describe what triggers or initiates the process. For "end" type steps, describe the final outcome or completion state. For decision steps, you MUST state: "If Yes, the process proceeds to Step [N]. If No, the process returns/goes to Step [N]." with the correct step numbers from the connections list.
- "accountable": The most senior role who oversees/approves this step. Use one of the stakeholder names or an org structure role.
- "consulted": Roles who provide input before this step, or "-" if none.
- "informed": Roles notified after this step, or "-" if none.

You must ALSO fill in:
- "processObjectives": 2-3 sentences specific to THIS process type.
- "processScope": When this process runs, what triggers it, who participates.

RULES:
- Do NOT change stepNumber, stepName, responsible, inputs, or outputs — they are pre-filled and correct.
- Do NOT add, remove, skip, or reorder any steps.
- The processSteps array must have EXACTLY ${extracted.steps.length} entries.
- Never leave any field empty or null — use "-" if not applicable.
- ONLY use document names that appear in the flowchart for inputs/outputs.

Return ONLY valid JSON. No markdown, no explanation, no code blocks.`;

      const userMessage = `Process: "${exactProcessName}"
Stakeholders: ${JSON.stringify(extracted.stakeholders)}

STEPS IN THE FLOWCHART:
${stepList}
FLOW CONNECTIONS:
${connList}
${orgContext}
HERE IS THE PRE-FILLED JSON SKELETON. Fill in ONLY the "__FILL__" fields. Do NOT change anything else:

${JSON.stringify({
  processName: exactProcessName,
  processLevel: "Subsidiary Level Process",
  processObjectives: "__FILL__",
  processScope: "__FILL__",
  stakeholders: extracted.stakeholders,
  authorityMatrixDefinition: {
    R: "Responsible - The doer(s) who physically execute the task or produce the deliverable.",
    A: "Accountable - The single owner who is ultimately accountable for the outcome and must approve/sign-off.",
    C: "Consulted - Two-way communication with stakeholders whose input and feedback directly affects the outcome.",
    I: "Informed - One-way communication to stakeholders who need to be kept in the loop but do not contribute directly."
  },
  processSteps: skeleton,
}, null, 2)}`;

      // Helper: stream AI, collect text, parse, and return SSE to keep Vercel alive
      const encoder = new TextEncoder();
      const skeletonCopy = skeleton;
      const stepsForOverwrite = extracted.steps;

      const readableStream = new ReadableStream({
        async start(controller) {
          try {
            const aiStream = anthropic.messages.stream({
              model: 'claude-opus-4-5',
              max_tokens: 16000,
              thinking: { type: 'enabled', budget_tokens: 5000 },
              system: systemPrompt,
              messages: [{ role: 'user', content: userMessage }],
            });

            let text = '';
            for await (const event of aiStream) {
              if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                text += event.delta.text;
              }
              // Send keep-alive ping to client
              controller.enqueue(encoder.encode(`data: {"ping":true}\n\n`));
            }

            // Parse JSON from response
            let manualData;
            const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (codeBlockMatch) {
              manualData = JSON.parse(codeBlockMatch[1].trim());
            } else {
              const jsonStart = text.indexOf('{');
              const jsonEnd = text.lastIndexOf('}');
              if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                manualData = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
              } else {
                manualData = JSON.parse(text.trim());
              }
            }

            // FORCE-OVERWRITE: Guarantee step names, numbers, responsible, inputs/outputs match flowchart
            manualData.processName = exactProcessName;
            manualData.stakeholders = extracted.stakeholders;
            const aiSteps = manualData.processSteps || [];
            manualData.processSteps = stepsForOverwrite.map((expected, i) => {
              const aiStep = aiSteps.find((s: any) => s.stepNumber === expected.stepNumber) || aiSteps[i] || {};
              return {
                stepNumber: expected.stepNumber,
                stepName: expected.stepName,
                description: aiStep.description || `Step ${expected.stepNumber}: ${expected.stepName}`,
                responsible: expected.responsible,
                accountable: aiStep.accountable || expected.responsible,
                consulted: aiStep.consulted || '-',
                informed: aiStep.informed || '-',
                inputs: skeletonCopy[i]?.inputs || '-',
                outputs: skeletonCopy[i]?.outputs || '-',
              };
            });

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, manual: manualData })}\n\n`));
            controller.close();
          } catch (err) {
            console.error('Manual stream error:', err);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Generation failed' })}\n\n`));
            controller.close();
          }
        },
      });

      return new Response(readableStream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
      });
    }

    // ── PATH B: Fallback for mermaid-only (no swimlane data) ──────────
    let contextMessage = `Generate a process manual for the process described below.\n\n`;
    if (mermaidCode) {
      contextMessage += `PROCESS DIAGRAM (Mermaid code):\n\`\`\`\n${mermaidCode}\n\`\`\`\n\n`;
    }
    if (orgStructure) {
      contextMessage += `ORGANIZATION STRUCTURE:\n${orgStructure}\n\n`;
    }
    if (messages && messages.length > 0) {
      contextMessage += `CONVERSATION HISTORY:\n`;
      for (const msg of messages) {
        contextMessage += `${msg.role.toUpperCase()}: ${msg.content}\n\n`;
      }
    }

    const fallbackPrompt = `You are an expert business process consultant generating a process manual as JSON. Output ONLY valid JSON with this structure: { "processName", "processLevel", "processObjectives", "processScope", "stakeholders": [...], "authorityMatrixDefinition": {...}, "processSteps": [{ "stepNumber", "stepName", "description", "responsible", "accountable", "consulted", "informed", "inputs", "outputs" }] }. Return ONLY valid JSON. No markdown, no explanation.`;

    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          const aiStream = anthropic.messages.stream({
            model: 'claude-opus-4-5',
            max_tokens: 16000,
            thinking: { type: 'enabled', budget_tokens: 5000 },
            system: fallbackPrompt,
            messages: [{ role: 'user', content: contextMessage }],
          });

          let text = '';
          for await (const event of aiStream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              text += event.delta.text;
            }
            controller.enqueue(encoder.encode(`data: {"ping":true}\n\n`));
          }

          let manualData;
          const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (codeBlockMatch) {
            manualData = JSON.parse(codeBlockMatch[1].trim());
          } else {
            const jsonStart = text.indexOf('{');
            const jsonEnd = text.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
              manualData = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
            } else {
              manualData = JSON.parse(text.trim());
            }
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, manual: manualData })}\n\n`));
          controller.close();
        } catch (err) {
          console.error('Manual stream error:', err);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Generation failed' })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Manual generation error:', errMsg);
    return NextResponse.json(
      { error: `Failed to generate manual: ${errMsg}` },
      { status: 500 }
    );
  }
}
