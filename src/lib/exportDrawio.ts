/**
 * Export swimlane flowchart data to draw.io (.drawio) XML format.
 *
 * Converts the internal SwimlaneData + DiagramEditState into a draw.io-compatible
 * XML file that preserves swimlanes, shapes, connections, colors, and labels.
 * The exported file can be opened and edited in draw.io (diagrams.net).
 */

import type { SwimlaneData, ProcessStep, DiagramEditState } from '@/components/SwimlaneSVG';

// Layout constants (matching SwimlaneSVG.tsx)
const LANE_HEIGHT = 160;
const LANE_HEADER_WIDTH = 90;
const CELL_WIDTH = 240;
const SHAPE_WIDTH = 160;
const SHAPE_HEIGHT = 64;
const HEADER_HEIGHT = 40;
const DECISION_SIZE = 64;
const DOC_WIDTH = 110;
const DOC_HEIGHT = 48;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface ShapeInfo {
  id: string;
  label: string;
  type: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  laneIdx: number;
}

/**
 * Get draw.io style string for each shape type, matching our flowchart colors.
 */
function getDrawioStyle(type: string): string {
  switch (type) {
    case 'start':
    case 'end':
      // Rounded pill - dark green fill, white text
      return 'rounded=1;whiteSpace=wrap;html=1;arcSize=50;fillColor=#047857;strokeColor=#065f46;fontColor=#FFFFFF;fontStyle=1;fontSize=10;';
    case 'decision':
      // Diamond - green fill, white text
      return 'rhombus;whiteSpace=wrap;html=1;fillColor=#059669;strokeColor=#047857;fontColor=#FFFFFF;fontStyle=1;fontSize=9;';
    case 'document':
      // Document shape - green fill, white text
      return 'shape=document;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=0.27;fillColor=#059669;strokeColor=#047857;fontColor=#FFFFFF;fontSize=8;';
    case 'subprocess':
      // Subprocess with double borders - gray fill
      return 'rounded=1;whiteSpace=wrap;html=1;fillColor=#f8f9fa;strokeColor=#9ca3af;fontColor=#374151;fontSize=9;';
    case 'database':
    case 'system':
      // Horizontal cylinder - white fill, dark border (rotated to match our tool's left/right ellipses)
      return 'shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;fillColor=#FFFFFF;strokeColor=#374151;fontColor=#1f2937;fontStyle=1;fontSize=9;direction=south;';
    case 'process':
    default:
      // Rounded rect - white fill, green border
      return 'rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#059669;fontColor=#1f2937;fontSize=9;strokeWidth=1.5;';
  }
}

function getShapeDimensions(type: string): { w: number; h: number } {
  if (type === 'decision') return { w: DECISION_SIZE * 1.5, h: DECISION_SIZE * 1.5 };
  if (type === 'document') return { w: DOC_WIDTH, h: DOC_HEIGHT };
  if (type === 'database' || type === 'system') return { w: SHAPE_WIDTH, h: SHAPE_HEIGHT };
  return { w: SHAPE_WIDTH, h: SHAPE_HEIGHT };
}

/**
 * Generate draw.io XML from swimlane data and edit state.
 */
