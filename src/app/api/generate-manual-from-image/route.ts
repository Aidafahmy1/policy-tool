import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Single-step approach: Extract and generate in one call
const COMBINED_PROMPT = `READ THIS FLOWCHART IMAGE CAREFULLY. Study every shape, every swimlane label, every arrow, and every connection.

=== STEP 1: EXTRACT FROM THE IMAGE ===

1. PROCESS NAME: The title/header at the top of the flowchart. Use it EXACTLY.

2. SWIMLANE TITLES: The role/department labels on the left side (usually green headers).
   - These are the ONLY stakeholders — copy them EXACTLY as written
   - DO NOT add any other stakeholders

3. PROCESS STEPS: Every shape in the flowchart (rectangles, diamonds, documents, etc.)
   - Note which SWIMLANE each step sits in — this determines the Responsible role
   - Follow the numbered sequence if present

4. DOCUMENT SHAPES: Wavy-bottom rectangles or parallelograms
   - These are the ONLY inputs/outputs — do NOT infer documents from step wording

5. DECISION DIAMONDS: Yes/No decision points
   - Track which step each path (Yes/No) leads to

6. ARROWS/CONNECTIONS: Which steps connect to which, and across which swimlanes
   - Cross-lane arrows indicate collaboration between roles

=== STEP 2: GENERATE THIS EXACT JSON ===

{
  "processName": "EXACT title from flowchart",
  "processLevel": "Subsidiary Level Process",
  "processObjectives": "2-3 sentences specific to THIS process type (S&OP → demand-supply alignment, procurement → purchasing efficiency, etc.)",
  "processScope": "When does this process run? What triggers it? Who participates? What does it cover?",
  "stakeholders": ["Swimlane Title 1", "Swimlane Title 2", "..."],
  "authorityMatrixDefinition": {
    "R": "Responsible - The doer(s) who physically execute the task or produce the deliverable.",
    "A": "Accountable - The single owner who is ultimately accountable for the outcome and must approve/sign-off.",
    "C": "Consulted - Two-way communication with stakeholders whose input and feedback directly affects the outcome.",
    "I": "Informed - One-way communication to stakeholders who need to be kept in the loop but do not contribute directly."
  },
  "processSteps": [
    {
      "stepNumber": 1,
      "stepName": "Exact text from the shape",
      "description": "Detailed description of what happens. For decisions: 'If Yes, the process proceeds to Step [N]. If No, the process returns to Step [N].'",
      "responsible": "The swimlane title where this step physically sits",
      "accountable": "The most senior role overseeing this step",
      "consulted": "Roles providing input to this step, or '-'",
      "informed": "Roles notified about this step, or '-'",
      "inputs": "Document name from document shape, or '-'",
      "outputs": "Document name from document shape, or '-'"
    }
  ]
}

=== RACI ASSIGNMENT LOGIC (CRITICAL — THINK CAREFULLY) ===

For EACH step, determine RACI by analyzing the flowchart structure:

1. RESPONSIBLE (R) = The swimlane where the step physically sits. This is the role DOING the work.
   - A step in the "Finance" swimlane → responsible = "Finance"
   - A step in the "Group CEO" swimlane → responsible = "Group CEO"

2. ACCOUNTABLE (A) = The most senior role who oversees/approves this step's outcome:
   - If the step IS an approval/review/sign-off → the reviewer IS the Accountable
   - If the step is operational work → look for a senior/management swimlane (e.g., "Group CEO", "Subsidiary GM", "Director") who oversees this area
   - Each step must have exactly ONE Accountable role
   - Accountable CAN be the same as Responsible for senior-level steps

3. CONSULTED (C) = Roles that provide input BEFORE the step executes:
   - Look at arrows coming INTO this step from OTHER swimlanes — those roles are often Consulted
   - Subject matter experts whose domain knowledge is needed
   - If genuinely no one provides input → "-"

4. INFORMED (I) = Roles notified AFTER the step completes:
   - Look at arrows going OUT from this step to OTHER swimlanes — those roles may be Informed
   - Senior management roles that need visibility but don't actively participate
   - If genuinely no one needs notification → "-"

=== ABSOLUTE RULES ===

- processName = EXACT title from the flowchart
- stakeholders = ONLY swimlane titles as a simple string array
- responsible = ALWAYS the swimlane where the step sits (never blank)
- accountable = ALWAYS filled with a role name (never blank)
- consulted/informed = role name or "-" (never blank/empty)
- inputs/outputs = ONLY from explicit document shapes. No document shape → "-"
- Include ALL steps visible in the flowchart — do not skip any
- Decision descriptions MUST include exact step numbers for Yes/No paths

Return ONLY valid JSON. No markdown, no code blocks, no explanation.`;

