import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const maxDuration = 120;

const VISIO_MANUAL_PROMPT = `You are an expert business process consultant. You have been given the raw XML content extracted from a process diagram file (Microsoft Visio .vsdx or draw.io .drawio). This XML contains process flowchart data including shapes (process steps, decisions, documents, start/end points), connections (arrows), and swimlane information.

YOUR TASK: Analyze the Visio XML carefully and generate a process manual in JSON format.

=== HOW TO READ VISIO XML ===

1. **Shapes**: Look for <Shape> elements. Each shape has:
   - A "NameU" or "Name" attribute indicating the shape type (Process, Decision, Document, etc.)
   - <Text> elements containing the label/text of the shape
   - <Cell> elements with position data (PinX, PinY for coordinates)

2. **Connections**: Look for <Connect> elements or shapes with "Dynamic connector" type that link shapes together.

3. **Pages**: Each <Page> contains a separate diagram page.

4. **Masters**: Shape templates that define the type (flowchart shapes, connectors, etc.)

5. **Swimlanes/Containers**: Look for shapes that act as containers or functional bands — these represent departments/roles.

=== HOW TO READ DRAW.IO XML ===

If the content contains <mxGraphModel> or <mxCell> elements, it is a draw.io file:
1. **Shapes**: <mxCell> elements with vertex="1" are shapes. The "value" attribute is the label text.
2. **Connections**: <mxCell> elements with edge="1" are arrows/connectors. "source" and "target" attributes reference the connected shape IDs.
3. **Shape Types**: The "style" attribute indicates the type:
   - Contains "swimlane" → swimlane/department container
   - Contains "rhombus" → decision diamond
   - Contains "ellipse" → start/end shape
   - Contains "shape=document" or "shape=mxgraph.flowchart.document" → document shape
   - Contains "shape=mxgraph.flowchart.database" or "shape=cylinder" → database/system
   - Default rectangle → process step
4. **Hierarchy**: The "parent" attribute on each cell tells you which swimlane it belongs to. Cells whose parent is a swimlane cell belong to that department.
5. **Geometry**: <mxGeometry> inside a cell gives x, y, width, height for positioning and flow order.

=== GENERATE THIS EXACT JSON ===

{
  "processName": "The process title (from the page name or title shape)",
  "processLevel": "Subsidiary Level Process",
  "processObjectives": "2-3 sentences describing the objectives of this process",
  "processScope": "When does this process run? What triggers it? Who participates?",
  "stakeholders": ["Department/Role 1", "Department/Role 2", "..."],
  "authorityMatrixDefinition": {
    "R": "Responsible - The doer(s) who physically execute the task or produce the deliverable.",
    "A": "Accountable - The single owner who is ultimately accountable for the outcome and must approve/sign-off.",
    "C": "Consulted - Two-way communication with stakeholders whose input and feedback directly affects the outcome.",
    "I": "Informed - One-way communication to stakeholders who need to be kept in the loop but do not contribute directly."
  },
  "processSteps": [
    {
      "stepNumber": 1,
      "stepName": "Exact text from the Visio shape",
      "description": "Detailed description of what happens in this step",
      "responsible": "The department/role that performs this step",
      "accountable": "The senior role overseeing this step",
      "consulted": "Roles providing input, or '-'",
      "informed": "Roles notified, or '-'",
      "inputs": "Input document name, or '-'",
      "outputs": "Output document name, or '-'"
    }
  ]
}

=== RULES ===

1. Extract ALL process steps from the Visio shapes — do not skip any
2. Determine the flow order from connections/arrows
3. For swimlanes: identify container shapes or groups that represent departments
4. Use the EXACT text from each shape as the stepName
5. If you can identify which swimlane/container a shape belongs to (by position), use that as the "responsible" role
6. Decision shapes should be included as steps with descriptions like "If Yes → Step N. If No → Step M."
7. Document shapes should be captured as inputs/outputs of adjacent steps, not as separate process steps
8. Start/End shapes: include them as steps with appropriate descriptions
9. stakeholders array must contain ONLY the swimlane/department names found in the diagram
10. stepNumbers must be sequential with no gaps

=== IMPORTANT ===
- If the XML is unclear or you cannot determine certain information, make reasonable inferences based on the shape types and positions
- Always return valid JSON
- Do NOT include start/end shapes as process steps (they define boundaries, not activities)

Return ONLY valid JSON. No markdown, no code blocks, no explanation.`;

export async function POST(request: NextRequest) {
  try {
    const { visioContent, customInstructions, orgStructure } = await request.json();

    if (!visioContent) {
      return NextResponse.json({ error: 'No Visio content provided' }, { status: 400 });
    }

    let prompt = VISIO_MANUAL_PROMPT;

    if (customInstructions) {
      prompt += `\n\nADDITIONAL USER INSTRUCTIONS:\n${customInstructions}\n\nThese are additive — enrich descriptions and RACI assignments. Do NOT change the step names or structure extracted from the Visio.`;
    }

    if (orgStructure) {
      prompt += `\n\n=== ORGANIZATION STRUCTURE ===\n${orgStructure}\n\n=== RACI INSTRUCTIONS ===\nCross-reference the org structure above with the swimlane roles from the Visio file.\nUse ACTUAL role titles from the org structure for accountable, consulted, and informed fields.`;
    }

    // Truncate visio content if too long (keep first 100K chars which should be plenty)
    const truncatedContent = visioContent.length > 100000 
      ? visioContent.substring(0, 100000) + '\n\n[... content truncated for length ...]'
      : visioContent;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      system: 'You are a process manual generator. You read Visio XML data and produce structured process manuals in JSON format. Output ONLY valid JSON starting with { and ending with }.',
      messages: [
        {
          role: 'user',
          content: `${prompt}\n\n=== VISIO FILE CONTENT ===\n\n${truncatedContent}`,
        },
      ],
    });

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 });
    }

    const responseText = textContent.text;

    // Parse JSON from response
    let manualData;
    try {
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        manualData = JSON.parse(jsonMatch[1].trim());
      } else {
        const jsonStart = responseText.indexOf('{');
        const jsonEnd = responseText.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          manualData = JSON.parse(responseText.substring(jsonStart, jsonEnd + 1));
        } else {
          manualData = JSON.parse(responseText.trim());
        }
      }
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.error('Response was:', responseText.substring(0, 500));
      return NextResponse.json({
        error: 'Failed to parse manual data from Visio content. The file structure may be too complex.',
        details: responseText.substring(0, 500),
      }, { status: 500 });
    }

    console.log(`Generated manual from Visio with ${manualData.processSteps?.length || 0} steps`);

    return NextResponse.json({ manual: manualData });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Error generating manual from Visio:', errMsg);
    return NextResponse.json(
      { error: `Failed to generate manual: ${errMsg}` },
      { status: 500 }
    );
  }
}