export function generateDrawioXml(
  data: SwimlaneData,
  editState?: DiagramEditState | null,
  logos?: { clientLogo?: string | null; companyLogo?: string | null }
): string {
  const posOffsets = editState?.posOffsets || {};
  const labelOverrides = editState?.labelOverrides || {};
  const deletedConnections = new Set(editState?.deletedConnections || []);
  const deletedShapes = new Set(editState?.deletedShapes || []);
  const extraShapes = editState?.extraShapes || [];
  const extraConnections = editState?.extraConnections || [];
  const extraLanes = editState?.extraLanes || [];
  const laneNameOverrides = editState?.laneNameOverrides || {};
  const typeOverrides = editState?.typeOverrides || {};

  // Calculate lane heights (simplified - use default)
  const allLanes = [
    ...data.lanes.map((l, i) => ({ id: `lane_${i}`, name: laneNameOverrides[`lane_${i}`] || l.name, originalIdx: i })),
    ...extraLanes.map((l) => ({ id: l.id, name: laneNameOverrides[l.id] || l.name, originalIdx: data.lanes.length })),
  ];

  // Compute lane heights based on max stacked shapes per column
  const laneHeights: number[] = [];
  data.lanes.forEach((lane, laneIndex) => {
    const colCounts: Record<number, number> = {};
    lane.steps.forEach(step => {
      if (!deletedShapes.has(step.id)) {
        colCounts[step.x] = (colCounts[step.x] || 0) + 1;
      }
    });
    const maxStacked = Math.max(1, ...Object.values(colCounts), 1);
    laneHeights[laneIndex] = Math.max(LANE_HEIGHT, LANE_HEIGHT + (maxStacked - 1) * (SHAPE_HEIGHT + 30));
  });
  extraLanes.forEach((_, idx) => {
    laneHeights[data.lanes.length + idx] = LANE_HEIGHT;
  });

  // Cumulative Y offsets
  const laneYOffsets: number[] = [HEADER_HEIGHT];
  for (let i = 0; i < allLanes.length; i++) {
    laneYOffsets[i + 1] = laneYOffsets[i] + (laneHeights[i] || LANE_HEIGHT);
  }

  // Compute slot info for stacked shapes
  const slotInfo: Record<string, { slotIndex: number; slotCount: number }> = {};
  data.lanes.forEach((lane, laneIndex) => {
    const cellGroups: Record<string, string[]> = {};
    lane.steps.forEach(step => {
      if (deletedShapes.has(step.id)) return;
      const key = `${laneIndex}:${step.x}`;
      if (!cellGroups[key]) cellGroups[key] = [];
      cellGroups[key].push(step.id);
    });
    for (const ids of Object.values(cellGroups)) {
      ids.forEach((id, idx) => {
        slotInfo[id] = { slotIndex: idx, slotCount: ids.length };
      });
    }
  });

  // Find maxColumns for width calculation
  let maxX = 0;
  data.lanes.forEach(lane => {
    lane.steps.forEach(step => { maxX = Math.max(maxX, step.x); });
  });
  const maxColumns = maxX + 1;
  const totalWidth = LANE_HEADER_WIDTH + maxColumns * CELL_WIDTH + 40;

  // Collect all shapes with positions
  const shapes: ShapeInfo[] = [];
  const stepPositions: Record<string, { laneIndex: number; x: number }> = {};

  data.lanes.forEach((lane, laneIndex) => {
    lane.steps.forEach(step => {
      if (deletedShapes.has(step.id)) return;
      stepPositions[step.id] = { laneIndex, x: step.x };
      const offset = posOffsets[step.id] || { dx: 0, dy: 0 };
      const laneH = laneHeights[laneIndex] || LANE_HEIGHT;
      const laneTop = laneYOffsets[laneIndex];
      const slot = slotInfo[step.id];
      let cy: number;
      if (slot && slot.slotCount > 1) {
        const sectionH = laneH / slot.slotCount;
        cy = laneTop + sectionH * slot.slotIndex + sectionH / 2;
      } else {
        cy = laneTop + laneH / 2;
      }
      const cx = LANE_HEADER_WIDTH + step.x * CELL_WIDTH + CELL_WIDTH / 2 + offset.dx;
      cy += offset.dy;

      const effectiveType = typeOverrides[step.id] || step.type;
      const dims = getShapeDimensions(effectiveType);
      shapes.push({
        id: step.id,
        label: labelOverrides[step.id] || step.label,
        type: effectiveType,
        cx,
        cy,
        w: dims.w,
        h: dims.h,
        laneIdx: laneIndex,
      });
    });
  });

  // Extra shapes
  for (const extra of extraShapes) {
    if (deletedShapes.has(extra.id)) continue;
    const offset = posOffsets[extra.id] || { dx: 0, dy: 0 };
    const effectiveType = typeOverrides[extra.id] || extra.type;
    const dims = getShapeDimensions(effectiveType);
    shapes.push({
      id: extra.id,
      label: labelOverrides[extra.id] || extra.label,
      type: effectiveType,
      cx: extra.x + offset.dx,
      cy: extra.y + offset.dy,
      w: dims.w,
      h: dims.h,
      laneIdx: -1,
    });
  }

  // Collect connections
  const connections: Array<{ from: string; to: string; label?: string }> = [];
  for (const conn of data.connections) {
    const key = `${conn.from}->${conn.to}`;
    if (deletedConnections.has(key)) continue;
    // Check both shapes exist
    if (deletedShapes.has(conn.from) || deletedShapes.has(conn.to)) continue;
    if (!shapes.find(s => s.id === conn.from) || !shapes.find(s => s.id === conn.to)) continue;
    connections.push({
      from: conn.from,
      to: conn.to,
      label: conn.label,
    });
  }
  for (const conn of extraConnections) {
    if (deletedShapes.has(conn.from) || deletedShapes.has(conn.to)) continue;
    if (!shapes.find(s => s.id === conn.from) || !shapes.find(s => s.id === conn.to)) continue;
    connections.push({
      from: conn.from,
      to: conn.to,
      label: conn.label,
    });
  }

  // Build XML
  const totalHeight = laneYOffsets[allLanes.length] + 60 + (logos?.clientLogo || logos?.companyLogo ? 70 : 0);
  let cellId = 2; // 0 and 1 reserved for root and default parent
  const nextId = () => String(cellId++);

  const xmlParts: string[] = [];

  // Header
  xmlParts.push('<?xml version="1.0" encoding="UTF-8"?>');
  xmlParts.push('<mxfile host="app.diagrams.net" modified="' + new Date().toISOString() + '" type="device">');
  xmlParts.push('<diagram name="Process Flowchart" id="flowchart">');
  xmlParts.push('<mxGraphModel dx="1422" dy="762" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="' + Math.ceil(totalWidth) + '" pageHeight="' + Math.ceil(totalHeight) + '">');
  xmlParts.push('<root>');
  xmlParts.push('<mxCell id="0"/>');
  xmlParts.push('<mxCell id="1" parent="0"/>');

  // Logo bar (above title, only if logos are provided)
  const hasLogos = logos?.clientLogo || logos?.companyLogo;
  const LOGO_BAR_HEIGHT = hasLogos ? 70 : 0;
  const contentYOffset = LOGO_BAR_HEIGHT;

  if (hasLogos) {
    // White background for logo bar
    const logoBgId = nextId();
    xmlParts.push(`<mxCell id="${logoBgId}" value="" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#e5e7eb;" vertex="1" parent="1">`);
    xmlParts.push(`<mxGeometry x="0" y="0" width="${totalWidth}" height="${LOGO_BAR_HEIGHT}" as="geometry"/>`);
    xmlParts.push('</mxCell>');

    if (logos?.clientLogo) {
      const clientLogoId = nextId();
      const imgTag = `&lt;img src=&apos;${escapeXml(logos.clientLogo)}&apos; width=&apos;120&apos; height=&apos;50&apos; style=&apos;object-fit:contain&apos;/&gt;`;
      xmlParts.push(`<mxCell id="${clientLogoId}" value="${imgTag}" style="text;html=1;strokeColor=none;fillColor=none;overflow=fill;rounded=0;" vertex="1" parent="1">`);
      xmlParts.push(`<mxGeometry x="10" y="10" width="120" height="50" as="geometry"/>`);
      xmlParts.push('</mxCell>');
    }

    if (logos?.companyLogo) {
      const companyLogoId = nextId();
      const imgTag = `&lt;img src=&apos;${escapeXml(logos.companyLogo)}&apos; width=&apos;160&apos; height=&apos;50&apos; style=&apos;object-fit:contain&apos;/&gt;`;
      xmlParts.push(`<mxCell id="${companyLogoId}" value="${imgTag}" style="text;html=1;strokeColor=none;fillColor=none;overflow=fill;rounded=0;" vertex="1" parent="1">`);
      xmlParts.push(`<mxGeometry x="${totalWidth - 170}" y="10" width="160" height="50" as="geometry"/>`);
      xmlParts.push('</mxCell>');
    }
  }

  // Title bar
  const titleId = nextId();
  xmlParts.push(`<mxCell id="${titleId}" value="${escapeXml(data.title)}" style="text;html=1;strokeColor=none;fillColor=#059669;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;fontColor=#FFFFFF;fontStyle=1;fontSize=14;" vertex="1" parent="1">`);
  xmlParts.push(`<mxGeometry x="0" y="${contentYOffset}" width="${totalWidth}" height="${HEADER_HEIGHT}" as="geometry"/>`);
  xmlParts.push('</mxCell>');

  // Swimlane containers (lane headers + background)
  const laneIds: string[] = [];
  allLanes.forEach((lane, idx) => {
    const laneId = nextId();
    laneIds.push(laneId);
    const y = laneYOffsets[idx];
    const h = laneHeights[idx] || LANE_HEIGHT;

    // Lane header (green label area on the left)
    xmlParts.push(`<mxCell id="${laneId}" value="${escapeXml(lane.name)}" style="shape=rectangle;whiteSpace=wrap;html=1;fillColor=#059669;strokeColor=#047857;fontColor=#FFFFFF;fontStyle=1;fontSize=9;verticalAlign=middle;align=center;" vertex="1" parent="1">`);
    xmlParts.push(`<mxGeometry x="0" y="${y + contentYOffset}" width="${LANE_HEADER_WIDTH}" height="${h}" as="geometry"/>`);
    xmlParts.push('</mxCell>');

    // Lane background (alternating fill with solid borders for clear separation)
    const bgId = nextId();
    const bgColor = idx % 2 === 0 ? '#FFFFFF' : '#f0fdf4';
    xmlParts.push(`<mxCell id="${bgId}" value="" style="rounded=0;whiteSpace=wrap;html=1;fillColor=${bgColor};strokeColor=#d1d5db;strokeWidth=1;" vertex="1" parent="1">`);
    xmlParts.push(`<mxGeometry x="${LANE_HEADER_WIDTH}" y="${y + contentYOffset}" width="${totalWidth - LANE_HEADER_WIDTH}" height="${h}" as="geometry"/>`);
    xmlParts.push('</mxCell>');
  });

  // Shapes — map internal IDs to draw.io cell IDs
  const shapeIdMap: Record<string, string> = {};
  for (const shape of shapes) {
    const drawioId = nextId();
    shapeIdMap[shape.id] = drawioId;
    const style = getDrawioStyle(shape.type);
    const x = shape.cx - shape.w / 2;
    const y = shape.cy - shape.h / 2;

    xmlParts.push(`<mxCell id="${drawioId}" value="${escapeXml(shape.label)}" style="${style}" vertex="1" parent="1">`);
    xmlParts.push(`<mxGeometry x="${Math.round(x)}" y="${Math.round(y + contentYOffset)}" width="${shape.w}" height="${shape.h}" as="geometry"/>`);
    xmlParts.push('</mxCell>');
  }

  // Connections
  for (const conn of connections) {
    const sourceId = shapeIdMap[conn.from];
    const targetId = shapeIdMap[conn.to];
    if (!sourceId || !targetId) continue;

    const connId = nextId();
    const isYes = conn.label?.toLowerCase() === 'yes';
    const isNo = conn.label?.toLowerCase() === 'no';
    const strokeColor = isYes ? '#16a34a' : isNo ? '#dc2626' : '#6b7280';
    const labelText = conn.label ? escapeXml(conn.label) : '';

    let style = `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=${strokeColor};strokeWidth=1.5;fontColor=${strokeColor};fontSize=9;`;
    if (isYes) style += 'fontStyle=1;';
    if (isNo) style += 'fontStyle=1;';

    xmlParts.push(`<mxCell id="${connId}" value="${labelText}" style="${style}" edge="1" source="${sourceId}" target="${targetId}" parent="1">`);
    xmlParts.push('<mxGeometry relative="1" as="geometry"/>');
    xmlParts.push('</mxCell>');
  }

  // Footer
  xmlParts.push('</root>');
  xmlParts.push('</mxGraphModel>');
  xmlParts.push('</diagram>');
  xmlParts.push('</mxfile>');

  return xmlParts.join('\n');
}

/**
 * Trigger browser download of the .drawio file.
 */
export function downloadDrawioFile(
  data: SwimlaneData,
  editState?: DiagramEditState | null,
  filename?: string,
  logos?: { clientLogo?: string | null; companyLogo?: string | null }
) {
  const xml = generateDrawioXml(data, editState, logos);
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (filename || data.title || 'Process_Flowchart').replace(/\s+/g, '_') + '.drawio';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
