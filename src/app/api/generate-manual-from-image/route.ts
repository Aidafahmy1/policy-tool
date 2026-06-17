import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const maxDuration = 120;

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
      const orgBase64Data = orgStructureImageBase64.replace(/^data:image\/\w+;base64,/, '');
      let orgMediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/png';
      if (orgStructureImageBase64.startsWith('data:image/jpeg')) {
        orgMediaType = 'image/jpeg';
      }
      
      const orgStream = anthropic.messages.stream({
        model: 'claude-opus-4-5',
        max_tokens: 8000,
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
                text: `Extract the organization structure from this org chart image. List all roles/positions and their hierarchy. Be thorough.`
              },
            ],
          },
        ],
      });
      const orgExtractionResponse = await orgStream.finalMessage();
      const orgExtractedText = orgExtractionResponse.content.find((c) => c.type === 'text');
      processedOrgStructure = orgExtractedText?.type === 'text' ? orgExtractedText.text : '';
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

    // Single-step: generate manual directly from image
    let userPrompt = `Look at this flowchart image very carefully. Read EVERY shape, EVERY label, EVERY swimlane header, and EVERY arrow.

Generate a process manual as JSON with this EXACT structure:
{
  "processName": "exact title from flowchart",
  "processLevel": "Subsidiary Level Process",
  "processObjectives": "2-3 sentences about this process",
  "processScope": "when/how this process runs",
  "stakeholders": ["exact swimlane label 1", "exact swimlane label 2"],
  "authorityMatrixDefinition": {"R": "Responsible", "A": "Accountable", "C": "Consulted", "I": "Informed"},
  "processSteps": [
    {
      "stepNumber": 1,
      "stepName": "EXACT text from the shape in the flowchart",
      "description": "what happens in this step",
      "responsible": "the swimlane where this step sits",
      "accountable": "senior role overseeing this",
      "consulted": "roles providing input, or -",
      "informed": "roles notified, or -",
      "inputs": "document name or -",
      "outputs": "document name or -"
    }
  ]
}

CRITICAL RULES:
1. processName = Copy the EXACT title/header from the top of the flowchart
2. stakeholders = ONLY the swimlane labels (the headers on the left side). Copy them EXACTLY as written
3. stepName = Copy the EXACT text from each shape. Do NOT paraphrase or reword
4. responsible = The swimlane label where that step physically sits in the diagram
5. Include EVERY step visible in the flowchart (excluding start/end circles)
6. For decision diamonds: describe both Yes and No paths with step numbers
7. inputs/outputs = Only from document shapes (wavy-bottom rectangles). If none, use "-"`;

    if (customInstructions) {
      userPrompt += `\n\nAdditional instructions: ${customInstructions}`;
    }
    
    if (processedOrgStructure) {
      const truncatedOrg = processedOrgStructure.length > 10000 ? processedOrgStructure.slice(0, 10000) : processedOrgStructure;
      userPrompt += `\n\nOrganization Structure (use for RACI accountable/consulted/informed assignments):\n${truncatedOrg}`;
    }

    userPrompt += `\n\nReturn ONLY valid JSON. No markdown, no explanation.`;

    const manualStream = anthropic.messages.stream({
      model: 'claude-opus-4-5',
      max_tokens: 16000,
      system: `You are an expert at reading flowchart images and generating process manuals. You must copy text EXACTLY as it appears in the image - never paraphrase, abbreviate, or reword. The "responsible" field must always be the swimlane label where the step sits. Output only valid JSON.`,
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
              text: userPrompt,
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
