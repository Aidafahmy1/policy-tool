'use client';

import { forwardRef, useMemo } from 'react';

export interface ProcessStep {
  id: string;
  label: string;
  type: 'start' | 'end' | 'process' | 'decision' | 'document' | 'subprocess';
  x: number;
}

export interface Connection {
  from: string;
  to: string;
  label?: string;
}

export interface Swimlane {
  name: string;
  steps: ProcessStep[];
}

export interface SwimlaneData {
  title: string;
  lanes: Swimlane[];
  connections: Connection[];
}

interface SwimlaneSVGProps {
  data: SwimlaneData;
}

// Dimensions with extra spacing to avoid arrow-shape overlap
const LANE_HEIGHT = 140;
const LANE_HEADER_WIDTH = 90;
const CELL_WIDTH = 210;
const SHAPE_WIDTH = 120;
const SHAPE_HEIGHT = 50;
const HEADER_HEIGHT = 40;
const DECISION_SIZE = 56;
const ARROW_GAP = 14; // min gap between arrow and shape edge

const SwimlaneSVG = forwardRef<SVGSVGElement, SwimlaneSVGProps>(
  ({ data }, ref) => {
    
    // Calculate dimensions and step numbers
    const { maxColumns, stepPositions, stepNumbers } = useMemo(() => {
      let maxX = 0;
      const positions: Record<string, { laneIndex: number; x: number }> = {};
      const numbers: Record<string, number> = {};
      
      // First pass: collect positions
      data.lanes.forEach((lane, laneIndex) => {
        lane.steps.forEach((step) => {
          maxX = Math.max(maxX, step.x);
          positions[step.id] = { laneIndex, x: step.x };
        });
      });
      
      // Second pass: assign sequential step numbers (skip start/end)
      let stepNum = 1;
      // Sort all steps by x position (left-to-right), then by lane index
      const allSteps = data.lanes.flatMap((lane, laneIndex) =>
        lane.steps.map(step => ({ ...step, laneIndex }))
      );
      allSteps.sort((a, b) => a.x - b.x || a.laneIndex - b.laneIndex);
      for (const step of allSteps) {
        if (step.type !== 'start' && step.type !== 'end') {
          numbers[step.id] = stepNum++;
        }
      }
      
      return { maxColumns: maxX + 1, stepPositions: positions, stepNumbers: numbers };
    }, [data]);

    const svgWidth = LANE_HEADER_WIDTH + (maxColumns * CELL_WIDTH) + 40;
    const svgHeight = HEADER_HEIGHT + (data.lanes.length * LANE_HEIGHT) + 60;

    // Get step center position
    const getStepPosition = (stepId: string) => {
      const pos = stepPositions[stepId];
      if (!pos) return null;
      
      const x = LANE_HEADER_WIDTH + (pos.x * CELL_WIDTH) + (CELL_WIDTH / 2);
      const y = HEADER_HEIGHT + (pos.laneIndex * LANE_HEIGHT) + (LANE_HEIGHT / 2);
      return { x, y };
    };

    // Helper to wrap text into multiple lines that fit within shape
    const wrapText = (text: string, maxChars: number, maxLines: number = 3): string[] => {
      const words = text.split(' ');
      const lines: string[] = [];
      let currentLine = '';
      
      words.forEach(word => {
        if ((currentLine + ' ' + word).trim().length <= maxChars) {
          currentLine = (currentLine + ' ' + word).trim();
        } else {
          if (currentLine) lines.push(currentLine);
          currentLine = word.length > maxChars ? word.substring(0, maxChars - 2) + '..' : word;
        }
      });
      if (currentLine) lines.push(currentLine);
      
      // Truncate if too many lines
      if (lines.length > maxLines) {
        const truncated = lines.slice(0, maxLines);
        truncated[maxLines - 1] = truncated[maxLines - 1].substring(0, maxChars - 2) + '..';
        return truncated;
      }
      
      return lines;
    };

    // Calculate font size based on text length to fit within shape
    const getFontSize = (text: string, shapeWidth: number, baseSize: number = 9): number => {
      const maxCharsPerLine = Math.floor(shapeWidth / (baseSize * 0.6));
      if (text.length <= maxCharsPerLine) return baseSize;
      if (text.length <= maxCharsPerLine * 1.5) return baseSize - 1;
      return baseSize - 2;
    };

    // Render step number badge (inside top-left of shape)
    const renderStepBadge = (cx: number, cy: number, num: number, halfW: number, halfH: number) => {
      const badgeX = cx - halfW + 10;
      const badgeY = cy - halfH + 10;
      return (
        <>
          <circle cx={badgeX} cy={badgeY} r={8} fill="#047857" stroke="white" strokeWidth="1.5" />
          <text x={badgeX} y={badgeY + 3} textAnchor="middle" fill="white" fontSize="7" fontFamily="Arial, sans-serif" fontWeight="700">
            {num}
          </text>
        </>
      );
    };

    // Render shape based on type
    const renderShape = (step: ProcessStep, cx: number, cy: number) => {
      const halfW = SHAPE_WIDTH / 2;
      const halfH = SHAPE_HEIGHT / 2;
      const num = stepNumbers[step.id];

      switch (step.type) {
        case 'start':
        case 'end':
          return (
            <g key={step.id}>
              <rect
                x={cx - halfW}
                y={cy - halfH}
                width={SHAPE_WIDTH}
                height={SHAPE_HEIGHT}
                rx={SHAPE_HEIGHT / 2}
                ry={SHAPE_HEIGHT / 2}
                fill="#047857"
                stroke="#065f46"
                strokeWidth="1.5"
              />
              <text x={cx} y={cy + 4} textAnchor="middle" fill="white" fontSize="11" fontFamily="Arial, sans-serif" fontWeight="600">
                {step.label}
              </text>
            </g>
          );
        
        case 'decision': {
          const halfD = DECISION_SIZE / 2;
          const decisionLines = wrapText(step.label, 9, 2);
          const decisionFontSize = getFontSize(step.label, DECISION_SIZE * 0.7, 8);
          return (
            <g key={step.id}>
              <polygon
                points={`${cx},${cy - halfD} ${cx + halfD},${cy} ${cx},${cy + halfD} ${cx - halfD},${cy}`}
                fill="#059669"
                stroke="#047857"
                strokeWidth="1.5"
              />
              {decisionLines.map((line, i) => (
                <text
                  key={i}
                  x={cx}
                  y={cy + 3 + (i - (decisionLines.length - 1) / 2) * (decisionFontSize + 2)}
                  textAnchor="middle"
                  fill="white"
                  fontSize={decisionFontSize}
                  fontFamily="Arial, sans-serif"
                  fontWeight="600"
                >
                  {line}
                </text>
              ))}
              {num && renderStepBadge(cx, cy, num, halfD, halfD)}
            </g>
          );
        }
        
        case 'document': {
          const docLines = wrapText(step.label, 14, 3);
          const docFontSize = getFontSize(step.label, SHAPE_WIDTH - 10, 8);
          return (
            <g key={step.id}>
              <path
                d={`M${cx - halfW},${cy - halfH} 
                   L${cx + halfW},${cy - halfH} 
                   L${cx + halfW},${cy + halfH - 6} 
                   Q${cx + halfW * 0.5},${cy + halfH + 3} ${cx},${cy + halfH - 6}
                   Q${cx - halfW * 0.5},${cy + halfH - 15} ${cx - halfW},${cy + halfH - 6}
                   Z`}
                fill="#059669"
                stroke="#047857"
                strokeWidth="1.5"
              />
              {docLines.map((line, i) => (
                <text
                  key={i}
                  x={cx}
                  y={cy - 4 + (i - (docLines.length - 1) / 2) * (docFontSize + 3)}
                  textAnchor="middle"
                  fill="white"
                  fontSize={docFontSize}
                  fontFamily="Arial, sans-serif"
                  fontWeight="500"
                >
                  {line}
                </text>
              ))}
              {num && renderStepBadge(cx, cy, num, halfW, halfH)}
            </g>
          );
        }

        case 'subprocess': {
          const subLines = wrapText(step.label, 14, 3);
          const subFontSize = getFontSize(step.label, SHAPE_WIDTH - 20, 8);
          return (
            <g key={step.id}>
              <rect
                x={cx - halfW}
                y={cy - halfH}
                width={SHAPE_WIDTH}
                height={SHAPE_HEIGHT}
                rx={3}
                ry={3}
                fill="#f3f4f6"
                stroke="#6b7280"
                strokeWidth="1.5"
              />
              <line x1={cx - halfW + 8} y1={cy - halfH} x2={cx - halfW + 8} y2={cy + halfH} stroke="#6b7280" strokeWidth="1" />
              <line x1={cx + halfW - 8} y1={cy - halfH} x2={cx + halfW - 8} y2={cy + halfH} stroke="#6b7280" strokeWidth="1" />
              {subLines.map((line, i) => (
                <text
                  key={i}
                  x={cx}
                  y={cy + 3 + (i - (subLines.length - 1) / 2) * (subFontSize + 3)}
                  textAnchor="middle"
                  fill="#374151"
                  fontSize={subFontSize}
                  fontFamily="Arial, sans-serif"
                  fontWeight="500"
                >
                  {line}
                </text>
              ))}
              {num && renderStepBadge(cx, cy, num, halfW, halfH)}
            </g>
          );
        }
        
        case 'process':
        default: {
          const processLines = wrapText(step.label, 15, 3);
          const processFontSize = getFontSize(step.label, SHAPE_WIDTH - 10, 9);
          return (
            <g key={step.id}>
              <rect
                x={cx - halfW}
                y={cy - halfH}
                width={SHAPE_WIDTH}
                height={SHAPE_HEIGHT}
                rx={4}
                ry={4}
                fill="white"
                stroke="#059669"
                strokeWidth="1.5"
              />
              {processLines.map((line, i) => (
                <text
                  key={i}
                  x={cx}
                  y={cy + 3 + (i - (processLines.length - 1) / 2) * (processFontSize + 3)}
                  textAnchor="middle"
                  fill="#1f2937"
                  fontSize={processFontSize}
                  fontFamily="Arial, sans-serif"
                  fontWeight="500"
                >
                  {line}
                </text>
              ))}
              {num && renderStepBadge(cx, cy, num, halfW, halfH)}
            </g>
          );
        }
      }
    };

    return (
      <svg
        ref={ref}
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        xmlns="http://www.w3.org/2000/svg"
        style={{ backgroundColor: 'white' }}
      >
        {/* Title Header */}
        <rect x="0" y="0" width={svgWidth} height={HEADER_HEIGHT} fill="#059669" />
        <text
          x={svgWidth / 2}
          y={HEADER_HEIGHT / 2 + 6}
          textAnchor="middle"
          fill="white"
          fontSize="18"
          fontFamily="Arial, sans-serif"
          fontWeight="bold"
        >
          {data.title || 'Process Flowchart'}
        </text>

        {/* Layer 1: Lane backgrounds and headers */}
        {data.lanes.map((lane, laneIndex) => {
          const laneY = HEADER_HEIGHT + (laneIndex * LANE_HEIGHT);
          return (
            <g key={`bg-${lane.name}`}>
              <rect x="0" y={laneY} width={LANE_HEADER_WIDTH} height={LANE_HEIGHT} fill="#059669" stroke="#047857" strokeWidth="1" />
              <text
                x={LANE_HEADER_WIDTH / 2}
                y={laneY + LANE_HEIGHT / 2}
                textAnchor="middle"
                fill="white"
                fontSize="11"
                fontFamily="Arial, sans-serif"
                fontWeight="600"
                transform={`rotate(-90, ${LANE_HEADER_WIDTH / 2}, ${laneY + LANE_HEIGHT / 2})`}
              >
                {lane.name}
              </text>
              <rect x={LANE_HEADER_WIDTH} y={laneY} width={svgWidth - LANE_HEADER_WIDTH} height={LANE_HEIGHT} fill="white" stroke="#d1d5db" strokeWidth="1" />
              {Array.from({ length: maxColumns }).map((_, colIndex) => (
                <line
                  key={colIndex}
                  x1={LANE_HEADER_WIDTH + (colIndex * CELL_WIDTH)}
                  y1={laneY}
                  x2={LANE_HEADER_WIDTH + (colIndex * CELL_WIDTH)}
                  y2={laneY + LANE_HEIGHT}
                  stroke="#e5e7eb"
                  strokeWidth="1"
                  strokeDasharray="4,4"
                />
              ))}
            </g>
          );
        })}

        {/* Layer 2: Arrows (rendered BEFORE shapes so shapes sit visually on top) */}
        {/* Arrow definitions */}
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#6b7280" />
          </marker>
          <marker id="arrowhead-green" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#16a34a" />
          </marker>
          <marker id="arrowhead-red" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#dc2626" />
          </marker>
        </defs>

        {/* Connection arrows — rendered BEFORE shapes so shapes sit on top */}
        {data.connections.map((conn, idx) => {
          const fromPos = getStepPosition(conn.from);
          const toPos = getStepPosition(conn.to);
          if (!fromPos || !toPos) return null;

          const dx = toPos.x - fromPos.x;
          const dy = toPos.y - fromPos.y;
          
          const fromStep = data.lanes.flatMap(l => l.steps).find(s => s.id === conn.from);
          const toStep = data.lanes.flatMap(l => l.steps).find(s => s.id === conn.to);
          const isFromDecision = fromStep?.type === 'decision';
          
          const fromHalfW = isFromDecision ? DECISION_SIZE / 2 : SHAPE_WIDTH / 2;
          const fromHalfH = isFromDecision ? DECISION_SIZE / 2 : SHAPE_HEIGHT / 2;
          const toHalfW = toStep?.type === 'decision' ? DECISION_SIZE / 2 : SHAPE_WIDTH / 2;
          const toHalfH = toStep?.type === 'decision' ? DECISION_SIZE / 2 : SHAPE_HEIGHT / 2;

          const isSameLane = Math.abs(dy) < LANE_HEIGHT / 2;
          const isSameColumn = Math.abs(dx) < CELL_WIDTH / 2;
          
          const isYes = conn.label?.toLowerCase() === 'yes';
          const isNo = conn.label?.toLowerCase() === 'no';

          let path = '';
          let labelX = 0;
          let labelY = 0;
          
          // GAP = clearance from shape edges when routing
          const GAP = ARROW_GAP;

          if (isFromDecision && isYes) {
            // ===== YES path: exits RIGHT tip of diamond =====
            const startX = fromPos.x + fromHalfW;
            const startY = fromPos.y;

            if (isSameLane && dx > 0) {
              // Same lane, target to the right → straight line
              path = `M ${startX} ${startY} L ${toPos.x - toHalfW - GAP} ${toPos.y}`;
            } else {
              // Different lane → elbow: right, then vertical, then horizontal
              const midX = fromPos.x + CELL_WIDTH / 2;
              path = `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${toPos.y} L ${toPos.x - toHalfW - GAP} ${toPos.y}`;
            }
            labelX = startX + 14;
            labelY = startY - 8;

          } else if (isFromDecision && isNo) {
            // ===== NO path: exits BOTTOM tip of diamond =====
            const startX = fromPos.x;
            const startY = fromPos.y + fromHalfH;

            if (isSameColumn) {
              // Same column → straight down
              path = `M ${startX} ${startY} L ${toPos.x} ${toPos.y - toHalfH - GAP}`;
            } else if (dx < 0) {
              // Target is to the LEFT (loopback) → down, left, then up to target
              const routeY = Math.max(
                startY + GAP + 10,
                HEADER_HEIGHT + Math.max(
                  stepPositions[conn.from]?.laneIndex ?? 0,
                  stepPositions[conn.to]?.laneIndex ?? 0
                ) * LANE_HEIGHT + LANE_HEIGHT - 8
              );
              path = `M ${startX} ${startY} L ${startX} ${routeY} L ${toPos.x} ${routeY} L ${toPos.x} ${toPos.y + toHalfH + GAP}`;
            } else {
              // Target is to the right → down, then right, then up/down to target
              const routeY = startY + GAP + 15;
              path = `M ${startX} ${startY} L ${startX} ${routeY} L ${toPos.x} ${routeY} L ${toPos.x} ${toPos.y - toHalfH - GAP}`;
            }
            labelX = startX + 14;
            labelY = startY + 14;

          } else if (isFromDecision) {
            // Decision without Yes/No label → default exit right
            const startX = fromPos.x + fromHalfW;
            const startY = fromPos.y;
            if (isSameLane && dx > 0) {
              path = `M ${startX} ${startY} L ${toPos.x - toHalfW - GAP} ${toPos.y}`;
            } else {
              const midX = fromPos.x + CELL_WIDTH / 2;
              path = `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${toPos.y} L ${toPos.x - toHalfW - GAP} ${toPos.y}`;
            }
            labelX = startX + 12;
            labelY = startY - 8;

          } else if (isSameLane && dx > 0) {
            // ===== Same lane, going RIGHT → straight =====
            path = `M ${fromPos.x + fromHalfW} ${fromPos.y} L ${toPos.x - toHalfW - GAP} ${toPos.y}`;
            labelX = (fromPos.x + fromHalfW + toPos.x - toHalfW) / 2;
            labelY = fromPos.y - 10;

          } else if (isSameLane && dx < 0) {
            // ===== Same lane, going LEFT (loopback) → route below =====
            const startX = fromPos.x - fromHalfW;
            const endX = toPos.x + toHalfW;
            const fromLaneIdx = stepPositions[conn.from]?.laneIndex ?? 0;
            const routeY = HEADER_HEIGHT + fromLaneIdx * LANE_HEIGHT + LANE_HEIGHT - 8;
            path = `M ${startX} ${fromPos.y} L ${startX - GAP} ${fromPos.y} L ${startX - GAP} ${routeY} L ${endX + GAP} ${routeY} L ${endX + GAP} ${toPos.y} L ${endX} ${toPos.y}`;
            labelX = (startX + endX) / 2;
            labelY = routeY + 12;

          } else if (isSameColumn && dy > 0) {
            // ===== Same column, going DOWN =====
            path = `M ${fromPos.x} ${fromPos.y + fromHalfH} L ${toPos.x} ${toPos.y - toHalfH - GAP}`;
            labelX = fromPos.x + 15;
            labelY = (fromPos.y + fromHalfH + toPos.y - toHalfH) / 2;

          } else if (isSameColumn && dy < 0) {
            // ===== Same column, going UP =====
            path = `M ${fromPos.x} ${fromPos.y - fromHalfH} L ${toPos.x} ${toPos.y + toHalfH + GAP}`;
            labelX = fromPos.x + 15;
            labelY = (fromPos.y - fromHalfH + toPos.y + toHalfH) / 2;

          } else if (dx > 0) {
            // ===== Different lane, going RIGHT → elbow connector =====
            // Exit right side, go horizontal to midpoint between columns, then vertical, then horizontal to target
            const startX = fromPos.x + fromHalfW;
            const midX = (fromPos.x + toPos.x) / 2;
            path = `M ${startX} ${fromPos.y} L ${midX} ${fromPos.y} L ${midX} ${toPos.y} L ${toPos.x - toHalfW - GAP} ${toPos.y}`;
            labelX = midX + 8;
            labelY = Math.min(fromPos.y, toPos.y) - 8;

          } else {
            // ===== Different lane, going LEFT (loopback across lanes) =====
            // Exit bottom, route below both shapes, then up to target
            const startY = fromPos.y + fromHalfH;
            const fromLaneIdx = stepPositions[conn.from]?.laneIndex ?? 0;
            const toLaneIdx = stepPositions[conn.to]?.laneIndex ?? 0;
            const maxLaneIdx = Math.max(fromLaneIdx, toLaneIdx);
            const routeY = HEADER_HEIGHT + (maxLaneIdx + 1) * LANE_HEIGHT - 8;
            path = `M ${fromPos.x} ${startY} L ${fromPos.x} ${routeY} L ${toPos.x} ${routeY} L ${toPos.x} ${toPos.y + toHalfH + GAP}`;
            labelX = (fromPos.x + toPos.x) / 2;
            labelY = routeY - 8;
          }

          // Arrow & label styling
          const strokeColor = isYes ? '#16a34a' : isNo ? '#dc2626' : '#6b7280';
          const markerEnd = isYes ? 'url(#arrowhead-green)' : isNo ? 'url(#arrowhead-red)' : 'url(#arrowhead)';
          const labelBgColor = isYes ? '#dcfce7' : isNo ? '#fee2e2' : 'white';
          const labelBorderColor = isYes ? '#16a34a' : isNo ? '#dc2626' : '#d1d5db';
          const labelTextColor = isYes ? '#15803d' : isNo ? '#dc2626' : '#374151';

          return (
            <g key={idx}>
              <path
                d={path}
                fill="none"
                stroke={strokeColor}
                strokeWidth="1.5"
                markerEnd={markerEnd}
              />
              {conn.label && (
                <>
                  <rect
                    x={labelX - 16}
                    y={labelY - 10}
                    width="32"
                    height="16"
                    fill={labelBgColor}
                    stroke={labelBorderColor}
                    strokeWidth={1}
                    rx="3"
                  />
                  <text
                    x={labelX}
                    y={labelY + 2}
                    textAnchor="middle"
                    fill={labelTextColor}
                    fontSize="10"
                    fontFamily="Arial, sans-serif"
                    fontWeight="700"
                  >
                    {conn.label}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* Layer 3: Shapes (rendered AFTER arrows so they sit on top) */}
        {data.lanes.map((lane) => (
          <g key={`shapes-${lane.name}`}>
            {lane.steps.map((step) => {
              const pos = getStepPosition(step.id);
              if (!pos) return null;
              return renderShape(step, pos.x, pos.y);
            })}
          </g>
        ))}

        {/* Legend */}
        <g transform={`translate(10, ${svgHeight - 30})`}>
          <circle cx="10" cy="10" r="8" fill="#047857" />
          <text x="25" y="14" fontSize="10" fill="#6b7280" fontFamily="Arial">Start/End</text>
          
          <rect x="80" y="2" width="16" height="16" fill="white" stroke="#059669" strokeWidth="2" rx="2" />
          <text x="102" y="14" fontSize="10" fill="#6b7280" fontFamily="Arial">Process</text>
          
          <polygon points="175,10 183,2 191,10 183,18" fill="white" stroke="#059669" strokeWidth="2" />
          <text x="198" y="14" fontSize="10" fill="#6b7280" fontFamily="Arial">Decision</text>
        </g>
      </svg>
    );
  }
);

SwimlaneSVG.displayName = 'SwimlaneSVG';

export default SwimlaneSVG;
