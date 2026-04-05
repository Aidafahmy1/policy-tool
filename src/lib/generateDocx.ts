import {
  Document,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  AlignmentType,
  WidthType,
  BorderStyle,
  ImageRun,
  convertInchesToTwip,
} from 'docx';

export interface ManualData {
  processName: string;
  processLevel?: string;
  processObjectives?: string;
  processScope?: string;
  // Legacy format support
  processOverview?: {
    purpose: string;
    scope: string;
  };
  // Supports both string array and object array
  stakeholders: Array<string> | Array<{
    role: string;
    department?: string;
    assignedPerson?: string | null;
  }>;
  authorityMatrixDefinition: {
    R: string;
    A: string;
    C: string;
    I: string;
  };
  processSteps: Array<{
    stepNumber: number;
    stepName: string;
    description: string;
    // Primary format: separate RACI fields
    responsible?: string;
    accountable?: string;
    consulted?: string;
    informed?: string;
    inputs: string[] | string;
    outputs: string[] | string;
    // Legacy format support
    raci?: Record<string, string>;
  }>;
}

// Helper to normalize inputs/outputs to a display string
function normalizeIO(val: string[] | string | undefined | null): string {
  if (!val) return '-';
  if (Array.isArray(val)) {
    const filtered = val.filter(v => v && v !== '-');
    return filtered.length > 0 ? filtered.join(', ') : '-';
  }
  return val || '-';
}

// Helper to extract RACI from either format
function extractRACI(step: ManualData['processSteps'][0]): { responsible: string; accountable: string; consulted: string; informed: string } {
  // Primary: separate fields
  if (step.responsible) {
    return {
      responsible: step.responsible || '-',
      accountable: step.accountable || '-',
      consulted: step.consulted || '-',
      informed: step.informed || '-',
    };
  }
  // Legacy: raci map { "Role": "R" }
  if (step.raci) {
    const entries = Object.entries(step.raci);
    return {
      responsible: entries.filter(([, v]) => v === 'R' || v === 'r').map(([k]) => k).join(', ') || '-',
      accountable: entries.filter(([, v]) => v === 'A' || v === 'a').map(([k]) => k).join(', ') || '-',
      consulted: entries.filter(([, v]) => v === 'C' || v === 'c').map(([k]) => k).join(', ') || '-',
      informed: entries.filter(([, v]) => v === 'I' || v === 'i').map(([k]) => k).join(', ') || '-',
    };
  }
  return { responsible: '-', accountable: '-', consulted: '-', informed: '-' };
}

const BRAND_COLOR = '10B981'; // Emerald green

function createHeaderCell(text: string): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            bold: true,
            color: 'FFFFFF',
            size: 20,
          }),
        ],
        alignment: AlignmentType.CENTER,
      }),
    ],
    shading: { fill: BRAND_COLOR },
    verticalAlign: 'center',
  });
}

function createCell(text: string, center = false): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            size: 20,
          }),
        ],
        alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
      }),
    ],
    verticalAlign: 'center',
  });
}

