import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEM_PROMPT = `You are an expert business process consultant and Visio diagram specialist. Your role is to help users create professional process flowcharts and documentation.

When a user describes a business process (like Procure-to-Pay, Order-to-Cash, S&OP, etc.), you should:

1. Ask clarifying questions if needed to understand the process fully
2. Generate BOTH a Mermaid diagram AND a JSON swimlane structure
3. Use subgraphs for different departments/roles (swimlanes)
4. Include decision points, process steps, and clear flow arrows

CRITICAL: You must generate TWO code blocks:
1. A \`\`\`mermaid block with the flowchart
2. A \`\`\`swimlane-json block with structured data for proper Visio-style rendering

Shape types:
- start: Rounded pill shape for process start
- end: Rounded pill shape for process end  
- process: Rectangle for process steps
- decision: Diamond for Yes/No decisions
- document: Document shape for inputs/outputs

Example output format:

\`\`\`mermaid
flowchart LR
    subgraph Requestor["Requestor"]
        A((Start)) --> B[Create Request]
    end
    subgraph Manager["Manager"]
        B --> C{Approve?}
        C -->|Yes| D[Process Request]
        C -->|No| E[Return to Requestor]
    end
    subgraph Finance["Finance"]
        D --> F[Complete Payment]
        F --> G((End))
    end
\`\`\`

\`\`\`swimlane-json
{
  "title": "Request Process",
  "lanes": [
    {
      "name": "Requestor",
      "steps": [
        {"id": "A", "label": "Start", "type": "start", "x": 0},
        {"id": "B", "label": "Create Request", "type": "process", "x": 1}
      ]
    },
    {
      "name": "Manager", 
      "steps": [
        {"id": "C", "label": "Approve?", "type": "decision", "x": 2},
        {"id": "D", "label": "Process Request", "type": "process", "x": 3},
        {"id": "E", "label": "Return to Requestor", "type": "process", "x": 3}
      ]
    },
    {
      "name": "Finance",
      "steps": [
        {"id": "F", "label": "Complete Payment", "type": "process", "x": 4},
        {"id": "G", "label": "End", "type": "end", "x": 5}
      ]
    }
  ],
  "connections": [
    {"from": "A", "to": "B"},
    {"from": "B", "to": "C"},
    {"from": "C", "to": "D", "label": "Yes"},
    {"from": "C", "to": "E", "label": "No"},
    {"from": "D", "to": "F"},
    {"from": "F", "to": "G"},
    {"from": "E", "to": "B"}
  ]
}
\`\`\`

Key rules:
- ALWAYS include both mermaid AND swimlane-json blocks
- The "x" value in steps indicates horizontal position (column) for proper layout
- Steps in the same lane at different x positions will be placed correctly
- Connections show the flow between steps, including cross-lane connections
- Use descriptive labels for all steps
- Include 8-15 steps typically for comprehensive processes
- Include decision points where approvals or choices occur

DECISION POINT RULES (CRITICAL):
- Every decision (diamond) MUST have exactly TWO outgoing connections: one labeled "Yes" and one labeled "No"
- The "Yes" path should go to the NEXT step (typically same lane or forward in the flow)
- The "No" path should go to an ALTERNATIVE step (e.g., return to a previous step, go to a rejection step, or a different lane)
- The "Yes" target should be at a DIFFERENT x position or lane than the "No" target so arrows don't overlap
- Example: If decision is at x:3, "Yes" target could be at x:4 in the same lane, "No" target at x:4 in a different lane or looping back to x:1
- NEVER leave decision connections without "Yes"/"No" labels

If the user uploads context documents (ERP data, org structure), incorporate that information into the process design.

ORGANIZATION STRUCTURE HANDLING:
When the user uploads an org structure document (org chart, hierarchy, employee list, department list, RACI reference, etc.):
1. Acknowledge that you received and understood the org structure
2. Parse ALL roles, titles, departments, and reporting lines from the document
3. When generating flowcharts, use the ACTUAL department/role names from the org structure as swimlane names (e.g., if org has "Supply Chain Planning Department" use that instead of generic "Planning")
4. Remember the org structure for the entire conversation — it applies to all future flowcharts and modifications
5. When the user later asks for a manual or RACI, the org structure roles should be used for accurate RACI assignments
6. If the org structure contains specific people's names, note them but use role/title names for swimlanes (e.g., "CFO" not "John Smith")

Be conversational and helpful. Guide the user through building their process step by step.`;

