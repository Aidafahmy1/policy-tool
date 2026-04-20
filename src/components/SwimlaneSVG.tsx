'use client';

import { forwardRef, useMemo, useState, useCallback, useRef, useEffect } from 'react';

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
  onLayoutChange?: (offsets: Record<string, {dx: number, dy: number}>) => void;
}

// Dimensions with extra spacing to avoid arrow-shape overlap
const LANE_HEIGHT = 160;
const LANE_HEADER_WIDTH = 90;
const CELL_WIDTH = 240;
const SHAPE_WIDTH = 160;
const SHAPE_HEIGHT = 64;
const HEADER_HEIGHT = 40;
const DECISION_SIZE = 64;
const ARROW_GAP = 14; // min gap between arrow and shape edge

const SwimlaneSVG = forwardRef<SVGSVGElement, SwimlaneSVGProps>(
  ({ data, onLayoutChange }, ref) => {
    const svgRef = useRef<SVGSVGElement | null>(null);

    // Combine forwarded ref with internal ref
    const combinedRef = useCallback((node: SVGSVGElement | null) => {
      svgRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.MutableRefObject<SVGSVGElement | null>).current = node;
    }, [ref]);

    // Interactive state: shape position offsets from dragging
    const [posOffsets, setPosOffsets] = useState<Record<string, {dx: number, dy: number}>>({});
    // Arrow waypoint overrides (full path points per connection)
    const [arrowOverrides, setArrowOverrides] = useState<Record<string, {x: number, y: number}[]>>({});
    // Label text overrides from inline editing
    const [labelOverrides, setLabelOverrides] = useState<Record<string, string>>({});
    const [editingStepId, setEditingStepId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const editInputRef = useRef<HTMLTextAreaElement | null>(null);
    const [selectedArrow, setSelectedArrow] = useState<string | null>(null);
    const [deletedConnections, setDeletedConnections] = useState<Set<string>>(new Set());
    // Extra shapes and connections added by user
    const [extraShapes, setExtraShapes] = useState<Array<{
      id: string; label: string;
      type: 'process' | 'decision' | 'document' | 'subprocess';
      x: number; y: number;
    }>>([]);
    const [extraConnections, setExtraConnections] = useState<Array<{
      from: string; to: string; label?: string;
    }>>([]);
    const [addMode, setAddMode] = useState<'process' | 'decision' | 'document' | 'subprocess' | 'arrow' | null>(null);
    const [arrowStart, setArrowStart] = useState<string | null>(null);
    const extraIdCounter = useRef(0);
    const [dragInfo, setDragInfo] = useState<{
      type: 'shape';
      stepId: string;
      startMouse: {x: number, y: number};
      startOffset: {dx: number, dy: number};
    } | {
      type: 'waypoint';
      connKey: string;
      wpIdx: number;
      startMouse: {x: number, y: number};
      startPoint: {x: number, y: number};
    } | null>(null);

    // Reset offsets when flowchart data changes
    useEffect(() => {
      setPosOffsets({});
      setArrowOverrides({});
      setLabelOverrides({});
      setEditingStepId(null);
      setSelectedArrow(null);
      setDeletedConnections(new Set());
      setExtraShapes([]);
      setExtraConnections([]);
      setAddMode(null);
      setArrowStart(null);
    }, [data]);

    // Convert screen coordinates to SVG coordinates
    const screenToSVG = useCallback((clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return { x: clientX, y: clientY };
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: clientX, y: clientY };
      const svgPt = pt.matrixTransform(ctm.inverse());
      return { x: svgPt.x, y: svgPt.y };
    }, []);

    // Parse SVG path "M x y L x y ..." into coordinate points
    const parsePath = (d: string): {x: number, y: number}[] => {
      const points: {x: number, y: number}[] = [];
      const re = /[ML]\s*([\d.e+-]+)\s+([\d.e+-]+)/g;
      let m;
      while ((m = re.exec(d)) !== null) {
        points.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
      }
      return points;
    };

    // Build SVG path string from coordinate points
    const buildPath = (points: {x: number, y: number}[]): string => {
      if (points.length === 0) return '';
      return `M ${points[0].x} ${points[0].y}` + points.slice(1).map(p => ` L ${p.x} ${p.y}`).join('');
    };

    // Double-click on shape to enter inline text edit mode
    const handleShapeDoubleClick = useCallback((e: React.MouseEvent, stepId: string, currentLabel: string) => {
      e.stopPropagation();
      e.preventDefault();
      setEditingStepId(stepId);
      setEditText(currentLabel);
      // Auto-focus after render
      setTimeout(() => editInputRef.current?.focus(), 50);
    }, []);

    // Save edited label
    const handleEditSave = useCallback(() => {
      if (editingStepId && editText.trim()) {
        setLabelOverrides(prev => ({ ...prev, [editingStepId]: editText.trim() }));
      }
      setEditingStepId(null);
    }, [editingStepId, editText]);

    // Pointer-down on a shape starts shape drag (skip if editing)
    const handleShapePointerDown = useCallback((e: React.PointerEvent, stepId: string) => {
      if (editingStepId) return; // don't drag while editing
      e.stopPropagation();
      setSelectedArrow(null);
      // Arrow creation mode: first click = source, second click = target
      if (addMode === 'arrow') {
        if (!arrowStart) {
          setArrowStart(stepId);
        } else if (arrowStart !== stepId) {
          setExtraConnections(prev => [...prev, { from: arrowStart, to: stepId }]);
          setArrowStart(null);
        }
        return;
      }
      const svgPt = screenToSVG(e.clientX, e.clientY);
      const offset = posOffsets[stepId] || { dx: 0, dy: 0 };
      setDragInfo({ type: 'shape', stepId, startMouse: svgPt, startOffset: { ...offset } });
    }, [screenToSVG, posOffsets, editingStepId, addMode, arrowStart]);

    // Pointer-down on an arrow waypoint starts waypoint drag
    const handleWaypointPointerDown = useCallback((e: React.PointerEvent, connKey: string, wpIdx: number, currentPoints: {x: number, y: number}[]) => {
      e.stopPropagation();
      const svgPt = screenToSVG(e.clientX, e.clientY);
      const point = currentPoints[wpIdx];
      // Initialize overrides from current path if not yet customized
      if (!arrowOverrides[connKey]) {
        setArrowOverrides(prev => ({ ...prev, [connKey]: currentPoints.map(p => ({ ...p })) }));
      }
      setDragInfo({ type: 'waypoint', connKey, wpIdx, startMouse: svgPt, startPoint: { ...point } });
    }, [screenToSVG, arrowOverrides]);

    // Window-level pointer events for reliable drag tracking (works even if cursor leaves SVG)
    useEffect(() => {
      if (!dragInfo) return;
      const handleMove = (e: PointerEvent) => {
        e.preventDefault();
        const svgPt = screenToSVG(e.clientX, e.clientY);
        if (dragInfo.type === 'shape') {
          setPosOffsets(prev => ({
            ...prev,
            [dragInfo.stepId]: {
              dx: dragInfo.startOffset.dx + (svgPt.x - dragInfo.startMouse.x),
              dy: dragInfo.startOffset.dy + (svgPt.y - dragInfo.startMouse.y),
            }
          }));
        } else if (dragInfo.type === 'waypoint') {
          setArrowOverrides(prev => {
            const points = [...(prev[dragInfo.connKey] || [])];
            points[dragInfo.wpIdx] = {
              x: dragInfo.startPoint.x + (svgPt.x - dragInfo.startMouse.x),
              y: dragInfo.startPoint.y + (svgPt.y - dragInfo.startMouse.y),
            };
            return { ...prev, [dragInfo.connKey]: points };
          });
        }
      };
      const handleUp = () => {
        setDragInfo(null);
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      return () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };
    }, [dragInfo, screenToSVG]);

    const handleReset = useCallback(() => {
      setPosOffsets({});
      setArrowOverrides({});
      setLabelOverrides({});
      setEditingStepId(null);
      setSelectedArrow(null);
      setDeletedConnections(new Set());
      setExtraShapes([]);
      setExtraConnections([]);
      setAddMode(null);
      setArrowStart(null);
      onLayoutChange?.({});
    }, [onLayoutChange]);

    // Keyboard listener for arrow deletion (Delete/Backspace) and deselection (Escape)
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (selectedArrow && (e.key === 'Delete' || e.key === 'Backspace') && !editingStepId) {
          e.preventDefault();
          setDeletedConnections(prev => {
            const next = new Set(prev);
            next.add(selectedArrow);
            return next;
          });
          setArrowOverrides(prev => {
            const next = { ...prev };
            delete next[selectedArrow];
            return next;
          });
          setSelectedArrow(null);
        }
        if (e.key === 'Escape') {
          setSelectedArrow(null);
          setAddMode(null);
          setArrowStart(null);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedArrow, editingStepId]);

    // Click on arrow path to select/deselect it
    const handleArrowClick = useCallback((e: React.PointerEvent, connKey: string) => {
      e.stopPropagation();
      setSelectedArrow(prev => prev === connKey ? null : connKey);
    }, []);

    // Click on a path segment to insert a new waypoint and start dragging it
    const handleSegmentClick = useCallback((e: React.PointerEvent, connKey: string, segmentIdx: number, currentPoints: {x: number, y: number}[]) => {
      e.stopPropagation();
      const svgPt = screenToSVG(e.clientX, e.clientY);
      const points = arrowOverrides[connKey]
        ? [...arrowOverrides[connKey]]
        : currentPoints.map(p => ({ ...p }));
      // Insert new point after segmentIdx
      points.splice(segmentIdx + 1, 0, { x: svgPt.x, y: svgPt.y });
      setArrowOverrides(prev => ({ ...prev, [connKey]: points }));
      // Start dragging the new point immediately
      setDragInfo({ type: 'waypoint', connKey, wpIdx: segmentIdx + 1, startMouse: svgPt, startPoint: { x: svgPt.x, y: svgPt.y } });
      setSelectedArrow(connKey);
    }, [screenToSVG, arrowOverrides]);

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
      
      // Second pass: assign sequential step numbers following the FLOW (BFS from start)
      let stepNum = 1;
      const allSteps = data.lanes.flatMap((lane, laneIndex) =>
        lane.steps.map(step => ({ ...step, laneIndex }))
      );

      // Build adjacency list from connections
      const adj: Record<string, string[]> = {};
      for (const conn of data.connections) {
        if (!adj[conn.from]) adj[conn.from] = [];
        adj[conn.from].push(conn.to);
      }

      // Find start node(s)
      const startNodes = allSteps.filter(s => s.type === 'start').map(s => s.id);

      // BFS traversal following the process flow
      const visited = new Set<string>();
      const queue: string[] = [...startNodes];
      startNodes.forEach(id => visited.add(id));

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        const currentStep = allSteps.find(s => s.id === currentId);
        if (currentStep && currentStep.type !== 'start' && currentStep.type !== 'end') {
          numbers[currentId] = stepNum++;
        }
        // Get neighbors sorted by: x position first, then lane index (for consistent ordering at branches)
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

      // Fallback: number any remaining steps not reachable from start (shouldn't happen normally)
      for (const step of allSteps) {
        if (step.type !== 'start' && step.type !== 'end' && !numbers[step.id]) {
          numbers[step.id] = stepNum++;
        }
      }
      
      return { maxColumns: maxX + 1, stepPositions: positions, stepNumbers: numbers };
    }, [data]);

    const svgWidth = LANE_HEADER_WIDTH + (maxColumns * CELL_WIDTH) + 40;
    const svgHeight = HEADER_HEIGHT + (data.lanes.length * LANE_HEIGHT) + 60;

    // Get step center position (includes drag offset) — works for both grid steps and extra shapes
    const getStepPosition = (stepId: string) => {
      const pos = stepPositions[stepId];
      if (pos) {
        const offset = posOffsets[stepId] || { dx: 0, dy: 0 };
        const x = LANE_HEADER_WIDTH + (pos.x * CELL_WIDTH) + (CELL_WIDTH / 2) + offset.dx;
        const y = HEADER_HEIGHT + (pos.laneIndex * LANE_HEIGHT) + (LANE_HEIGHT / 2) + offset.dy;
        return { x, y };
      }
      const extra = extraShapes.find(s => s.id === stepId);
      if (extra) {
        const offset = posOffsets[stepId] || { dx: 0, dy: 0 };
        return { x: extra.x + offset.dx, y: extra.y + offset.dy };
      }
      return null;
    };

    // Helper to wrap text into multiple lines that fit within shape — NO truncation, show full text
    const wrapText = (text: string, maxChars: number): string[] => {
      const words = text.split(' ');
      const lines: string[] = [];
      let currentLine = '';
      
      words.forEach(word => {
        if ((currentLine + ' ' + word).trim().length <= maxChars) {
          currentLine = (currentLine + ' ' + word).trim();
        } else {
          if (currentLine) lines.push(currentLine);
          currentLine = word;
        }
      });
      if (currentLine) lines.push(currentLine);
      
      return lines;
    };

    // Calculate font size based on text length to fit within shape
    const getFontSize = (text: string, shapeWidth: number, baseSize: number = 9): number => {
      const maxCharsPerLine = Math.floor(shapeWidth / (baseSize * 0.6));
      if (text.length <= maxCharsPerLine) return baseSize;
      if (text.length <= maxCharsPerLine * 2) return baseSize - 1;
      if (text.length <= maxCharsPerLine * 3) return Math.max(baseSize - 2, 6);
      return Math.max(baseSize - 3, 5.5);
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
      const label = labelOverrides[step.id] || step.label;

      switch (step.type) {
        case 'start':
        case 'end':
          return (
            <g>
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
                {label}
              </text>
            </g>
          );
        
        case 'decision': {
          const halfD = DECISION_SIZE / 2;
          const decisionLines = wrapText(label, 12);
          const decisionFontSize = getFontSize(label, DECISION_SIZE * 0.8, 8);
          return (
            <g>
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
          const docLines = wrapText(label, 20);
          const docFontSize = getFontSize(label, SHAPE_WIDTH - 10, 8);
          return (
            <g>
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
          const subLines = wrapText(label, 18);
          const subFontSize = getFontSize(label, SHAPE_WIDTH - 20, 8);
          return (
            <g>
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
          const processLines = wrapText(label, 22);
          const processFontSize = getFontSize(label, SHAPE_WIDTH - 10, 9);
          return (
            <g>
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
      <div>
        {/* HTML Toolbar — always visible above the diagram */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px',
          background: '#1e293b', borderRadius: '8px 8px 0 0', flexWrap: 'wrap',
        }}>
          <span style={{ color: 'white', fontSize: '13px', fontWeight: 700, marginRight: '2px' }}>Add:</span>
          {([
            { key: 'process' as const, label: '+ Process' },
            { key: 'decision' as const, label: '+ Decision' },
            { key: 'document' as const, label: '+ Document' },
            { key: 'subprocess' as const, label: '+ Subprocess' },
            { key: 'arrow' as const, label: '→ Arrow' },
          ]).map((m) => {
            const active = addMode === m.key;
            const isArr = m.key === 'arrow';
            return (
              <button key={m.key} onClick={() => { setAddMode(active ? null : m.key); setArrowStart(null); }}
                style={{
                  padding: '5px 14px', borderRadius: '6px', cursor: 'pointer',
                  border: active ? '1.5px solid white' : '1.5px solid rgba(255,255,255,0.35)',
                  background: active ? (isArr ? '#3b82f6' : '#059669') : 'rgba(255,255,255,0.12)',
                  color: 'white', fontSize: '12px', fontWeight: 600,
                  transition: 'all 0.15s ease',
                }}>
                {m.label}
              </button>
            );
          })}
          {addMode && (
            <button onClick={() => { setAddMode(null); setArrowStart(null); }}
              style={{
                padding: '5px 10px', borderRadius: '6px', background: '#ef4444',
                color: 'white', fontSize: '14px', fontWeight: 700, cursor: 'pointer',
                border: '1.5px solid rgba(255,255,255,0.35)',
              }}>
              ✕
            </button>
          )}
          {addMode && (
            <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '12px', marginLeft: '6px' }}>
              {addMode === 'arrow'
                ? (arrowStart ? '→ Now click the target shape' : '→ Click the source shape')
                : `Click anywhere on the diagram to place`}
            </span>
          )}
        </div>
      <svg
        ref={combinedRef}
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        xmlns="http://www.w3.org/2000/svg"
        style={{ backgroundColor: 'white', touchAction: 'none', userSelect: 'none', cursor: addMode ? 'crosshair' : dragInfo ? 'grabbing' : 'default' }}
        onClick={(e) => {
          setSelectedArrow(null);
          if (addMode && addMode !== 'arrow') {
            const svgPt = screenToSVG(e.clientX, e.clientY);
            const newId = `extra-${++extraIdCounter.current}`;
            setExtraShapes(prev => [...prev, {
              id: newId,
              label: addMode === 'decision' ? 'Decision?' : addMode === 'document' ? 'Document' : addMode === 'subprocess' ? 'Subprocess' : 'New Step',
              type: addMode, x: svgPt.x, y: svgPt.y,
            }]);
            setAddMode(null);
          }
          if (addMode === 'arrow') { setArrowStart(null); }
        }}
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
            <g key={`bg-${laneIndex}`}>
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
              <rect x={LANE_HEADER_WIDTH} y={laneY} width={svgWidth - LANE_HEADER_WIDTH} height={LANE_HEIGHT} fill="white" stroke="#e5e7eb" strokeWidth="0.5" />
              {Array.from({ length: maxColumns }).map((_, colIndex) => (
                <line
                  key={colIndex}
                  x1={LANE_HEADER_WIDTH + (colIndex * CELL_WIDTH)}
                  y1={laneY}
                  x2={LANE_HEADER_WIDTH + (colIndex * CELL_WIDTH)}
                  y2={laneY + LANE_HEIGHT}
                  stroke="#f0f0f0"
                  strokeWidth="0.5"
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
          const connKey = `${conn.from}->${conn.to}`;
          if (deletedConnections.has(connKey)) return null;

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

          // Use manual arrow overrides if available
          const overridePoints = arrowOverrides[connKey];
          const finalPath = overridePoints ? buildPath(overridePoints) : path;
          const pathPoints = overridePoints || parsePath(path);

          // Styling
          const isSelected = selectedArrow === connKey;
          const strokeColor = isYes ? '#16a34a' : isNo ? '#dc2626' : '#6b7280';
          const markerEnd = isYes ? 'url(#arrowhead-green)' : isNo ? 'url(#arrowhead-red)' : 'url(#arrowhead)';
          const labelBgColor = isYes ? '#dcfce7' : isNo ? '#fee2e2' : 'white';
          const labelBorderColor = isYes ? '#16a34a' : isNo ? '#dc2626' : '#d1d5db';
          const labelTextColor = isYes ? '#15803d' : isNo ? '#dc2626' : '#374151';
          const midIdx = Math.floor(pathPoints.length / 2);
          const arrowMidPt = pathPoints[midIdx] || pathPoints[0];

          return (
            <g key={idx}>
              {/* White halo for visual separation from grid lines */}
              <path d={finalPath} fill="none" stroke="white" strokeWidth="5" />
              {/* Selection highlight */}
              {isSelected && (
                <path d={finalPath} fill="none" stroke="#3b82f6" strokeWidth="5" strokeOpacity="0.3" />
              )}
              {/* The actual arrow */}
              <path
                d={finalPath}
                fill="none"
                stroke={strokeColor}
                strokeWidth={isSelected ? "2.5" : "1.5"}
                markerEnd={markerEnd}
              />
              {/* Wide transparent hitbox for clicking/selecting arrows */}
              <path
                d={finalPath}
                fill="none"
                stroke="transparent"
                strokeWidth="14"
                style={{ cursor: 'pointer' }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (!isSelected) {
                    setSelectedArrow(connKey);
                  } else {
                    // Find closest segment and add a new waypoint there
                    const svgPt = screenToSVG(e.clientX, e.clientY);
                    let bestSegIdx = 0;
                    let bestDist = Infinity;
                    for (let si = 0; si < pathPoints.length - 1; si++) {
                      const a = pathPoints[si];
                      const b = pathPoints[si + 1];
                      const sdx = b.x - a.x;
                      const sdy = b.y - a.y;
                      const lenSq = sdx * sdx + sdy * sdy;
                      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((svgPt.x - a.x) * sdx + (svgPt.y - a.y) * sdy) / lenSq));
                      const projX = a.x + t * sdx;
                      const projY = a.y + t * sdy;
                      const dist = Math.sqrt((svgPt.x - projX) ** 2 + (svgPt.y - projY) ** 2);
                      if (dist < bestDist) {
                        bestDist = dist;
                        bestSegIdx = si;
                      }
                    }
                    handleSegmentClick(e, connKey, bestSegIdx, pathPoints);
                  }
                }}
              />
              {/* Label */}
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
              {/* Waypoint handles at ALL bend points */}
              {pathPoints.length > 2 && pathPoints.slice(1, -1).map((pt, i) => (
                <circle
                  key={`wp-${connKey}-${i}`}
                  data-no-export="true"
                  cx={pt.x}
                  cy={pt.y}
                  r={isSelected ? 6 : 4}
                  fill={isSelected ? '#3b82f6' : 'white'}
                  stroke={isSelected ? 'white' : '#3b82f6'}
                  strokeWidth={1.5}
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    handleWaypointPointerDown(e, connKey, i + 1, pathPoints);
                  }}
                />
              ))}
              {/* Midpoint '+' handles to add new waypoints when selected */}
              {isSelected && pathPoints.length >= 2 && pathPoints.slice(0, -1).map((pt, i) => {
                const next = pathPoints[i + 1];
                const mx = (pt.x + next.x) / 2;
                const my = (pt.y + next.y) / 2;
                const tooClose = pathPoints.some(p => Math.abs(p.x - mx) < 15 && Math.abs(p.y - my) < 15);
                if (tooClose) return null;
                return (
                  <g
                    key={`mid-${connKey}-${i}`}
                    data-no-export="true"
                    style={{ cursor: 'crosshair' }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      handleSegmentClick(e, connKey, i, pathPoints);
                    }}
                  >
                    <circle cx={mx} cy={my} r={6} fill="#dbeafe" stroke="#3b82f6" strokeWidth={1} strokeDasharray="2,2" />
                    <text x={mx} y={my + 3.5} textAnchor="middle" fill="#3b82f6" fontSize="10" fontWeight="bold">+</text>
                  </g>
                );
              })}
              {/* Delete button when arrow is selected */}
              {isSelected && (
                <g
                  data-no-export="true"
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeletedConnections(prev => {
                      const next = new Set(prev);
                      next.add(connKey);
                      return next;
                    });
                    setSelectedArrow(null);
                  }}
                >
                  <circle cx={arrowMidPt.x} cy={arrowMidPt.y - 18} r={9} fill="#ef4444" stroke="white" strokeWidth="1.5" />
                  <text x={arrowMidPt.x} y={arrowMidPt.y - 14} textAnchor="middle" fill="white" fontSize="12" fontFamily="Arial" fontWeight="bold">×</text>
                </g>
              )}
            </g>
          );
        })}

        {/* Extra connections added by user */}
        {extraConnections.map((conn, idx) => {
          const connKey = `extra-${conn.from}->${conn.to}`;
          if (deletedConnections.has(connKey)) return null;
          const fromPos = getStepPosition(conn.from);
          const toPos = getStepPosition(conn.to);
          if (!fromPos || !toPos) return null;
          const overridePoints = arrowOverrides[connKey];
          let path: string;
          if (overridePoints) {
            path = buildPath(overridePoints);
          } else {
            const dx = toPos.x - fromPos.x;
            const dy = toPos.y - fromPos.y;
            if (Math.abs(dy) < 20 && dx !== 0) {
              path = `M ${fromPos.x} ${fromPos.y} L ${toPos.x} ${toPos.y}`;
            } else if (Math.abs(dx) < 20 && dy !== 0) {
              path = `M ${fromPos.x} ${fromPos.y} L ${toPos.x} ${toPos.y}`;
            } else {
              const midX = (fromPos.x + toPos.x) / 2;
              path = `M ${fromPos.x} ${fromPos.y} L ${midX} ${fromPos.y} L ${midX} ${toPos.y} L ${toPos.x} ${toPos.y}`;
            }
          }
          const pathPoints = overridePoints || parsePath(path);
          const isSelected = selectedArrow === connKey;
          const midPt = pathPoints[Math.floor(pathPoints.length / 2)] || pathPoints[0];
          return (
            <g key={`ec-${idx}`}>
              <path d={path} fill="none" stroke="white" strokeWidth="5" />
              {isSelected && <path d={path} fill="none" stroke="#3b82f6" strokeWidth="5" strokeOpacity="0.3" />}
              <path d={path} fill="none" stroke="#6b7280" strokeWidth={isSelected ? "2.5" : "1.5"} markerEnd="url(#arrowhead)" />
              <path d={path} fill="none" stroke="transparent" strokeWidth="14" style={{ cursor: 'pointer' }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (!isSelected) { setSelectedArrow(connKey); }
                  else {
                    const svgPt = screenToSVG(e.clientX, e.clientY);
                    let best = 0, bestD = Infinity;
                    for (let i = 0; i < pathPoints.length - 1; i++) {
                      const a = pathPoints[i], b = pathPoints[i + 1];
                      const sdx = b.x - a.x, sdy = b.y - a.y, l2 = sdx * sdx + sdy * sdy;
                      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((svgPt.x - a.x) * sdx + (svgPt.y - a.y) * sdy) / l2));
                      const d = Math.hypot(svgPt.x - (a.x + t * sdx), svgPt.y - (a.y + t * sdy));
                      if (d < bestD) { bestD = d; best = i; }
                    }
                    handleSegmentClick(e, connKey, best, pathPoints);
                  }
                }}
              />
              {pathPoints.length > 2 && pathPoints.slice(1, -1).map((pt, i) => (
                <circle key={`ewp-${idx}-${i}`} data-no-export="true" cx={pt.x} cy={pt.y}
                  r={isSelected ? 6 : 4} fill={isSelected ? '#3b82f6' : 'white'} stroke={isSelected ? 'white' : '#3b82f6'} strokeWidth={1.5}
                  style={{ cursor: 'grab' }} onPointerDown={(e) => { e.stopPropagation(); handleWaypointPointerDown(e, connKey, i + 1, pathPoints); }}
                />
              ))}
              {isSelected && (
                <g data-no-export="true" style={{ cursor: 'pointer' }} onClick={(e) => {
                  e.stopPropagation();
                  setDeletedConnections(prev => { const n = new Set(prev); n.add(connKey); return n; });
                  setSelectedArrow(null);
                }}>
                  <circle cx={midPt.x} cy={midPt.y - 18} r={9} fill="#ef4444" stroke="white" strokeWidth="1.5" />
                  <text x={midPt.x} y={midPt.y - 14} textAnchor="middle" fill="white" fontSize="12" fontFamily="Arial" fontWeight="bold">×</text>
                </g>
              )}
            </g>
          );
        })}

        {/* Layer 3: Shapes (rendered AFTER arrows so they sit on top) — draggable + editable */}
        {data.lanes.map((lane, laneIdx) => (
          <g key={`shapes-${laneIdx}`}>
            {lane.steps.map((step, stepIdx) => {
              const pos = getStepPosition(step.id);
              if (!pos) return null;
              const isDecision = step.type === 'decision';
              const hw = isDecision ? DECISION_SIZE / 2 : SHAPE_WIDTH / 2;
              const hh = isDecision ? DECISION_SIZE / 2 : SHAPE_HEIGHT / 2;
              const currentLabel = labelOverrides[step.id] || step.label;
              const isEditing = editingStepId === step.id;
              return (
                <g
                  key={`drag-${laneIdx}-${stepIdx}`}
                  style={{ cursor: isEditing ? 'text' : (dragInfo?.type === 'shape' && dragInfo.stepId === step.id) ? 'grabbing' : 'grab' }}
                  onPointerDown={(e) => handleShapePointerDown(e, step.id)}
                  onDoubleClick={(e) => handleShapeDoubleClick(e, step.id, currentLabel)}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Transparent hitbox for reliable pointer event detection */}
                  <rect
                    x={pos.x - hw - 4}
                    y={pos.y - hh - 4}
                    width={(hw + 4) * 2}
                    height={(hh + 4) * 2}
                    fill="transparent"
                    stroke="none"
                  />
                  {renderShape(step, pos.x, pos.y)}
                  {/* Inline text editing overlay */}
                  {isEditing && (
                    <foreignObject
                      x={pos.x - hw + 2}
                      y={pos.y - hh + 2}
                      width={hw * 2 - 4}
                      height={hh * 2 - 4}
                    >
                      <textarea
                        ref={editInputRef}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onBlur={handleEditSave}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditSave(); }
                          if (e.key === 'Escape') { setEditingStepId(null); }
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        style={{
                          width: '100%',
                          height: '100%',
                          border: '2px solid #3b82f6',
                          borderRadius: '4px',
                          background: 'white',
                          color: '#1f2937',
                          fontSize: '10px',
                          fontFamily: 'Arial, sans-serif',
                          textAlign: 'center',
                          resize: 'none',
                          padding: '2px 4px',
                          outline: 'none',
                          overflow: 'hidden',
                        }}
                      />
                    </foreignObject>
                  )}
                </g>
              );
            })}
          </g>
        ))}

        {/* Extra shapes added by user */}
        {extraShapes.map((shape, idx) => {
          const pos = getStepPosition(shape.id);
          if (!pos) return null;
          const isDecision = shape.type === 'decision';
          const hw = isDecision ? DECISION_SIZE / 2 : SHAPE_WIDTH / 2;
          const hh = isDecision ? DECISION_SIZE / 2 : SHAPE_HEIGHT / 2;
          const currentLabel = labelOverrides[shape.id] || shape.label;
          const isEditing = editingStepId === shape.id;
          return (
            <g key={`extra-shape-${idx}`}
              style={{ cursor: addMode === 'arrow' ? 'crosshair' : isEditing ? 'text' : (dragInfo?.type === 'shape' && dragInfo.stepId === shape.id) ? 'grabbing' : 'grab' }}
              onPointerDown={(e) => handleShapePointerDown(e, shape.id)}
              onDoubleClick={(e) => handleShapeDoubleClick(e, shape.id, currentLabel)}
              onClick={(e) => e.stopPropagation()}
            >
              <rect x={pos.x - hw - 4} y={pos.y - hh - 4} width={(hw + 4) * 2} height={(hh + 4) * 2} fill="transparent" stroke="none" />
              {renderShape({ id: shape.id, label: shape.label, type: shape.type, x: 0 }, pos.x, pos.y)}
              {isEditing && (
                <foreignObject x={pos.x - hw + 2} y={pos.y - hh + 2} width={hw * 2 - 4} height={hh * 2 - 4}>
                  <textarea ref={editInputRef} value={editText}
                    onChange={(e) => setEditText(e.target.value)} onBlur={handleEditSave}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditSave(); }
                      if (e.key === 'Escape') { setEditingStepId(null); }
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{ width: '100%', height: '100%', border: '2px solid #3b82f6', borderRadius: '4px',
                      background: 'white', color: '#1f2937', fontSize: '10px', fontFamily: 'Arial, sans-serif',
                      textAlign: 'center', resize: 'none', padding: '2px 4px', outline: 'none', overflow: 'hidden' }}
                  />
                </foreignObject>
              )}
            </g>
          );
        })}

        {/* Arrow-start highlight: dashed blue border on selected source shape */}
        {arrowStart && (() => {
          const pos = getStepPosition(arrowStart);
          if (!pos) return null;
          const step = [...data.lanes.flatMap(l => l.steps), ...extraShapes].find(s => s.id === arrowStart);
          const isD = step?.type === 'decision';
          const hw = isD ? DECISION_SIZE / 2 : SHAPE_WIDTH / 2;
          const hh = isD ? DECISION_SIZE / 2 : SHAPE_HEIGHT / 2;
          return (
            <rect data-no-export="true" x={pos.x - hw - 6} y={pos.y - hh - 6} width={(hw + 6) * 2} height={(hh + 6) * 2}
              fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeDasharray="6,3" rx="6" />
          );
        })()}

        {/* Reset Layout button (visible when any edits have been made) */}
        {(Object.keys(posOffsets).length > 0 || Object.keys(arrowOverrides).length > 0 || Object.keys(labelOverrides).length > 0 || deletedConnections.size > 0 || extraShapes.length > 0 || extraConnections.length > 0) && (
          <g data-no-export="true" style={{ cursor: 'pointer' }} onClick={handleReset}>
            <rect x={svgWidth - 125} y={HEADER_HEIGHT + 8} width="115" height="28" rx="6" fill="#ef4444" />
            <text
              x={svgWidth - 67}
              y={HEADER_HEIGHT + 26}
              textAnchor="middle"
              fill="white"
              fontSize="12"
              fontFamily="Arial, sans-serif"
              fontWeight="600"
            >
              Reset Layout
            </text>
          </g>
        )}

        {/* Legend */}
        <g transform={`translate(10, ${svgHeight - 30})`}>
          <circle cx="10" cy="10" r="8" fill="#047857" />
          <text x="25" y="14" fontSize="10" fill="#6b7280" fontFamily="Arial">Start/End</text>
          
          <rect x="80" y="2" width="16" height="16" fill="white" stroke="#059669" strokeWidth="2" rx="2" />
          <text x="102" y="14" fontSize="10" fill="#6b7280" fontFamily="Arial">Process</text>
          
          <polygon points="175,10 183,2 191,10 183,18" fill="#059669" stroke="#047857" strokeWidth="1.5" />
          <text x="198" y="14" fontSize="10" fill="#6b7280" fontFamily="Arial">Decision</text>

          <path d={`M265,2 L281,2 L281,14 Q277,19 273,14 Q269,9 265,14 Z`} fill="#059669" stroke="#047857" strokeWidth="1.5" />
          <text x="288" y="14" fontSize="10" fill="#6b7280" fontFamily="Arial">Document</text>

          <g>
            <rect x="355" y="2" width="16" height="16" rx="2" fill="#f3f4f6" stroke="#6b7280" strokeWidth="1.5" />
            <line x1="359" y1="2" x2="359" y2="18" stroke="#6b7280" strokeWidth="1" />
            <line x1="367" y1="2" x2="367" y2="18" stroke="#6b7280" strokeWidth="1" />
          </g>
          <text x="378" y="14" fontSize="10" fill="#6b7280" fontFamily="Arial">Subprocess</text>
        </g>
      </svg>
      </div>
    );
  }
);

SwimlaneSVG.displayName = 'SwimlaneSVG';

export default SwimlaneSVG;
