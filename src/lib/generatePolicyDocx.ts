import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
} from 'docx';

export interface PolicyData {
  policyName: string;
  purpose: string;
  scope: string;
  sections: Array<{
    title: string;
    content: string;
  }>;
}

const BRAND_COLOR = '10B981';

export function generatePolicyDocument(policyData: PolicyData): Document {
  const children: Paragraph[] = [];

  // ── Title ──
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: policyData.policyName,
          bold: true,
          size: 48,
          color: BRAND_COLOR,
        }),
      ],
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );

  // ── Decorative line ──
  children.push(
    new Paragraph({
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: BRAND_COLOR },
      },
      spacing: { after: 300 },
    })
  );

  // ── Purpose ──
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: 'Purpose',
          bold: true,
          size: 28,
          color: BRAND_COLOR,
        }),
      ],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 200, after: 120 },
    })
  );

  // Split purpose into paragraphs by newlines
  const purposeParas = policyData.purpose.split(/\n+/).filter(p => p.trim());
  for (const para of purposeParas) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: para.trim(),
            size: 22,
          }),
        ],
        spacing: { after: 120 },
      })
    );
  }

  // ── Scope ──
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: 'Scope',
          bold: true,
          size: 28,
          color: BRAND_COLOR,
        }),
      ],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 120 },
    })
  );

  const scopeParas = policyData.scope.split(/\n+/).filter(p => p.trim());
  for (const para of scopeParas) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: para.trim(),
            size: 22,
          }),
        ],
        spacing: { after: 120 },
      })
    );
  }

  // ── Policy Sections ──
  for (const section of policyData.sections) {
    // Section heading
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: section.title,
            bold: true,
            size: 26,
            color: BRAND_COLOR,
          }),
        ],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 120 },
      })
    );

    // Section content — split by newlines and handle bullet points
    const lines = section.content.split(/\n+/).filter(l => l.trim());
    for (const line of lines) {
      const trimmed = line.trim();
      // Detect bullet points (lines starting with •, -, *, or numbered)
      const isBullet = /^[•\-\*]\s/.test(trimmed);
      const isNumbered = /^\d+[\.\)]\s/.test(trimmed);
      const bulletText = isBullet ? trimmed.replace(/^[•\-\*]\s*/, '') : isNumbered ? trimmed : trimmed;

      if (isBullet || isNumbered) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: bulletText,
                size: 22,
              }),
            ],
            bullet: { level: 0 },
            spacing: { after: 60 },
          })
        );
      } else {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: trimmed,
                size: 22,
              }),
            ],
            spacing: { after: 120 },
          })
        );
      }
    }
  }

  // ── Footer note ──
  children.push(
    new Paragraph({
      border: {
        top: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' },
      },
      spacing: { before: 600, after: 100 },
    })
  );
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: 'This policy document is subject to periodic review and approval by authorized management.',
          italics: true,
          size: 18,
          color: '6B7280',
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    })
  );

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children,
      },
    ],
  });
}