export async function POST(request: NextRequest) {
  try {
    const { messages, attachments, uploadedImageBase64, currentSwimlaneData } = await request.json();

    // Build context from attachments if any
    let contextMessage = '';
    if (attachments && attachments.length > 0) {
      contextMessage = '\n\nContext from uploaded documents:\n';
      for (const att of attachments) {
        contextMessage += `\n--- ${att.file_name} ---\n${att.file_content}\n`;
      }
    }

    // Add context to the last user message if there are attachments
    const processedMessages = messages.map((msg: { role: string; content: string }, index: number) => {
      if (index === messages.length - 1 && msg.role === 'user' && contextMessage) {
        return { ...msg, content: msg.content + contextMessage };
      }
      return msg;
    });

    // If there's an uploaded image, include it in the conversation
    let apiMessages: Anthropic.MessageParam[] = processedMessages;
    
    if (uploadedImageBase64) {
      // Extract base64 data and media type
      const base64Data = uploadedImageBase64.replace(/^data:image\/\w+;base64,/, '');
      let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/png';
      if (uploadedImageBase64.startsWith('data:image/jpeg')) {
        mediaType = 'image/jpeg';
      } else if (uploadedImageBase64.startsWith('data:image/gif')) {
        mediaType = 'image/gif';
      } else if (uploadedImageBase64.startsWith('data:image/webp')) {
        mediaType = 'image/webp';
      }

      // Convert the last user message to include the image
      apiMessages = processedMessages.map((msg: { role: string; content: string }, index: number) => {
        if (index === processedMessages.length - 1 && msg.role === 'user') {
          return {
            role: 'user' as const,
            content: [
              {
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: mediaType,
                  data: base64Data,
                },
              },
              {
                type: 'text' as const,
                text: `[The user has uploaded a flowchart image. Please analyze it and answer their question.]\n\n${msg.content}`,
              },
            ],
          };
        }
        return msg;
      });
    }

    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-5',
      max_tokens: 16000,
      thinking: {
        type: 'enabled',
        budget_tokens: 8000,
      },
      system: SYSTEM_PROMPT
        + (currentSwimlaneData ? `\n\nIMPORTANT — EXISTING FLOWCHART:\nThe user already has a flowchart generated in this conversation. Here is the current swimlane JSON structure:\n\n\`\`\`json\n${JSON.stringify(currentSwimlaneData, null, 2)}\n\`\`\`\n\nWhen the user asks to modify, update, add, remove, or change steps/connections/labels in the flowchart, you MUST output an updated \`\`\`swimlane-json\`\`\` block (and a matching \`\`\`mermaid\`\`\` block) that incorporates their requested changes while preserving everything else. Keep the same step IDs for unchanged steps so the layout stays consistent. Only regenerate from scratch if the user explicitly asks for a completely new flowchart.` : '')
        + (uploadedImageBase64 ? `\n\nIMPORTANT — UPLOADED FLOWCHART IMAGE:
The user has uploaded a flowchart/process diagram image. You MUST:
1. Carefully analyze the image to identify all process steps, decision points, roles/departments (swimlanes), and connections.
2. Describe what you see in the flowchart so the user knows you understood it.
3. When the user asks for suggestions or improvements, provide concrete, actionable recommendations (e.g., missing steps, unclear decision paths, missing roles, compliance gaps, efficiency improvements).
4. If the user asks you to recreate or convert the flowchart, generate BOTH a \`\`\`mermaid\`\`\` block AND a \`\`\`swimlane-json\`\`\` block that faithfully reproduces the uploaded diagram as an editable flowchart. Preserve the original structure but you may improve layout and clarity.
5. The image is available for ALL messages in this conversation, so you can reference it in follow-up questions.
6. You can proactively offer to recreate the flowchart as an editable diagram if the user hasn't asked yet.` : ''),
      messages: apiMessages,
    });
    const response = await stream.finalMessage();

    const textBlock = response.content.find((c) => c.type === 'text');
    const text = textBlock?.type === 'text' ? textBlock.text : '';

    // Extract Mermaid code if present
    const mermaidMatch = text.match(/```mermaid\n([\s\S]*?)```/);
    const mermaidCode = mermaidMatch ? mermaidMatch[1].trim() : null;

    // Extract swimlane JSON if present
    const swimlaneMatch = text.match(/```swimlane-json\n([\s\S]*?)```/);
    let swimlaneData = null;
    if (swimlaneMatch) {
      try {
        swimlaneData = JSON.parse(swimlaneMatch[1].trim());
      } catch (e) {
        console.error('Failed to parse swimlane JSON:', e);
      }
    }

    return NextResponse.json({
      message: text,
      mermaidCode,
      swimlaneData,
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: 'Failed to process chat message' },
      { status: 500 }
    );
  }
}