export async function POST(request: NextRequest) {
  try {
    const { imageBase64, customInstructions, orgStructure, orgStructureImageBase64 } = await request.json();

    if (!imageBase64) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }
    
    // Process org structure - either from text or image
    let processedOrgStructure = orgStructure || '';
    
    // If org structure image is provided, extract text from it
    if (orgStructureImageBase64) {
      console.log('=== EXTRACTING ORG STRUCTURE FROM IMAGE ===');
      
      const orgBase64Data = orgStructureImageBase64.replace(/^data:image\/\w+;base64,/, '');
      let orgMediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/png';
      if (orgStructureImageBase64.startsWith('data:image/jpeg')) {
        orgMediaType = 'image/jpeg';
      }
      
      const orgStream = anthropic.messages.stream({
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
                  media_type: orgMediaType,
                  data: orgBase64Data,
                },
              },
              {
                type: 'text',
                text: `Extract the organization structure from this org chart image. List all roles/positions and departments you can see.

Format your response as a structured list:

DEPARTMENTS AND ROLES:
- [Department Name]: [Role/Position titles under this department]
- [Department Name]: [Role/Position titles]
...

HIERARCHY:
- [Top level role]
  - [Reports to top level]
    - [Reports to above]
...

Be thorough and extract ALL roles, positions, and department names visible in the chart.`
              },
            ],
          },
        ],
      });
      const orgExtractionResponse = await orgStream.finalMessage();

      const orgExtractedText = orgExtractionResponse.content.find((c) => c.type === 'text');
      processedOrgStructure = orgExtractedText?.type === 'text' ? orgExtractedText.text : '';
      
      console.log('=== EXTRACTED ORG STRUCTURE ===');
      console.log(processedOrgStructure);
      console.log('===============================');
    } else if (orgStructure) {
      console.log('=== ORG STRUCTURE (TEXT) PROVIDED ===');
      console.log(orgStructure);
      console.log('=====================================');
    }

    // Extract base64 data (remove data URL prefix if present)
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    
    // Determine media type from the data URL
    let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/png';
    if (imageBase64.startsWith('data:image/jpeg')) {
      mediaType = 'image/jpeg';
    } else if (imageBase64.startsWith('data:image/gif')) {
      mediaType = 'image/gif';
    } else if (imageBase64.startsWith('data:image/webp')) {
      mediaType = 'image/webp';
    }

    console.log('=== STEP 1: Extracting text from flowchart image ===');
    
    // STEP 1: First, extract all text from the image - focus on swimlane labels
    const extractionStream = anthropic.messages.stream({
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
                data: base64Data,
              },
            },
            {
              type: 'text',
              text: `Extract text from this flowchart. Answer in this EXACT format:

PROCESS_TITLE: [The main title at the top of the flowchart - this is the name of the process]

SWIMLANE_LABELS: [List each swimlane label on a new line - these are the green headers on the left side. Copy them EXACTLY as written. These are the ONLY stakeholders.]
- Label 1
- Label 2
- Label 3
(etc.)

PROCESS_STEPS: [List each step with its text]
1. [Step text]
2. [Step text]
(etc.)

IMPORTANT: The SWIMLANE_LABELS are the department/role names in the green boxes on the left side of the flowchart. Copy them EXACTLY - these will be the stakeholders.`
            },
          ],
        },
      ],
    });

    const extractionResponse = await extractionStream.finalMessage();

    const extractedText = extractionResponse.content.find((c) => c.type === 'text');
    const extractionResult = extractedText?.type === 'text' ? extractedText.text : '';
    
    console.log('=== EXTRACTED TEXT FROM IMAGE ===');
    console.log(extractionResult);
    console.log('=================================');
    
    // Parse out the swimlane labels from the extraction
    const swimlaneMatch = extractionResult.match(/SWIMLANE_LABELS:([^]*?)(?=PROCESS_STEPS:|$)/i);
    const swimlaneSection = swimlaneMatch ? swimlaneMatch[1] : '';
    const swimlaneLabels = swimlaneSection
      .split('\n')
      .map(line => line.replace(/^[-•*]\s*/, '').trim())
      .filter(line => line.length > 0 && !line.toLowerCase().includes('label'));
    
    console.log('=== PARSED SWIMLANE LABELS ===');
    console.log(swimlaneLabels);
    console.log('==============================');

    // STEP 2: Now generate the manual using the extracted text
    console.log('=== STEP 2: Generating manual from extracted data ===');
    
    let prompt = COMBINED_PROMPT;
    if (customInstructions) {
      prompt += `\n\nADDITIONAL USER INSTRUCTIONS:\n${customInstructions}`;
    }
    
    // Add the extracted text and explicitly list the swimlane labels
    prompt += `\n\n=== EXTRACTED FROM IMAGE ===\n${extractionResult}\n\n=== STAKEHOLDERS (USE EXACTLY THESE) ===\nThe stakeholders array in your JSON MUST be exactly these swimlane labels:\n${swimlaneLabels.map(l => `"${l}"`).join(', ')}\n\nDo NOT add any other stakeholders. Do NOT modify these names. Copy them exactly.`;
    
    // Add org structure for RACI cross-referencing
    if (processedOrgStructure) {
      prompt += `\n\n=== ORGANIZATION STRUCTURE ===\n${processedOrgStructure}\n\n=== RACI ASSIGNMENT INSTRUCTIONS ===
Cross-reference the organization structure above with the swimlane labels from the flowchart.
For each process step:
- "responsible" = The swimlane title where the step appears (this is the role doing the work)
- "accountable" = Find the senior/manager role from the org structure that oversees this area
- "consulted" = Other relevant roles from the org structure or swimlanes that should provide input
- "informed" = Roles that need to know about this step

Match swimlane titles to org structure roles. For example:
- If swimlane is "Finance" and org structure has "CFO: John Smith, Finance Manager: Jane Doe", use "Finance Manager" or "CFO" appropriately
- If swimlane is "Sales" and org structure has "Sales Director: Bob Wilson", use "Sales Director"

Use the ACTUAL role titles from the org structure in RACI assignments, not generic terms.`;
    }
    
    const manualStream = anthropic.messages.stream({
      model: 'claude-opus-4-5',
      max_tokens: 32000,
      thinking: {
        type: 'enabled',
        budget_tokens: 16000,
      },
      system: `You are creating a process manual based on a flowchart.

ABSOLUTE REQUIREMENTS - FOLLOW EXACTLY:
1. processName = The exact title from the flowchart (e.g., "Annual S&OP Process", "Order to Cash Process")
2. stakeholders = ONLY the swimlane labels provided - copy them EXACTLY, do not add or modify
3. processObjectives = Specific to THIS process type (not generic)
4. processScope = When/how THIS specific process runs
5. responsible = The swimlane label where each step appears
6. If org structure is provided, use the ACTUAL role titles from it for RACI assignments (accountable, consulted, informed)

The stakeholders array MUST match the swimlane labels EXACTLY. No additions, no modifications.
For RACI: Cross-reference org structure roles with swimlane departments to assign accurate titles.

Output ONLY valid JSON starting with { and ending with }. No markdown, no explanations.`,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    });
    const response = await manualStream.finalMessage();

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 });
    }

    const responseText = textContent.text;
    console.log('AI Response (first 1000 chars):', responseText.substring(0, 1000));

    // Parse JSON from response
    let manualData;
    try {
      // Try to extract JSON if wrapped in code blocks
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        manualData = JSON.parse(jsonMatch[1].trim());
      } else {
        // Try to find JSON object in the response
        const jsonStart = responseText.indexOf('{');
        const jsonEnd = responseText.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          const jsonStr = responseText.substring(jsonStart, jsonEnd + 1);
          manualData = JSON.parse(jsonStr);
        } else {
          // Try parsing the whole response as JSON
          manualData = JSON.parse(responseText.trim());
        }
      }
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.error('Response was:', responseText);
      
      // Return a more helpful error with the actual response
      return NextResponse.json({ 
        error: 'Failed to parse manual data. The AI may not have been able to read the image clearly. Please try uploading a higher resolution image.',
        details: responseText.substring(0, 500)
      }, { status: 500 });
    }

    // Log the number of steps for debugging
    console.log(`Generated manual with ${manualData.processSteps?.length || 0} steps`);

    return NextResponse.json({ manual: manualData });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : '';
    console.error('Error generating manual from image:', errMsg);
    console.error('Stack:', errStack);
    console.error('Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error as object), 2));
    return NextResponse.json(
      { error: `Failed to generate manual: ${errMsg}` },
      { status: 500 }
    );
  }
}
