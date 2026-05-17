/**
 * Export swimlane flowchart data to a Visio-compatible Excel file.
 *
 * The Excel follows Microsoft Visio's Data Visualizer format so that
 * Visio can import it and auto-render a cross-functional flowchart
 * that matches the tool's output exactly.
 *
 * Visio Data Visualizer columns:
 *   Process Step ID | Process Step Description | Next Step ID |
 *   Connector Label | Shape Type | Function | Phase
 */

import * as XLSX from 'xlsx';
import type { SwimlaneData, DiagramEditState } from '@/components/SwimlaneSVG';

/** Map internal shape types to Visio shape type names */
function toVisioShapeType(type: string): string {
  switch (type) {
    case 'start':       return 'Start/End';
    case 'end':         return 'Start/End';
    case 'decision':    return 'Decision';
    case 'document':    return 'Document';
    case 'subprocess':  return 'Sub-process';
    case 'database':    return 'Data';
    case 'system':      return 'Data';
    case 'process':
    default:            return 'Process';
  }
}

/**
 * Replicate the tool's BFS step numbering (documents excluded).
 */
function computeStepNumbers(
  data: SwimlaneData,
  deletedShapes: Set<string>,
  numberOverrides: Record<string, number | null>
): Record<string, number> {
  const numbers: Record<string, number> = {};
  let stepNum = 1;

  const allSteps = data.lanes.flatMap((lane, laneIndex) =>
    lane.steps
      .filter(s => !deletedShapes.has(s.id))
      .map(step => ({ ...step, laneIndex }))
  );

  // Build adjacency list
  const adj: Record<string, string[]> = {};
  for (const conn of data.connections) {
    if (deletedShapes.has(conn.from) || deletedShapes.has(conn.to)) continue;
    if (!adj[conn.from]) adj[conn.from] = [];
    adj[conn.from].push(conn.to);
  }

  // BFS from start nodes
  const startNodes = allSteps.filter(s => s.type === 'start').map(s => s.id);
  const visited = new Set<string>();
  const queue: string[] = [...startNodes];
  startNodes.forEach(id => visited.add(id));

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentStep = allSteps.find(s => s.id === currentId);
    if (currentStep && currentStep.type !== 'document') {
      numbers[currentId] = stepNum++;
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

  // Fallback for unreachable steps
  for (const step of allSteps) {
    if (step.type !== 'document' && !numbers[step.id]) {
      numbers[step.id] = stepNum++;
    }
  }

  // Apply user overrides
  for (const [id, val] of Object.entries(numberOverrides)) {
    if (val === null) {
      delete numbers[id];
    } else {
      numbers[id] = val;
    }
  }

  return numbers;
}

export function downloadExcelFile(
  data: SwimlaneData,
  editState?: DiagramEditState | null,
  filename?: string
) {
  const deletedShapes = new Set(editState?.deletedShapes || []);
  const deletedConnections = new Set(editState?.deletedConnections || []);
  const labelOverrides = editState?.labelOverrides || {};
  const laneNameOverrides = editState?.laneNameOverrides || {};
  const typeOverrides = editState?.typeOverrides || {};
  const numberOverrides = editState?.numberOverrides || {};
  const extraConnections = editState?.extraConnections || [];

  // Compute step numbers
  const stepNumbers = computeStepNumbers(data, deletedShapes, numberOverrides as Record<string, number | null>);

  // Map step ID → swimlane name
  const stepToLane: Record<string, string> = {};
  data.lanes.forEach((lane, idx) => {
    const laneName = laneNameOverrides[`lane_${idx}`] || lane.name;
    lane.steps.forEach(step => {
      if (!deletedShapes.has(step.id)) {
        stepToLane[step.id] = laneName;
      }
    });
  });

  // Collect all active connections
  const allConnections: Array<{ from: string; to: string; label?: string }> = [];
  for (const conn of data.connections) {
    const key = `${conn.from}->${conn.to}`;
    if (deletedConnections.has(key)) continue;
    if (deletedShapes.has(conn.from) || deletedShapes.has(conn.to)) continue;
    allConnections.push(conn);
  }
  for (const conn of extraConnections) {
    if (deletedShapes.has(conn.from) || deletedShapes.has(conn.to)) continue;
    allConnections.push(conn);
  }

  // Build outgoing connections per step: { nextStepIds, connectorLabels }
  const outgoing: Record<string, { nextIds: string[]; labels: string[] }> = {};
  for (const conn of allConnections) {
    if (!outgoing[conn.from]) outgoing[conn.from] = { nextIds: [], labels: [] };
    outgoing[conn.from].nextIds.push(conn.to);
    outgoing[conn.from].labels.push(conn.label || '');
  }

  // Build rows for Visio Data Visualizer sheet
  const rows: Record<string, string | number>[] = [];

  // Process all steps in step-number order
  const allSteps = data.lanes.flatMap((lane, laneIndex) =>
    lane.steps
      .filter(s => !deletedShapes.has(s.id))
      .map(step => ({ ...step, laneIndex }))
  );

  // Sort by step number (unnumbered documents at end)
  const sortedSteps = [...allSteps].sort((a, b) => {
    const numA = stepNumbers[a.id] ?? 9999;
    const numB = stepNumbers[b.id] ?? 9999;
    return numA - numB;
  });

  for (const step of sortedSteps) {
    const effectiveType = typeOverrides[step.id] || step.type;
    const label = labelOverrides[step.id] || step.label;
    const num = stepNumbers[step.id];
    const out = outgoing[step.id];

    // For Visio: use step number as the Process Step ID
    const stepId = num != null ? String(num) : step.id;

    // Next Step IDs — use step numbers where available
    const nextStepIds = (out?.nextIds || []).map(id => {
      const n = stepNumbers[id];
      return n != null ? String(n) : id;
    }).join(',');

    const connectorLabels = (out?.labels || []).join(',');

    rows.push({
      'Process Step ID': num != null ? num : stepId,
      'Process Step Description': label,
      'Next Step ID': nextStepIds,
      'Connector Label': connectorLabels,
      'Shape Type': toVisioShapeType(effectiveType),
      'Function': stepToLane[step.id] || '',
    });
  }

  // Create workbook
  const wb = XLSX.utils.book_new();

  // Sheet 1: Visio Data Visualizer format
  const ws = XLSX.utils.json_to_sheet(rows);

  // Auto-size columns
  const colWidths = [
    { wch: 16 }, // Process Step ID
    { wch: 45 }, // Process Step Description
    { wch: 16 }, // Next Step ID
    { wch: 18 }, // Connector Label
    { wch: 14 }, // Shape Type
    { wch: 25 }, // Function
  ];
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, 'Process Steps');

  // Sheet 2: Connections detail
  const connRows = allConnections.map(conn => {
    const fromNum = stepNumbers[conn.from];
    const toNum = stepNumbers[conn.to];
    const fromLabel = labelOverrides[conn.from] || allSteps.find(s => s.id === conn.from)?.label || conn.from;
    const toLabel = labelOverrides[conn.to] || allSteps.find(s => s.id === conn.to)?.label || conn.to;
    return {
      'From Step #': fromNum ?? '',
      'From Step': fromLabel,
      'To Step #': toNum ?? '',
      'To Step': toLabel,
      'Label': conn.label || '',
    };
  });

  if (connRows.length > 0) {
    const ws2 = XLSX.utils.json_to_sheet(connRows);
    ws2['!cols'] = [
      { wch: 12 },
      { wch: 40 },
      { wch: 10 },
      { wch: 40 },
      { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(wb, ws2, 'Connections');
  }

  // Download
  const fname = (filename || data.title || 'Process_Flowchart').replace(/\s+/g, '_') + '.xlsx';
  XLSX.writeFile(wb, fname);
}
