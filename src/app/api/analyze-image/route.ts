import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const ANALYSIS_PROMPT = `You are an expert business process analyst with exceptional attention to detail. Your task is to CAREFULLY and ACCURATELY analyze this flowchart image.

CRITICAL INSTRUCTIONS:
1. READ EVERY SINGLE TEXT ELEMENT in the image - do not skip or summarize
2. EXTRACT THE EXACT WORDING from each shape, label, and text box
3. DO NOT MAKE UP or ASSUME any content - only report what you actually see
4. If the image shows an "Annual S&OP Process", report it as such - not as a generic process
5. Pay attention to the TITLE of the flowchart if visible

STEP-BY-STEP ANALYSIS:

1. **TITLE/HEADER**: Look at the top of the image. What is the exact title or header text? This is the process name.

2. **SWIMLANES/ROLES**: Look at the left side or top of the diagram. List EVERY department, role, or stakeholder name EXACTLY as written.

3. **PROCESS STEPS**: For EACH shape in the flowchart:
   - Read the EXACT text inside the shape (copy it word for word)
   - Note which swimlane/role it belongs to
   - Identify the shape type (rectangle=process, diamond=decision, oval/rounded=start/end, wavy bottom=document)
   - Note its horizontal position (column 0, 1, 2, etc.)

4. **CONNECTIONS**: Trace each arrow and note:
   - Which step it comes FROM
   - Which step it goes TO
   - Any label on the arrow (Yes, No, Approved, etc.)

Return your analysis in this exact JSON format:

\`\`\`json
{
  "processName": "EXACT title from the flowchart",
  "swimlaneData": {
    "title": "EXACT title from the flowchart",
    "lanes": [
      {
        "name": "EXACT stakeholder name as shown",
        "steps": [
          {"id": "A", "label": "EXACT text from the shape", "type": "start|end|process|decision|document", "x": 0}
        ]
      }
    ],
    "connections": [
      {"from": "A", "to": "B", "label": "Arrow label if any"}
    ]
  },
  "mermaidCode": "flowchart LR\\n    subgraph Lane1[\\"Lane Name\\"]\\n        A[Step] --> B[Step]\\n    end"
}
\`\`\`

REMEMBER:
- Copy text EXACTLY as it appears - spelling, capitalization, everything
- Include ALL steps, not just a summary
- If you see "Annual S&OP Planning" - write "Annual S&OP Planning", not "Business Process"
- If you see "Demand Planning Manager" - write "Demand Planning Manager", not "Manager"
- Be THOROUGH - every shape, every connection, every label`;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const imageFile = formData.get('image') as File;

    if (!imageFile) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    // Convert file to base64
    const bytes = await imageFile.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64Image = buffer.toString('base64');

    // Determine media type
    let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/png';
    if (imageFile.type === 'image/jpeg' || imageFile.type === 'image/jpg') {
      mediaType = 'image/jpeg';
    } else if (imageFile.type === 'image/gif') {
      mediaType = 'image/gif';
    } else if (imageFile.type === 'image/webp') {
      mediaType = 'image/webp';
    }

    // Call Claude with vision
    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-5',
      max_tokens: 16000,
      thinking: {
        type: 'enabled',
        budget_tokens: 8000,
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: ANALYSIS_PROMPT,
            },
          ],
        },
      ],
    });
    const response = await stream.finalMessage();

    // Extract the text response
    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 });
    }

    const responseText = textContent.text;

    // Parse JSON from response
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      console.error('No JSON found in response:', responseText);
      return NextResponse.json({ error: 'Could not parse flowchart analysis' }, { status: 500 });
    }

    try {
      const analysisData = JSON.parse(jsonMatch[1]);
      
      return NextResponse.json({
        processName: analysisData.processName,
        swimlaneData: analysisData.swimlaneData,
        mermaidCode: analysisData.mermaidCode,
      });
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return NextResponse.json({ error: 'Failed to parse analysis results' }, { status: 500 });
    }
  } catch (error) {
    console.error('Error analyzing image:', error);
    return NextResponse.json(
      { error: 'Failed to analyze image' },
      { status: 500 }
    );
  }
}