export function generateManualDocument(
  manualData: ManualData,
  diagramImageBase64?: string
): Document {
  const sections: Paragraph[] = [];
  
  // Get stakeholders as simple string array
  const stakeholderNames: string[] = Array.isArray(manualData.stakeholders) 
    ? manualData.stakeholders.map(s => typeof s === 'string' ? s : s.role)
    : [];

  // Title - Process Name
  sections.push(
    new Paragraph({
      children: [
        new TextRun({
          text: manualData.processName,
          bold: true,
          size: 48,
          color: BRAND_COLOR,
        }),
      ],
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    })
  );

  // Subtitle - Process Level
  sections.push(
    new Paragraph({
      children: [
        new TextRun({
          text: manualData.processLevel || 'Subsidiary Level Process',
          size: 28,
          color: '666666',
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
    })
  );

  // Process' Objectives
  sections.push(
    new Paragraph({
      text: "Process' Objectives",
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    })
  );

  const objectives = manualData.processObjectives || manualData.processOverview?.purpose || '';
  sections.push(
    new Paragraph({
      children: [
        new TextRun({ text: objectives }),
      ],
      spacing: { after: 400 },
    })
  );

  // Process' Scope
  sections.push(
    new Paragraph({
      text: "Process' Scope",
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    })
  );

  const scope = manualData.processScope || manualData.processOverview?.scope || '';
  sections.push(
    new Paragraph({
      children: [
        new TextRun({ text: scope }),
      ],
      spacing: { after: 400 },
    })
  );

  // Process' Stakeholders
  sections.push(
    new Paragraph({
      text: "Process' Stakeholders",
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    })
  );

  stakeholderNames.forEach((stakeholder, index) => {
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${index + 1}. ${stakeholder}` }),
        ],
        spacing: { after: 100 },
      })
    );
  });

  // Authority Matrix Definition
  sections.push(
    new Paragraph({
      text: 'Authority Matrix Definition',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    })
  );

  const raciDefinitions = [
    { letter: 'R', name: 'Responsible', def: manualData.authorityMatrixDefinition.R },
    { letter: 'A', name: 'Accountable', def: manualData.authorityMatrixDefinition.A },
    { letter: 'C', name: 'Consulted', def: manualData.authorityMatrixDefinition.C },
    { letter: 'I', name: 'Informed', def: manualData.authorityMatrixDefinition.I },
  ];

  raciDefinitions.forEach((item) => {
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: `• ${item.letter}-${item.name}: `, bold: true }),
          new TextRun({ text: item.def }),
        ],
        spacing: { after: 100 },
      })
    );
  });

  // Process Flowchart
  sections.push(
    new Paragraph({
      text: 'Process Flowchart',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    })
  );

  if (diagramImageBase64) {
    // Remove data URL prefix if present
    const base64Data = diagramImageBase64.replace(/^data:image\/\w+;base64,/, '');
    
    // Use full page width for the flowchart, maintaining aspect ratio
    // A4 portrait with 1" margins = ~6.27" usable width ≈ 600px at 96dpi
    const maxWidth = 600;
    const maxHeight = 420;
    
    sections.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: Buffer.from(base64Data, 'base64'),
            transformation: {
              width: maxWidth,
              height: maxHeight,
            },
            type: 'png',
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    );
  } else {
    sections.push(
      new Paragraph({
        children: [
          new TextRun({
            text: '[Process flowchart diagram will be inserted here]',
            italics: true,
            color: '999999',
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    );
  }

  // Process Description Table - matching reference manual format
  sections.push(
    new Paragraph({
      text: 'Process Description',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    })
  );

  // Create table header matching reference: Step | Description | Responsible | Accountable | Consult | Inform | Inputs | Output
  const headerCells = [
    createHeaderCell('Step'),
    createHeaderCell('Description'),
    createHeaderCell('Responsible'),
    createHeaderCell('Accountable'),
    createHeaderCell('Consult'),
    createHeaderCell('Inform'),
    createHeaderCell('Inputs'),
    createHeaderCell('Output'),
  ];

  const tableRows = [new TableRow({ children: headerCells })];

  // Add process steps
  manualData.processSteps.forEach((step) => {
    const raci = extractRACI(step);
    const inputsStr = normalizeIO(step.inputs);
    const outputsStr = normalizeIO(step.outputs);

    tableRows.push(
      new TableRow({
        children: [
          createCell(`(${step.stepNumber})\n${step.stepName}`, false),
          createCell(step.description),
          createCell(raci.responsible, true),
          createCell(raci.accountable, true),
          createCell(raci.consulted, true),
          createCell(raci.informed, true),
          createCell(inputsStr),
          createCell(outputsStr),
        ],
      })
    );
  });

  const processTable = new Table({
    rows: tableRows,
    width: {
      size: 100,
      type: WidthType.PERCENTAGE,
    },
  });

  // Build document - single portrait section
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
            },
          },
        },
        children: [...sections, processTable],
      },
    ],
  });

  return doc;
}
