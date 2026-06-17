'use client';

import { useState } from 'react';
import ManualPreview from '@/components/ManualPreview';
import { supabase, Message, Attachment } from '@/lib/supabase';
import { Packer } from 'docx';
import { generateManualDocument, ManualData } from '@/lib/generateDocx';
import { generatePolicyDocument, PolicyData } from '@/lib/generatePolicyDocx';

// Resize image to stay within Anthropic's pixel limit (max 1568px on longest side)
function resizeImageBase64(base64: string, maxDim = 1500): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      // If already within limits, return as-is
      if (width <= maxDim && height <= maxDim) {
        resolve(base64);
        return;
      }
      const scale = Math.min(maxDim / width, maxDim / height);
      const newW = Math.round(width * scale);
      const newH = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = newW;
      canvas.height = newH;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, newW, newH);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(base64);
    img.src = base64;
  });
}

interface SwimlaneDataType {
  title: string;
  lanes: Array<{
    name: string;
    steps: Array<{
      id: string;
      label: string;
      type: 'start' | 'end' | 'process' | 'decision' | 'document' | 'subprocess' | 'system' | 'database';
      x: number;
    }>;
  }>;
  connections: Array<{
    from: string;
    to: string;
    label?: string;
  }>;
}

interface ManualGeneratorProps {
  conversationId: string | null;
  mermaidCode: string | null;
  swimlaneData?: SwimlaneDataType | null;
  uploadedImageBase64?: string | null;
  processName?: string | null;
  svgRef?: React.RefObject<SVGSVGElement | null>;
}

