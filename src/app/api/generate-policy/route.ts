import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const { messages, swimlaneData, processName, orgStructure, customInstructions } = await request.json();

    // Build context from conversation, flowchart, and org structure
    let context = '';

    if (processName) {
      context += `PROCESS NAME: ${processName}\n\n`;
    }

    if (swimlaneData && swimlaneData.lanes) {
      context += `PROCESS FLOWCHART DATA:\n`;
      context += `Title: ${swimlaneData.title || 'Business Process'}\n`;
      context += `Swimlanes (roles/departments):\n`;
      for (const lane of swimlaneData.lanes) {
        const stepLabels = lane.steps?.map((s: any) => `${s.label} (${s.type})`).join(', ') || 'none';
        context += `  - ${lane.name}: ${stepLabels}\n`;
      }
      if (swimlaneData.connections) {
        context += `Flow connections:\n`;
        const stepMap: Record<string, string> = {};
        for (const lane of swimlaneData.lanes) {
          for (const step of lane.steps || []) {
            stepMap[step.id] = step.label;
          }
        }
        for (const conn of swimlaneData.connections) {
          const fromLabel = stepMap[conn.from] || conn.from;
          const toLabel = stepMap[conn.to] || conn.to;
          context += `  - "${fromLabel}" → "${toLabel}"${conn.label ? ` [${conn.label}]` : ''}\n`;
        }
      }
      context += '\n';
    }

    if (orgStructure) {
      const truncatedOrg = orgStructure.length > 15000 ? orgStructure.slice(0, 15000) + '\n...[truncated]' : orgStructure;
      context += `ORGANIZATION STRUCTURE:\n${truncatedOrg}\n\n`;
    }

    if (messages && messages.length > 0) {
      context += `CONVERSATION HISTORY:\n`;
      for (const msg of messages) {
        context += `${msg.role.toUpperCase()}: ${msg.content}\n\n`;
      }
    }

    if (customInstructions) {
      context += `ADDITIONAL INSTRUCTIONS:\n${customInstructions}\n\n`;
    }

    const systemPrompt = `You are an expert business process consultant who writes professional corporate policy documents.

Given a business process (from a flowchart and/or conversation), generate a comprehensive POLICY DOCUMENT.

A policy document is DIFFERENT from a process manual:
- A process manual has step-by-step procedures with RACI matrices
- A POLICY DOCUMENT has narrative sections with rules, guidelines, thresholds, approvals, and conditions

STRUCTURE YOUR OUTPUT AS JSON with this exact format:
{
  "policyName": "Name of the Policy (e.g., Procurement Policy)",
  "purpose": "A detailed paragraph explaining WHY this policy exists, what it ensures, and its importance to the organization.",
  "scope": "A detailed paragraph explaining WHAT this policy applies to, who it covers, and any boundaries.",
  "sections": [
    {
      "title": "Section Heading",
      "content": "Detailed narrative content for this section. Include specific rules, thresholds, approval requirements, conditions, and procedures. Use full sentences and paragraphs. Be specific with monetary amounts, timeframes, roles, and conditions where the process context allows."
    }
  ]
}

GUIDELINES:
- The "purpose" should be 2-4 sentences explaining the policy's goals and importance.
- The "scope" should define exactly what activities, departments, and scenarios the policy covers.
- Generate 8-15 policy sections that comprehensively cover all aspects of the process.
- Each section should have a clear, descriptive title and detailed content (2-8 sentences minimum per section).
- Include specific rules about approvals, thresholds, escalation paths, timelines, and quality checks where relevant.
- Reference specific roles/departments from the flowchart lanes and org structure.
- Write in professional corporate policy language — authoritative, clear, and precise.
- Do NOT include RACI matrices or step-by-step numbered procedures — this is a policy, not a manual.
- Make the content substantive and specific to the process, not generic boilerplate.

Return ONLY valid JSON. No markdown, no explanation, no code blocks.`;

    // Truncate context if excessively long
    const finalContext = context.length > 80000 ? context.slice(0, 80000) + '\n...[truncated]' : context;

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: 'user', content: finalContext }],
    });
    const response = await stream.finalMessage();

    const textBlock = response.content.find((c) => c.type === 'text');
    const text = textBlock?.type === 'text' ? textBlock.text : '';

    let policyData;
    try {
      const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        policyData = JSON.parse(codeBlockMatch[1].trim());
      } else {
        const jsonStart = text.indexOf('{');
        const jsonEnd = text.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          policyData = JSON.parse(text.substring(jsonStart, jsonEnd + 1));
        } else {
          policyData = JSON.parse(text.trim());
        }
      }
    } catch (parseError) {
      console.error('Policy JSON parse error:', parseError);
      console.error('Response was:', text.substring(0, 500));
      return NextResponse.json({ error: 'Failed to parse policy data' }, { status: 500 });
    }

    return NextResponse.json({ policy: policyData });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Policy generation error:', errMsg);
    return NextResponse.json(
      { error: `Failed to generate policy: ${errMsg}` },
      { status: 500 }
    );
  }
}