// Generate SVG string directly for reliable capture
// Escape special XML characters
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateSVGString(data: SwimlaneDataType): { svg: string; width: number; height: number } {
  const LANE_HEIGHT = 140;
  const LANE_HEADER_WIDTH = 90;
  const CELL_WIDTH = 210;
  const SHAPE_WIDTH = 120;
  const SHAPE_HEIGHT = 50;
  const HEADER_HEIGHT = 40;
  const DECISION_SIZE = 56;
  const GAP = 14;

  // Calculate dimensions & step numbers
  let maxX = 0;
  const stepPositions: Record<string, { laneIndex: number; x: number }> = {};
  const stepNumbers: Record<string, number> = {};
  
  data.lanes.forEach((lane, laneIndex) => {
    lane.steps.forEach((step) => {
      maxX = Math.max(maxX, step.x);
      stepPositions[step.id] = { laneIndex, x: step.x };
    });
  });
  
  // Assign step numbers following the FLOW (BFS from start) for chronological order
  let stepNum = 1;
  const allSteps = data.lanes.flatMap((lane, laneIndex) =>
    lane.steps.map(step => ({ ...step, laneIndex }))
  );

  const adj: Record<string, string[]> = {};
  for (const conn of data.connections) {
    if (!adj[conn.from]) adj[conn.from] = [];
    adj[conn.from].push(conn.to);
  }
  const startNodes = allSteps.filter(s => s.type === 'start').map(s => s.id);
  const visited = new Set<string>();
  const queue: string[] = [...startNodes];
  startNodes.forEach(id => visited.add(id));
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentStep = allSteps.find(s => s.id === currentId);
    if (currentStep && currentStep.type !== 'document') {
      stepNumbers[currentStep.id] = stepNum++;
    }
    const neighbors = (adj[currentId] || [])
      .filter(id => !visited.has(id))
      .map(id => {
        const s = allSteps.find(st => st.id === id);
        return { id, x: s?.x ?? 999, laneIndex: s?.laneIndex ?? 999 };
      })
      .sort((a, b) => a.x - b.x || a.laneIndex - b.laneIndex);
    for (const n of neighbors) {
      visited.add(n.id);
      queue.push(n.id);
    }
  }
  for (const step of allSteps) {
    if (step.type !== 'document' && !stepNumbers[step.id]) {
      stepNumbers[step.id] = stepNum++;
    }
  }
  
  const maxColumns = maxX + 1;
  const svgWidth = LANE_HEADER_WIDTH + (maxColumns * CELL_WIDTH) + 40;

  // Compute vertical slot index for shapes sharing same (lane, x) cell
  const cellGroups: Record<string, string[]> = {};
  data.lanes.forEach((lane, laneIndex) => {
    lane.steps.forEach(step => {
      const key = `${laneIndex}:${step.x}`;
      if (!cellGroups[key]) cellGroups[key] = [];
      cellGroups[key].push(step.id);
    });
  });
  const slotInfo: Record<string, { slotIndex: number; slotCount: number }> = {};
  for (const ids of Object.values(cellGroups)) {
    ids.forEach((id, idx) => {
      slotInfo[id] = { slotIndex: idx, slotCount: ids.length };
    });
  }

  // Compute dynamic lane heights based on max shapes stacked at the same x column
  const laneHeights: number[] = [];
  data.lanes.forEach((lane, laneIndex) => {
    const colCounts: Record<number, number> = {};
    lane.steps.forEach(step => {
      colCounts[step.x] = (colCounts[step.x] || 0) + 1;
    });
    const maxStacked = Math.max(1, ...Object.values(colCounts));
    laneHeights[laneIndex] = Math.max(LANE_HEIGHT, LANE_HEIGHT + (maxStacked - 1) * (SHAPE_HEIGHT + 30));
  });
  const laneYOffsets: number[] = [HEADER_HEIGHT];
  for (let i = 0; i < data.lanes.length; i++) {
    laneYOffsets[i + 1] = laneYOffsets[i] + (laneHeights[i] || LANE_HEIGHT);
  }
  const svgHeight = laneYOffsets[data.lanes.length] + 60;

  const getPos = (stepId: string) => {
    const pos = stepPositions[stepId];
    if (!pos) return null;
    const laneH = laneHeights[pos.laneIndex] || LANE_HEIGHT;
    const laneTop = laneYOffsets[pos.laneIndex];
    const slot = slotInfo[stepId];
    let y: number;
    if (slot && slot.slotCount > 1) {
      const sectionH = laneH / slot.slotCount;
      y = laneTop + sectionH * slot.slotIndex + sectionH / 2;
    } else {
      y = laneTop + laneH / 2;
    }
    return {
      x: LANE_HEADER_WIDTH + (pos.x * CELL_WIDTH) + (CELL_WIDTH / 2),
      y,
    };
  };

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">`;
  svg += `<rect width="100%" height="100%" fill="white"/>`;
  
  // Title
  svg += `<rect x="0" y="0" width="${svgWidth}" height="${HEADER_HEIGHT}" fill="#059669"/>`;
  svg += `<text x="${svgWidth / 2}" y="${HEADER_HEIGHT / 2 + 6}" text-anchor="middle" fill="white" font-size="18" font-family="Arial, sans-serif" font-weight="bold">${escapeXml(data.title || 'Process Flowchart')}</text>`;

  // Layer 1: Lane backgrounds
  data.lanes.forEach((lane, laneIndex) => {
    const laneY = laneYOffsets[laneIndex];
    const laneH = laneHeights[laneIndex] || LANE_HEIGHT;
    svg += `<rect x="0" y="${laneY}" width="${LANE_HEADER_WIDTH}" height="${laneH}" fill="#059669" stroke="#047857" stroke-width="1"/>`;
    svg += `<text x="${LANE_HEADER_WIDTH / 2}" y="${laneY + laneH / 2}" text-anchor="middle" fill="white" font-size="11" font-family="Arial, sans-serif" font-weight="600" transform="rotate(-90, ${LANE_HEADER_WIDTH / 2}, ${laneY + laneH / 2})">${escapeXml(lane.name)}</text>`;
    svg += `<rect x="${LANE_HEADER_WIDTH}" y="${laneY}" width="${svgWidth - LANE_HEADER_WIDTH}" height="${laneH}" fill="white" stroke="#d1d5db" stroke-width="1"/>`;
  });

  // Layer 2: Arrows (before shapes so shapes sit on top)
  svg += `<defs>`;
  svg += `<marker id="ah" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#6b7280"/></marker>`;
  svg += `<marker id="ah-g" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#16a34a"/></marker>`;
  svg += `<marker id="ah-r" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#dc2626"/></marker>`;
  svg += `</defs>`;

  data.connections.forEach((conn) => {
    const fromPos = getPos(conn.from);
    const toPos = getPos(conn.to);
    if (!fromPos || !toPos) return;

    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const fromStep = allSteps.find(s => s.id === conn.from);
    const toStep = allSteps.find(s => s.id === conn.to);
    const isFromDec = fromStep?.type === 'decision';
    const fHW = isFromDec ? DECISION_SIZE / 2 : SHAPE_WIDTH / 2;
    const fHH = isFromDec ? DECISION_SIZE / 2 : SHAPE_HEIGHT / 2;
    const tHW = toStep?.type === 'decision' ? DECISION_SIZE / 2 : SHAPE_WIDTH / 2;
    const tHH = toStep?.type === 'decision' ? DECISION_SIZE / 2 : SHAPE_HEIGHT / 2;
    const fromLaneIdx = stepPositions[conn.from]?.laneIndex ?? 0;
    const toLaneIdx = stepPositions[conn.to]?.laneIndex ?? 0;
    const isSameLane = fromLaneIdx === toLaneIdx;
    const isSameCol = Math.abs(dx) < CELL_WIDTH / 2;
    const isYes = conn.label?.toLowerCase() === 'yes';
    const isNo = conn.label?.toLowerCase() === 'no';

    let path = '';
    let lx = 0, ly = 0;

    if (isFromDec && isYes) {
      const sx = fromPos.x + fHW;
      if (isSameLane && dx > 0) {
        path = `M ${sx} ${fromPos.y} L ${toPos.x - tHW - GAP} ${toPos.y}`;
      } else {
        const mx = fromPos.x + CELL_WIDTH / 2;
        path = `M ${sx} ${fromPos.y} L ${mx} ${fromPos.y} L ${mx} ${toPos.y} L ${toPos.x - tHW - GAP} ${toPos.y}`;
      }
      lx = sx + 14; ly = fromPos.y - 8;
    } else if (isFromDec && isNo) {
      const sy = fromPos.y + fHH;
      if (isSameCol) {
        path = `M ${fromPos.x} ${sy} L ${toPos.x} ${toPos.y - tHH - GAP}`;
      } else if (dx < 0) {
        const baseLane = Math.max(stepPositions[conn.from]?.laneIndex ?? 0, stepPositions[conn.to]?.laneIndex ?? 0);
        const ry = Math.max(sy + GAP + 10, laneYOffsets[baseLane + 1] - 8);
        path = `M ${fromPos.x} ${sy} L ${fromPos.x} ${ry} L ${toPos.x} ${ry} L ${toPos.x} ${toPos.y + tHH + GAP}`;
      } else {
        const ry = sy + GAP + 15;
        path = `M ${fromPos.x} ${sy} L ${fromPos.x} ${ry} L ${toPos.x} ${ry} L ${toPos.x} ${toPos.y - tHH - GAP}`;
      }
      lx = fromPos.x + 14; ly = fromPos.y + fHH + 14;
    } else if (isSameLane && dx > 0) {
      path = `M ${fromPos.x + fHW} ${fromPos.y} L ${toPos.x - tHW - GAP} ${toPos.y}`;
      lx = (fromPos.x + fHW + toPos.x - tHW) / 2; ly = fromPos.y - 10;
    } else if (isSameLane && dx < 0) {
      const fromLI = stepPositions[conn.from]?.laneIndex ?? 0;
      const ry = laneYOffsets[fromLI + 1] - 8;
      path = `M ${fromPos.x - fHW} ${fromPos.y} L ${fromPos.x - fHW - GAP} ${fromPos.y} L ${fromPos.x - fHW - GAP} ${ry} L ${toPos.x + tHW + GAP} ${ry} L ${toPos.x + tHW + GAP} ${toPos.y} L ${toPos.x + tHW} ${toPos.y}`;
      lx = (fromPos.x + toPos.x) / 2; ly = ry + 12;
    } else if (isSameCol && dy > 0) {
      path = `M ${fromPos.x} ${fromPos.y + fHH} L ${toPos.x} ${toPos.y - tHH - GAP}`;
      lx = fromPos.x + 15; ly = (fromPos.y + fHH + toPos.y - tHH) / 2;
    } else if (isSameCol && dy < 0) {
      path = `M ${fromPos.x} ${fromPos.y - fHH} L ${toPos.x} ${toPos.y + tHH + GAP}`;
      lx = fromPos.x + 15; ly = (fromPos.y - fHH + toPos.y + tHH) / 2;
    } else if (dx > 0) {
      const mx = (fromPos.x + toPos.x) / 2;
      path = `M ${fromPos.x + fHW} ${fromPos.y} L ${mx} ${fromPos.y} L ${mx} ${toPos.y} L ${toPos.x - tHW - GAP} ${toPos.y}`;
      lx = mx + 8; ly = Math.min(fromPos.y, toPos.y) - 8;
    } else {
      const fromLI = stepPositions[conn.from]?.laneIndex ?? 0;
      const toLI = stepPositions[conn.to]?.laneIndex ?? 0;
      const ry = (laneYOffsets[Math.max(fromLI, toLI) + 1] || laneYOffsets[data.lanes.length]) - 8;
      path = `M ${fromPos.x} ${fromPos.y + fHH} L ${fromPos.x} ${ry} L ${toPos.x} ${ry} L ${toPos.x} ${toPos.y + tHH + GAP}`;
      lx = (fromPos.x + toPos.x) / 2; ly = ry - 8;
    }

    const sc = isYes ? '#16a34a' : isNo ? '#dc2626' : '#6b7280';
    const me = isYes ? 'url(#ah-g)' : isNo ? 'url(#ah-r)' : 'url(#ah)';
    svg += `<path d="${path}" fill="none" stroke="${sc}" stroke-width="1.5" marker-end="${me}"/>`;
    if (conn.label) {
      const bg = isYes ? '#dcfce7' : isNo ? '#fee2e2' : 'white';
      const bc = isYes ? '#16a34a' : isNo ? '#dc2626' : '#d1d5db';
      const tc = isYes ? '#15803d' : isNo ? '#dc2626' : '#374151';
      svg += `<rect x="${lx - 16}" y="${ly - 10}" width="32" height="16" fill="${bg}" stroke="${bc}" stroke-width="1" rx="3"/>`;
      svg += `<text x="${lx}" y="${ly + 2}" text-anchor="middle" fill="${tc}" font-size="10" font-family="Arial, sans-serif" font-weight="700">${escapeXml(conn.label)}</text>`;
    }
  });

  // Layer 3: Shapes (on top of arrows)
  data.lanes.forEach((lane) => {
    lane.steps.forEach((step) => {
      const pos = getPos(step.id);
      if (!pos) return;
      const cx = pos.x, cy = pos.y;
      const halfW = SHAPE_WIDTH / 2, halfH = SHAPE_HEIGHT / 2;
      const num = stepNumbers[step.id];
      const escapedLabel = escapeXml(step.label);

      if (step.type === 'start' || step.type === 'end') {
        svg += `<rect x="${cx - halfW}" y="${cy - halfH}" width="${SHAPE_WIDTH}" height="${SHAPE_HEIGHT}" rx="${SHAPE_HEIGHT / 2}" fill="#047857" stroke="#065f46" stroke-width="1"/>`;
        svg += `<text x="${cx}" y="${cy + 5}" text-anchor="middle" fill="white" font-size="11" font-family="Arial, sans-serif" font-weight="600">${escapedLabel}</text>`;
        if (num) {
          svg += `<circle cx="${cx - halfW + 10}" cy="${cy - halfH + 10}" r="8" fill="#047857" stroke="white" stroke-width="1.5"/>`;
          svg += `<text x="${cx - halfW + 10}" y="${cy - halfH + 13}" text-anchor="middle" fill="white" font-size="7" font-family="Arial, sans-serif" font-weight="700">${num}</text>`;
        }
      } else if (step.type === 'decision') {
        const hd = DECISION_SIZE / 2;
        svg += `<polygon points="${cx},${cy - hd} ${cx + hd},${cy} ${cx},${cy + hd} ${cx - hd},${cy}" fill="#059669" stroke="#047857" stroke-width="1.5"/>`;
        svg += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="white" font-size="8" font-family="Arial, sans-serif" font-weight="600">${escapedLabel.length > 12 ? escapedLabel.slice(0, 12) + '..' : escapedLabel}</text>`;
        if (num) {
          svg += `<circle cx="${cx - hd + 10}" cy="${cy - hd + 10}" r="8" fill="#047857" stroke="white" stroke-width="1.5"/>`;
          svg += `<text x="${cx - hd + 10}" y="${cy - hd + 13}" text-anchor="middle" fill="white" font-size="7" font-family="Arial, sans-serif" font-weight="700">${num}</text>`;
        }
      } else if (step.type === 'system' || step.type === 'database') {
        const sHW = SHAPE_WIDTH / 2;
        const sHH = SHAPE_HEIGHT / 2;
        const erx = 14;
        svg += `<path d="M${cx - sHW + erx},${cy - sHH} L${cx + sHW - erx},${cy - sHH} A${erx},${sHH} 0 0,1 ${cx + sHW - erx},${cy + sHH} L${cx - sHW + erx},${cy + sHH} A${erx},${sHH} 0 0,1 ${cx - sHW + erx},${cy - sHH} Z" fill="white" stroke="#1f2937" stroke-width="1.5"/>`;
        svg += `<ellipse cx="${cx + sHW - erx}" cy="${cy}" rx="${erx}" ry="${sHH}" fill="white" stroke="#1f2937" stroke-width="1.5"/>`;
        svg += `<ellipse cx="${cx - sHW + erx}" cy="${cy}" rx="${erx}" ry="${sHH}" fill="white" stroke="#1f2937" stroke-width="1.5"/>`;
        svg += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="#1f2937" font-size="10" font-family="Arial, sans-serif" font-weight="600">${escapedLabel.length > 18 ? escapedLabel.slice(0, 18) + '..' : escapedLabel}</text>`;
        if (num) {
          svg += `<circle cx="${cx - sHW + 10}" cy="${cy - sHH + 10}" r="8" fill="#047857" stroke="white" stroke-width="1.5"/>`;
          svg += `<text x="${cx - sHW + 10}" y="${cy - sHH + 13}" text-anchor="middle" fill="white" font-size="7" font-family="Arial, sans-serif" font-weight="700">${num}</text>`;
        }
      } else {
        svg += `<rect x="${cx - halfW}" y="${cy - halfH}" width="${SHAPE_WIDTH}" height="${SHAPE_HEIGHT}" rx="4" fill="white" stroke="#059669" stroke-width="1.5"/>`;
        svg += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="#1f2937" font-size="10" font-family="Arial, sans-serif" font-weight="500">${escapedLabel.length > 18 ? escapedLabel.slice(0, 18) + '..' : escapedLabel}</text>`;
        if (num) {
          svg += `<circle cx="${cx - halfW + 10}" cy="${cy - halfH + 10}" r="8" fill="#047857" stroke="white" stroke-width="1.5"/>`;
          svg += `<text x="${cx - halfW + 10}" y="${cy - halfH + 13}" text-anchor="middle" fill="white" font-size="7" font-family="Arial, sans-serif" font-weight="700">${num}</text>`;
        }
      }
    });
  });

  svg += '</svg>';
  return { svg, width: svgWidth, height: svgHeight };
}

// Convert SVG string to PNG base64
async function svgToPng(svgString: string, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const scale = 2;
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      reject(new Error('Could not get canvas context'));
      return;
    }
    
    // Fill white background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    
    const img = new Image();
    
    // Use Blob URL instead of base64 for better compatibility
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png', 1.0));
    };
    
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      console.error('SVG load error:', e);
      reject(new Error('Failed to load SVG image'));
    };
    
    img.src = url;
  });
}

export default function ManualGenerator({
  conversationId,
  mermaidCode,
  swimlaneData,
  uploadedImageBase64,
  processName: propProcessName,
  svgRef,
}: ManualGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingPolicy, setIsGeneratingPolicy] = useState(false);
  const [manualData, setManualData] = useState<ManualData | null>(null);
  const [policyData, setPolicyData] = useState<PolicyData | null>(null);
  const [orgStructure, setOrgStructure] = useState<string>('');
  const [orgStructureImageBase64, setOrgStructureImageBase64] = useState<string | null>(null);
  const [showOrgInput, setShowOrgInput] = useState(false);
  const [customInstructions, setCustomInstructions] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState<'manual' | 'policy' | null>(null);

  const handleGenerateManual = async () => {
    // Check if we have an uploaded image OR a conversation diagram OR visio attachments
    const hasUploadedImage = uploadedImageBase64;
    const hasConversationDiagram = conversationId && mermaidCode;
    
    const hasStructuredData = swimlaneData && swimlaneData.lanes && swimlaneData.lanes.length > 0;

    // Check for Visio file attachments
    let visioContent: string | null = null;
    if (conversationId) {
      const { data: chatAttachments } = await supabase
        .from('attachments')
        .select('file_name, file_content')
        .eq('conversation_id', conversationId);

      if (chatAttachments) {
        const visioAtt = chatAttachments.find(a => 
          a.file_name.toLowerCase().endsWith('.vsdx') || a.file_name.toLowerCase().endsWith('.vsd')
        );
        if (visioAtt && visioAtt.file_content) {
          visioContent = visioAtt.file_content;
        }
      }
    }

    const hasVisio = !!visioContent;

    if (!hasStructuredData && !hasUploadedImage && !hasConversationDiagram && !hasVisio) {
      setError('Please upload a flowchart image or Visio file first');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      // If we have a Visio file but NO structured swimlane data, use the Visio endpoint
      if (!hasStructuredData && hasVisio) {
        let orgData = orgStructure;
        if (!orgData.trim() && conversationId) {
          const { data: chatAttachments } = await supabase
            .from('attachments')
            .select('file_name, file_content')
            .eq('conversation_id', conversationId);

          if (chatAttachments) {
            const orgKeywords = ['org', 'structure', 'hierarchy', 'department', 'role', 'position', 'chart', 'raci', 'stakeholder', 'team'];
            for (const att of chatAttachments) {
              const nameLC = att.file_name.toLowerCase();
              const contentLC = (att.file_content || '').toLowerCase().slice(0, 500);
              const isOrgDoc = orgKeywords.some(kw => nameLC.includes(kw) || contentLC.includes(kw));
              if (isOrgDoc && att.file_content && !nameLC.endsWith('.vsdx') && !nameLC.endsWith('.vsd')) {
                orgData += (orgData ? '\n\n' : '') + `--- ${att.file_name} ---\n${att.file_content}`;
              }
            }
          }
        }

        const response = await fetch('/api/generate-manual-from-visio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            visioContent,
            customInstructions: customInstructions.trim() || undefined,
            orgStructure: orgData.trim() || undefined,
          }),
        });

        const data = await response.json();

        if (data.error) {
          setError(data.error);
          setIsGenerating(false);
          return;
        }

        setManualData(data.manual);
        setShowPreview('manual');
        setIsGenerating(false);
        return;
      }

      // PRIORITY: If we have structured swimlane data, ALWAYS use the conversation path
      // because it force-overwrites step names from the flowchart (guaranteed exact match).
      // Only fall back to image-reading when there's NO structured data.
      if (swimlaneData && swimlaneData.lanes && swimlaneData.lanes.length > 0) {
        let messages: Array<{ role: string; content: string }> = [];
        let orgData = orgStructure;

        if (conversationId) {
          const { data: dbMessages } = await supabase
            .from('messages')
            .select('*')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true });

          if (dbMessages && dbMessages.length > 0) {
            messages = dbMessages.map((m) => ({ role: m.role, content: m.content }));
          }

          if (!orgData.trim()) {
            const { data: chatAttachments } = await supabase
              .from('attachments')
              .select('file_name, file_content')
              .eq('conversation_id', conversationId);

            if (chatAttachments && chatAttachments.length > 0) {
              const orgKeywords = ['org', 'structure', 'hierarchy', 'department', 'role', 'position', 'chart', 'raci', 'stakeholder', 'team'];
              for (const att of chatAttachments) {
                const nameLC = att.file_name.toLowerCase();
                const contentLC = (att.file_content || '').toLowerCase().slice(0, 500);
                const isOrgDoc = orgKeywords.some(kw => nameLC.includes(kw) || contentLC.includes(kw));
                if (isOrgDoc && att.file_content) {
                  orgData += (orgData ? '\n\n' : '') + `--- ${att.file_name} ---\n${att.file_content}`;
                }
              }
            }
          }
        }

        if (customInstructions.trim()) {
          messages.push({
            role: 'user',
            content: `ADDITIONAL INSTRUCTIONS FOR THE MANUAL:\n${customInstructions}`
          });
        }

        const response = await fetch('/api/generate-manual', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages,
            mermaidCode,
            orgStructure: orgData,
            swimlaneData: swimlaneData,
            processName: swimlaneData?.title || propProcessName,
            customInstructions: customInstructions.trim() || undefined,
          }),
        });

        if (!response.ok) {
          let errText = `API error (${response.status})`;
          try { const errData = await response.json(); errText = errData.error || errText; } catch {}
          setError(errText);
          setIsGenerating(false);
          return;
        }

        // Read SSE stream
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let manualResult: any = null;
        let streamError: string | null = null;

        if (reader) {
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.done && parsed.manual) {
                  manualResult = parsed.manual;
                }
                if (parsed.error) {
                  streamError = parsed.error;
                }
              } catch {}
            }
          }
        }

        if (streamError) {
          setError(streamError);
          setIsGenerating(false);
          return;
        }

        if (!manualResult) {
          setError('No manual data received');
          setIsGenerating(false);
          return;
        }

        setManualData(manualResult);
        setShowPreview('manual');
      } else if (hasUploadedImage) {
        // Fallback: no structured data, use image-reading AI
        // Resize images to stay within Anthropic's pixel limits
        const resizedImage = await resizeImageBase64(uploadedImageBase64!);
        const resizedOrgImage = orgStructureImageBase64 ? await resizeImageBase64(orgStructureImageBase64) : undefined;

        const response = await fetch('/api/generate-manual-from-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: resizedImage,
            customInstructions: customInstructions.trim() || undefined,
            orgStructure: orgStructure.trim() || undefined,
            orgStructureImageBase64: resizedOrgImage || undefined,
          }),
        });

        const data = await response.json();

        if (data.error) {
          setError(data.error);
          setIsGenerating(false);
          return;
        }

        setManualData(data.manual);
        setShowPreview('manual');
      }
    } catch (err) {
      console.error('Error generating manual:', err);
      setError('Failed to generate manual');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadDocx = async () => {
    if (!manualData) return;

    try {
      let diagramImageBase64: string | undefined;
      
      // If user uploaded an image, use it directly (don't generate a new one)
      if (uploadedImageBase64) {
        diagramImageBase64 = uploadedImageBase64;
        console.log('Using uploaded image directly');
      } else if (swimlaneData) {
        // Prefer capturing the live SVG (includes drag modifications) over regenerating
        try {
          if (svgRef?.current) {
            const svgEl = svgRef.current;
            // Clone and strip UI-only elements for clean export
            const svgClone = svgEl.cloneNode(true) as SVGSVGElement;
            svgClone.querySelectorAll('[data-no-export]').forEach(el => el.remove());
            svgClone.querySelectorAll('foreignObject').forEach(el => el.remove());
            const serializer = new XMLSerializer();
            const svgString = serializer.serializeToString(svgClone);
            const w = svgEl.width.baseVal.value || svgEl.viewBox.baseVal.width;
            const h = svgEl.height.baseVal.value || svgEl.viewBox.baseVal.height;
            diagramImageBase64 = await svgToPng(svgString, w, h);
            console.log('Diagram captured from live SVG (with edits):', diagramImageBase64.length, 'chars');
          } else {
            const { svg, width, height } = generateSVGString(swimlaneData);
            diagramImageBase64 = await svgToPng(svg, width, height);
            console.log('Diagram generated from swimlane data:', diagramImageBase64.length, 'chars');
          }
        } catch (imgError) {
          console.error('Error generating diagram image:', imgError);
        }
      }
      
      // Generate document
      const doc = generateManualDocument(manualData, diagramImageBase64);
      const blob = await Packer.toBlob(doc);

      // Download
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${manualData.processName.replace(/\s+/g, '_')}_Manual.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading document:', err);
      setError('Failed to download document');
    }
  };

  const handleGeneratePolicy = async () => {
    const hasStructuredData = swimlaneData && swimlaneData.lanes && swimlaneData.lanes.length > 0;
    const hasUploadedImage = uploadedImageBase64;
    const hasConversationDiagram = conversationId && mermaidCode;

    if (!hasStructuredData && !hasUploadedImage && !hasConversationDiagram) {
      setError('Please create a process flowchart first');
      return;
    }

    setIsGeneratingPolicy(true);
    setError(null);

    try {
      let messages: Array<{ role: string; content: string }> = [];
      let orgData = orgStructure;

      if (conversationId) {
        const { data: dbMessages } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true });

        if (dbMessages && dbMessages.length > 0) {
          messages = dbMessages.map((m) => ({ role: m.role, content: m.content }));
        }

        if (!orgData.trim()) {
          const { data: chatAttachments } = await supabase
            .from('attachments')
            .select('file_name, file_content')
            .eq('conversation_id', conversationId);

          if (chatAttachments && chatAttachments.length > 0) {
            const orgKeywords = ['org', 'structure', 'hierarchy', 'department', 'role', 'position', 'chart', 'raci', 'stakeholder', 'team'];
            for (const att of chatAttachments) {
              const nameLC = att.file_name.toLowerCase();
              const contentLC = (att.file_content || '').toLowerCase().slice(0, 500);
              const isOrgDoc = orgKeywords.some(kw => nameLC.includes(kw) || contentLC.includes(kw));
              if (isOrgDoc && att.file_content) {
                orgData += (orgData ? '\n\n' : '') + `--- ${att.file_name} ---\n${att.file_content}`;
              }
            }
          }
        }
      }

      const response = await fetch('/api/generate-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          swimlaneData,
          processName: swimlaneData?.title || propProcessName,
          orgStructure: orgData,
          customInstructions: customInstructions.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (data.error) {
        setError(data.error);
        setIsGeneratingPolicy(false);
        return;
      }

      setPolicyData(data.policy);
      setShowPreview('policy');
    } catch (err) {
      console.error('Error generating policy:', err);
      setError('Failed to generate policy document');
    } finally {
      setIsGeneratingPolicy(false);
    }
  };

  const handleDownloadPolicyDocx = async () => {
    if (!policyData) return;

    try {
      const doc = generatePolicyDocument(policyData);
      const blob = await Packer.toBlob(doc);

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${policyData.policyName.replace(/\s+/g, '_')}_Policy.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading policy document:', err);
      setError('Failed to download policy document');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    
    // Check if it's an image file
    if (file.type.startsWith('image/')) {
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setOrgStructureImageBase64(base64);
        setOrgStructure(''); // Clear text if image is uploaded
      };
      reader.readAsDataURL(file);
    } else {
      // Text file
      reader.onload = (event) => {
        setOrgStructure(event.target?.result as string);
        setOrgStructureImageBase64(null); // Clear image if text is uploaded
      };
      reader.readAsText(file);
    }
  };

  // Check if we can generate a manual - either from uploaded image or conversation
  const canGenerateManual = uploadedImageBase64 || (conversationId && mermaidCode);
  
  if (!canGenerateManual) {
    return (
      <div className="p-4 bg-gray-100 rounded-lg text-center text-gray-500">
        <p>Upload a flowchart image to generate a manual</p>
      </div>
    );
  }

  return (
    <div className="p-4 bg-white rounded-lg border border-gray-200">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">
        Generate Documents
      </h3>

      {/* Custom Instructions */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Custom Instructions (Optional)
        </label>
        <textarea
          value={customInstructions}
          onChange={(e) => setCustomInstructions(e.target.value)}
          placeholder="Add any specific requests for the manual, e.g.:
• Include specific compliance requirements
• Add detailed descriptions for certain steps
• Specify particular stakeholder responsibilities
• Request specific formatting or sections"
          className="w-full h-28 p-3 text-sm text-gray-900 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-[#2EAD6D] focus:border-[#2EAD6D] placeholder:text-gray-400"
        />
      </div>

      {/* Org Structure Input */}
      <div className="mb-4">
        <button
          onClick={() => setShowOrgInput(!showOrgInput)}
          className="text-sm flex items-center gap-1" style={{ color: '#2EAD6D' }}
        >
          {showOrgInput ? '▼' : '▶'} Add Organization Structure (Optional)
        </button>

        {showOrgInput && (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-gray-500">
              Upload an org chart image or paste text to auto-assign people to roles
            </p>
            <input
              type="file"
              accept=".txt,.csv,.json,.md,.tsv,.xml,.xlsx,.xls,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.vsdx,.vsd"
              onChange={handleFileUpload}
              className="text-sm"
            />
            {orgStructureImageBase64 && (
              <div className="relative">
                <img 
                  src={orgStructureImageBase64} 
                  alt="Org Structure" 
                  className="max-h-32 rounded border border-gray-300"
                />
                <button
                  onClick={() => setOrgStructureImageBase64(null)}
                  className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center hover:bg-red-600"
                >
                  ×
                </button>
                <p className="text-xs text-green-600 mt-1">✓ Org chart image uploaded</p>
              </div>
            )}
            {!orgStructureImageBase64 && (
              <textarea
                value={orgStructure}
                onChange={(e) => setOrgStructure(e.target.value)}
                placeholder="Or paste org structure here (e.g., CEO: John Smith, CFO: Jane Doe...)"
                className="w-full h-24 p-2 text-sm text-gray-900 border border-gray-300 rounded resize-none placeholder:text-gray-400"
              />
            )}
          </div>
        )}
      </div>

      {/* Generate Buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleGenerateManual}
          disabled={isGenerating || isGeneratingPolicy}
          className="flex-1 px-4 py-2 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{ background: '#0C3B2E' }}
        >
          {isGenerating ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Generating...
            </>
          ) : (
            <>📄 Process Manual</>
          )}
        </button>
        <button
          onClick={handleGeneratePolicy}
          disabled={isGenerating || isGeneratingPolicy}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isGeneratingPolicy ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Generating...
            </>
          ) : (
            <>📋 Policy Document</>
          )}
        </button>
      </div>

      {error && (
        <div className="mt-2 p-2 bg-red-50 text-red-600 text-sm rounded">
          {error}
        </div>
      )}

      {/* Manual ready */}
      {manualData && (
        <div className="mt-4 space-y-3">
          <div className="p-4 bg-gray-50 rounded-lg">
            <h4 className="font-semibold mb-2" style={{ color: '#0C3B2E' }}>{manualData.processName}</h4>
            <p className="text-sm text-gray-600 mb-1">
              <strong>Objectives:</strong> {manualData.processObjectives || (manualData as any).processOverview?.purpose || '—'}
            </p>
            <p className="text-sm text-gray-600 mb-1">
              <strong>Stakeholders:</strong>{' '}
              {Array.isArray(manualData.stakeholders)
                ? manualData.stakeholders.map((s: string | { role: string }) => typeof s === 'string' ? s : s.role).join(', ')
                : '—'}
            </p>
            <p className="text-sm text-gray-600">
              <strong>Steps:</strong> {manualData.processSteps.length} process steps with RACI assignments
            </p>
          </div>
          <div className="flex gap-2">
          <button
            onClick={() => setShowPreview('manual')}
            className="flex-1 px-4 py-2 rounded-lg flex items-center justify-center gap-2 text-sm font-medium"
            style={{ background: '#E8F5EE', border: '1px solid #B8E0CC', color: '#0C3B2E' }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            Preview Manual
          </button>
          <button
            onClick={handleDownloadDocx}
            className="flex-1 px-4 py-2 text-white rounded-lg flex items-center justify-center gap-2 text-sm font-medium"
            style={{ background: '#0C3B2E' }}
          >
            📥 Download .docx
          </button>
          </div>
        </div>
      )}

      {/* Policy ready */}
      {policyData && (
        <div className="mt-4 space-y-3">
          <div className="p-4 bg-blue-50 rounded-lg">
            <h4 className="font-semibold text-blue-700 mb-2">{policyData.policyName}</h4>
            <p className="text-sm text-gray-600 mb-1">
              <strong>Purpose:</strong> {policyData.purpose?.substring(0, 200)}{policyData.purpose?.length > 200 ? '...' : ''}
            </p>
            <p className="text-sm text-gray-600 mb-1">
              <strong>Scope:</strong> {policyData.scope?.substring(0, 200)}{policyData.scope?.length > 200 ? '...' : ''}
            </p>
            <p className="text-sm text-gray-600">
              <strong>Sections:</strong> {policyData.sections?.length || 0} policy sections
            </p>
          </div>
          <div className="flex gap-2">
          <button
            onClick={() => setShowPreview('policy')}
            className="flex-1 px-4 py-2 bg-blue-50 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-100 flex items-center justify-center gap-2 text-sm font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            Preview Policy
          </button>
          <button
            onClick={handleDownloadPolicyDocx}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 text-sm font-medium"
          >
            📥 Download .docx
          </button>
          </div>
        </div>
      )}

      {/* Full preview modal */}
      {showPreview === 'manual' && manualData && (
        <ManualPreview
          manualData={manualData}
          onClose={() => setShowPreview(null)}
          onDownloadManual={handleDownloadDocx}
        />
      )}
      {showPreview === 'policy' && policyData && (
        <ManualPreview
          policyData={policyData}
          onClose={() => setShowPreview(null)}
          onDownloadPolicy={handleDownloadPolicyDocx}
        />
      )}
    </div>
  );
}
