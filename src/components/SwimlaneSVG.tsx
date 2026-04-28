'use client';

import { forwardRef, useMemo, useState, useCallback, useRef, useEffect } from 'react';

export interface ProcessStep {
  id: string;
  label: string;
  type: 'start' | 'end' | 'process' | 'decision' | 'document' | 'subprocess' | 'system' | 'database';
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

export interface DiagramEditState {
  posOffsets: Record<string, { dx: number; dy: number }>;
  arrowOverrides: Record<string, { x: number; y: number }[]>;
  labelOverrides: Record<string, string>;
  numberOverrides: Record<string, number | null>;
  deletedConnections: string[];
  deletedShapes: string[];
  extraShapes: Array<{ id: string; label: string; type: string; x: number; y: number }>;
  extraConnections: Array<{ from: string; to: string; label?: string }>;
  extraLanes: Array<{ id: string; name: string }>;
  laneNameOverrides?: Record<string, string>;
}

interface SwimlaneSVGProps {
  data: SwimlaneData;
  onLayoutChange?: (offsets: Record<string, {dx: number, dy: number}>) => void;
  onSaveVersion?: (editState: DiagramEditState) => void;
  onToggleHistory?: () => void;
  restoredEditState?: DiagramEditState | null;
  showHistoryActive?: boolean;
}

// Dimensions with extra spacing to avoid arrow-shape overlap
const LANE_HEIGHT = 160;
const LANE_HEADER_WIDTH = 90;
const CELL_WIDTH = 240;
const SHAPE_WIDTH = 160;
const SHAPE_HEIGHT = 64;
const HEADER_HEIGHT = 40;
const DECISION_SIZE = 64;
const DOC_WIDTH = 110;   // smaller width for document shapes
const DOC_HEIGHT = 48;   // smaller height for document shapes
const ARROW_GAP = 14; // min gap between arrow and shape edge

const SwimlaneSVG = forwardRef<SVGSVGElement, SwimlaneSVGProps>(
  ({ data, onLayoutChange, onSaveVersion, onToggleHistory, restoredEditState, showHistoryActive }, ref) => {
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
    // Step number overrides from user edits
    const [numberOverrides, setNumberOverrides] = useState<Record<string, number | null>>({});
    const [editingStepId, setEditingStepId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const editInputRef = useRef<HTMLTextAreaElement | null>(null);
    const [selectedArrow, setSelectedArrow] = useState<string | null>(null);
    const [deletedConnections, setDeletedConnections] = useState<Set<string>>(new Set());
    const [deletedShapes, setDeletedShapes] = useState<Set<string>>(new Set());
    const [selectedShape, setSelectedShape] = useState<string | null>(null);
    // Extra shapes and connections added by user
    const [extraShapes, setExtraShapes] = useState<Array<{
      id: string; label: string;
      type: 'process' | 'decision' | 'document' | 'subprocess' | 'system';
      x: number; y: number;
      stepNumber?: number;
    }>>([]);
    const [extraConnections, setExtraConnections] = useState<Array<{
      from: string; to: string; label?: string;
    }>>([]);
    const [extraLanes, setExtraLanes] = useState<Array<{ id: string; name: string }>>([]);
    const [editingLaneId, setEditingLaneId] = useState<string | null>(null);
    const [editLaneText, setEditLaneText] = useState('');
    const laneEditInputRef = useRef<HTMLInputElement | null>(null);
    const [laneNameOverrides, setLaneNameOverrides] = useState<Record<string, string>>({});
    const [addMode, setAddMode] = useState<'process' | 'decision' | 'document' | 'subprocess' | 'system' | 'arrow' | null>(null);
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
    // Pending arrow drag: tracks intent to drag before threshold is exceeded
    const [pendingArrowDrag, setPendingArrowDrag] = useState<{
      connKey: string;
      segmentIdx: number;
      pathPoints: {x: number, y: number}[];
      startMouse: {x: number, y: number};
    } | null>(null);

    // Reset offsets when flowchart data changes
    useEffect(() => {
      setPosOffsets({});
      setArrowOverrides({});
      setLabelOverrides({});
      setNumberOverrides({});
      setEditingStepId(null);
      setSelectedArrow(null);
      setSelectedShape(null);
      setDeletedConnections(new Set());
      setDeletedShapes(new Set());
      setExtraShapes([]);
      setExtraConnections([]);
      setExtraLanes([]);
      setLaneNameOverrides({});
      setEditingLaneId(null);
      setAddMode(null);
      setArrowStart(null);
    }, [data]);

    // Restore edit state from version history
    useEffect(() => {
      if (!restoredEditState) return;
      setPosOffsets(restoredEditState.posOffsets || {});
      setArrowOverrides(restoredEditState.arrowOverrides || {});
      setLabelOverrides(restoredEditState.labelOverrides || {});
      setNumberOverrides(restoredEditState.numberOverrides || {});
      setDeletedConnections(new Set(restoredEditState.deletedConnections || []));
      setDeletedShapes(new Set(restoredEditState.deletedShapes || []));
      setExtraShapes((restoredEditState.extraShapes || []) as typeof extraShapes);
      setExtraConnections(restoredEditState.extraConnections || []);
      setExtraLanes(restoredEditState.extraLanes || []);
      setLaneNameOverrides(restoredEditState.laneNameOverrides || {});
      setEditingStepId(null);
      setEditingLaneId(null);
      setSelectedArrow(null);
      setSelectedShape(null);
      setAddMode(null);
      setArrowStart(null);
    }, [restoredEditState]);

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
          // Check if the source is a decision shape — prompt for Yes/No label
          const allSteps = [...data.lanes.flatMap(l => l.steps), ...extraShapes];
          const sourceStep = allSteps.find(s => s.id === arrowStart);
          let label: string | undefined;
          if (sourceStep?.type === 'decision') {
            const choice = prompt('Decision arrow label:\nType "Yes" or "No" (or leave blank for unlabeled)');
            if (choice !== null) {
              const trimmed = choice.trim();
              if (/^y(es)?$/i.test(trimmed)) label = 'Yes';
              else if (/^n(o)?$/i.test(trimmed)) label = 'No';
              else if (trimmed) label = trimmed;
            }
          }
          setExtraConnections(prev => [...prev, { from: arrowStart, to: stepId, label }]);
          setArrowStart(null);
        }
        return;
      }
      const svgPt = screenToSVG(e.clientX, e.clientY);
      const offset = posOffsets[stepId] || { dx: 0, dy: 0 };
      setDragInfo({ type: 'shape', stepId, startMouse: svgPt, startOffset: { ...offset } });
    }, [screenToSVG, posOffsets, editingStepId, addMode, arrowStart, data, extraShapes]);

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
      if (!dragInfo && !pendingArrowDrag) return;
      const DRAG_THRESHOLD = 5;
      const handleMove = (e: PointerEvent) => {
        e.preventDefault();
        const svgPt = screenToSVG(e.clientX, e.clientY);
        // Promote pending arrow drag to real drag once threshold exceeded
        if (pendingArrowDrag && !dragInfo) {
          const dx = svgPt.x - pendingArrowDrag.startMouse.x;
          const dy = svgPt.y - pendingArrowDrag.startMouse.y;
          if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
            const { connKey, segmentIdx, pathPoints, startMouse } = pendingArrowDrag;
            const insertPt = { x: startMouse.x, y: startMouse.y };
            const newPoints = arrowOverrides[connKey]
              ? [...arrowOverrides[connKey]]
              : pathPoints.map(p => ({ ...p }));
            newPoints.splice(segmentIdx + 1, 0, { ...insertPt });
            setArrowOverrides(prev => ({ ...prev, [connKey]: newPoints }));
            setSelectedArrow(connKey);
            setDragInfo({ type: 'waypoint', connKey, wpIdx: segmentIdx + 1, startMouse, startPoint: insertPt });
            setPendingArrowDrag(null);
          }
          return;
        }
        if (!dragInfo) return;
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
        // If pointer released without crossing threshold, just select the arrow
        if (pendingArrowDrag && !dragInfo) {
          setSelectedArrow(prev => prev === pendingArrowDrag.connKey ? null : pendingArrowDrag.connKey);
          setPendingArrowDrag(null);
        }
        setDragInfo(null);
        setPendingArrowDrag(null);
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      return () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };
    }, [dragInfo, pendingArrowDrag, screenToSVG, arrowOverrides]);

    const handleReset = useCallback(() => {
      setPosOffsets({});
      setArrowOverrides({});
      setLabelOverrides({});
      setNumberOverrides({});
      setEditingStepId(null);
      setSelectedArrow(null);
      setSelectedShape(null);
      setDeletedConnections(new Set());
      setDeletedShapes(new Set());
      setExtraShapes([]);
      setExtraConnections([]);
      setExtraLanes([]);
      setEditingLaneId(null);
      setAddMode(null);
      setArrowStart(null);
      onLayoutChange?.({});
    }, [onLayoutChange]);

    // Helper to delete a shape and its connections
    const deleteShape = useCallback((shapeId: string) => {
      setDeletedShapes(prev => { const n = new Set(prev); n.add(shapeId); return n; });
      // Also delete all connections involving this shape
      data.connections.forEach(conn => {
        if (conn.from === shapeId || conn.to === shapeId) {
          setDeletedConnections(prev => { const n = new Set(prev); n.add(`${conn.from}->${conn.to}`); return n; });
        }
      });
      setExtraConnections(prev => prev.filter(c => c.from !== shapeId && c.to !== shapeId));
      setSelectedShape(null);
    }, [data.connections]);

    // Keyboard listener for arrow/shape deletion (Delete/Backspace) and deselection (Escape)
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
        if (selectedShape && (e.key === 'Delete' || e.key === 'Backspace') && !editingStepId) {
          e.preventDefault();
          deleteShape(selectedShape);
        }
        if (e.key === 'Escape') {
          setSelectedArrow(null);
          setSelectedShape(null);
          setAddMode(null);
          setArrowStart(null);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedArrow, selectedShape, editingStepId, deleteShape]);

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
        if (currentStep && currentStep.type !== 'document') {
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
        if (step.type !== 'document' && !numbers[step.id]) {
          numbers[step.id] = stepNum++;
        }
      }
      
      return { maxColumns: maxX + 1, stepPositions: positions, stepNumbers: numbers };
    }, [data]);

    // Merge extra shape step numbers and user overrides into the lookup
    const allStepNumbers = useMemo(() => {
      const merged = { ...stepNumbers };
      for (const shape of extraShapes) {
        if (shape.stepNumber !== undefined) {
          merged[shape.id] = shape.stepNumber;
        }
      }
      // Apply user overrides (null = removed number)
      for (const [id, val] of Object.entries(numberOverrides)) {
        if (val === null) {
          delete merged[id];
        } else {
          merged[id] = val;
        }
      }
      return merged;
    }, [stepNumbers, extraShapes, numberOverrides]);

    const svgWidth = LANE_HEADER_WIDTH + (maxColumns * CELL_WIDTH) + 40;
    const totalLanes = data.lanes.length + extraLanes.length;

    // Compute vertical slot index for shapes sharing same (lane, x) cell
    const slotInfo = useMemo(() => {
      // Group shapes by (laneIndex, x) key
      const cellGroups: Record<string, string[]> = {};
      data.lanes.forEach((lane, laneIndex) => {
        lane.steps.forEach(step => {
          const key = `${laneIndex}:${step.x}`;
          if (!cellGroups[key]) cellGroups[key] = [];
          cellGroups[key].push(step.id);
        });
      });
      // Assign slot index and total count for each shape
      const info: Record<string, { slotIndex: number; slotCount: number }> = {};
      for (const ids of Object.values(cellGroups)) {
        ids.forEach((id, idx) => {
          info[id] = { slotIndex: idx, slotCount: ids.length };
        });
      }
      return info;
    }, [data]);

    // Compute dynamic lane heights based on max shapes stacked at the same x column
    const laneHeights = useMemo(() => {
      const heights: number[] = [];
      data.lanes.forEach((lane, laneIndex) => {
        // Count shapes per x column in this lane
        const colCounts: Record<number, number> = {};
        lane.steps.forEach(step => {
          colCounts[step.x] = (colCounts[step.x] || 0) + 1;
        });
        const maxStacked = Math.max(1, ...Object.values(colCounts));
        // Base height for 1 shape, add SHAPE_HEIGHT + gap for each additional stacked shape
        heights[laneIndex] = Math.max(LANE_HEIGHT, LANE_HEIGHT + (maxStacked - 1) * (SHAPE_HEIGHT + 30));
      });
      // Extra lanes get default height
      extraLanes.forEach((_, idx) => {
        heights[data.lanes.length + idx] = LANE_HEIGHT;
      });
      return heights;
    }, [data, extraLanes]);

    // Cumulative Y offsets for each lane
    const laneYOffsets = useMemo(() => {
      const offsets: number[] = [HEADER_HEIGHT];
      for (let i = 0; i < totalLanes; i++) {
        offsets[i + 1] = offsets[i] + (laneHeights[i] || LANE_HEIGHT);
      }
      return offsets;
    }, [laneHeights, totalLanes]);

    const svgHeight = laneYOffsets[totalLanes] + 60;

    // Get step center position (includes drag offset) — works for both grid steps and extra shapes
    const getStepPosition = (stepId: string) => {
      const pos = stepPositions[stepId];
      if (pos) {
        const offset = posOffsets[stepId] || { dx: 0, dy: 0 };
        const laneH = laneHeights[pos.laneIndex] || LANE_HEIGHT;
        const laneTop = laneYOffsets[pos.laneIndex];
        const slot = slotInfo[stepId];
        let y: number;
        if (slot && slot.slotCount > 1) {
          // Spread shapes evenly within the lane: divide lane into slotCount equal sections
          const sectionH = laneH / slot.slotCount;
          y = laneTop + sectionH * slot.slotIndex + sectionH / 2;
        } else {
          y = laneTop + laneH / 2;
        }
        const x = LANE_HEADER_WIDTH + (pos.x * CELL_WIDTH) + (CELL_WIDTH / 2) + offset.dx;
        return { x, y: y + offset.dy };
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

    // Render step number badge (inside top-left of shape) — click to edit
    const renderStepBadge = (cx: number, cy: number, num: number, halfW: number, halfH: number, stepId: string) => {
      const badgeX = cx - halfW + 10;
      const badgeY = cy - halfH + 10;
      return (
        <g
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            const current = String(num);
            const input = prompt('Edit step number (leave blank to remove):', current);
            if (input === null) return; // cancelled
            if (input.trim() === '') {
              setNumberOverrides(prev => ({ ...prev, [stepId]: null }));
            } else {
              const parsed = parseInt(input.trim(), 10);
              if (!isNaN(parsed)) {
                setNumberOverrides(prev => ({ ...prev, [stepId]: parsed }));
              }
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <circle cx={badgeX} cy={badgeY} r={8} fill="#047857" stroke="white" strokeWidth="1.5" />
          <text x={badgeX} y={badgeY + 3} textAnchor="middle" fill="white" fontSize="7" fontFamily="Arial, sans-serif" fontWeight="700">
            {num}
          </text>
        </g>
      );
    };

    // Render shape based on type
    const renderShape = (step: ProcessStep, cx: number, cy: number) => {
      const halfW = SHAPE_WIDTH / 2;
      const halfH = SHAPE_HEIGHT / 2;
      const num = allStepNumbers[step.id];
      const label = labelOverrides[step.id] || step.label;

      switch (step.type) {
        case 'start':
        case 'end': {
          const seLines = wrapText(label, 18);
          const seFontSize = getFontSize(label, SHAPE_WIDTH - 16, 9);
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
                filter="url(#shadow)"
              />
              {seLines.map((line, i) => (
                <text key={i} x={cx} y={cy + 4 + (i - (seLines.length - 1) / 2) * (seFontSize + 2)}
                  textAnchor="middle" fill="white" fontSize={seFontSize}
                  fontFamily="Arial, sans-serif" fontWeight="600">
                  {line}
                </text>
              ))}
              {num && renderStepBadge(cx, cy, num, halfW, halfH, step.id)}
            </g>
          );
        }
        
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
                filter="url(#shadow)"
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
              {num && renderStepBadge(cx, cy, num, halfD, halfD, step.id)}
            </g>
          );
        }
        
        case 'document': {
          const dHW = DOC_WIDTH / 2;
          const dHH = DOC_HEIGHT / 2;
          const docLines = wrapText(label, 16);
          const docFontSize = getFontSize(label, DOC_WIDTH - 10, 7);
          return (
            <g>
              <path
                d={`M${cx - dHW},${cy - dHH} 
                   L${cx + dHW},${cy - dHH} 
                   L${cx + dHW},${cy + dHH - 5} 
                   Q${cx + dHW * 0.5},${cy + dHH + 2} ${cx},${cy + dHH - 5}
                   Q${cx - dHW * 0.5},${cy + dHH - 12} ${cx - dHW},${cy + dHH - 5}
                   Z`}
                fill="#059669"
                stroke="#047857"
                strokeWidth="1.5"
                filter="url(#shadow)"
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
                rx={6}
                ry={6}
                fill="#f8f9fa"
                stroke="#9ca3af"
                strokeWidth="1.5"
                filter="url(#shadow)"
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
              {num && renderStepBadge(cx, cy, num, halfW, halfH, step.id)}
            </g>
          );
        }
        
        case 'database':
        case 'system': {
          const sysLines = wrapText(label, 18);
          const sysFontSize = getFontSize(label, SHAPE_WIDTH - 30, 9);
          const cylHalfW = SHAPE_WIDTH / 2;  // half-width of body
          const cylHalfH = SHAPE_HEIGHT / 2; // half-height of body
          const erx = 14; // ellipse radius for the 3D caps
          return (
            <g>
              {/* Cylinder body (horizontal - ellipses on left/right) */}
              <path
                d={`M${cx - cylHalfW + erx},${cy - cylHalfH}
                   L${cx + cylHalfW - erx},${cy - cylHalfH}
                   A${erx},${cylHalfH} 0 0,1 ${cx + cylHalfW - erx},${cy + cylHalfH}
                   L${cx - cylHalfW + erx},${cy + cylHalfH}
                   A${erx},${cylHalfH} 0 0,1 ${cx - cylHalfW + erx},${cy - cylHalfH} Z`}
                fill="white"
                stroke="#374151"
                strokeWidth="1.5"
                filter="url(#shadow)"
              />
              {/* Right ellipse cap */}
              <ellipse cx={cx + cylHalfW - erx} cy={cy} rx={erx} ry={cylHalfH}
                fill="white" stroke="#1f2937" strokeWidth="1.5" />
              {/* Left ellipse cap (front face) */}
              <ellipse cx={cx - cylHalfW + erx} cy={cy} rx={erx} ry={cylHalfH}
                fill="white" stroke="#1f2937" strokeWidth="1.5" />
              {sysLines.map((line, i) => (
                <text
                  key={i}
                  x={cx}
                  y={cy + 4 + (i - (sysLines.length - 1) / 2) * (sysFontSize + 3)}
                  textAnchor="middle"
                  fill="#1f2937"
                  fontSize={sysFontSize}
                  fontFamily="Arial, sans-serif"
                  fontWeight="600"
                >
                  {line}
                </text>
              ))}
              {num && renderStepBadge(cx, cy, num, cylHalfW, cylHalfH, step.id)}
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
                rx={8}
                ry={8}
                fill="white"
                stroke="#059669"
                strokeWidth="1.5"
                filter="url(#shadow)"
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
              {num && renderStepBadge(cx, cy, num, halfW, halfH, step.id)}
            </g>
          );
        }
      }
    };

    // ── Arrow routing helpers: shape avoidance + overlap spreading ──────
    // Collect bounding boxes of all shapes for collision detection
    const allShapeBounds: Array<{ id: string; cx: number; cy: number; hw: number; hh: number }> = [];
    const getShapeDims = (type: string) => {
      if (type === 'decision') return { w: DECISION_SIZE, h: DECISION_SIZE };
      if (type === 'document') return { w: DOC_WIDTH, h: DOC_HEIGHT };
      if (type === 'system' || type === 'database') return { w: SHAPE_WIDTH, h: SHAPE_HEIGHT };
      return { w: SHAPE_WIDTH, h: SHAPE_HEIGHT };
    };
    for (const lane of data.lanes) {
      for (const step of lane.steps) {
        const pos = getStepPosition(step.id);
        if (!pos) continue;
        const dims = getShapeDims(step.type);
        allShapeBounds.push({ id: step.id, cx: pos.x, cy: pos.y,
          hw: dims.w / 2 + ARROW_GAP,
          hh: dims.h / 2 + ARROW_GAP });
      }
    }
    for (const shape of extraShapes) {
      const pos = getStepPosition(shape.id);
      if (!pos) continue;
      const dims = getShapeDims(shape.type);
      allShapeBounds.push({ id: shape.id, cx: pos.x, cy: pos.y,
        hw: dims.w / 2 + ARROW_GAP,
        hh: dims.h / 2 + ARROW_GAP });
    }

    // Does a vertical segment at x (y1→y2) hit any shape (excluding skip set)?
    const vSegHits = (x: number, y1: number, y2: number, skip: Set<string>) => {
      const [lo, hi] = y1 < y2 ? [y1, y2] : [y2, y1];
      return allShapeBounds.some(s => !skip.has(s.id) && x > s.cx - s.hw && x < s.cx + s.hw && hi > s.cy - s.hh && lo < s.cy + s.hh);
    };

    // Does a horizontal segment at y (x1→x2) hit any shape?
    const hSegHits = (y: number, x1: number, x2: number, skip: Set<string>) => {
      const [lo, hi] = x1 < x2 ? [x1, x2] : [x2, x1];
      return allShapeBounds.some(s => !skip.has(s.id) && y > s.cy - s.hh && y < s.cy + s.hh && hi > s.cx - s.hw && lo < s.cx + s.hw);
    };

    // Find a clear vertical X for routing that doesn't intersect any shape.
    // Prefers column boundaries (gaps between cells) which are naturally clear.
    const findClearVert = (preferred: number, y1: number, y2: number, skip: Set<string>): number => {
      if (!vSegHits(preferred, y1, y2, skip)) return preferred;
      const candidates: number[] = [];
      for (let col = 0; col <= maxColumns + 1; col++) {
        // Column left edges
        candidates.push(LANE_HEADER_WIDTH + col * CELL_WIDTH);
        // Also try right edges of cells (between shapes)
        candidates.push(LANE_HEADER_WIDTH + col * CELL_WIDTH + CELL_WIDTH / 2 + SHAPE_WIDTH / 2 + ARROW_GAP + 4);
        candidates.push(LANE_HEADER_WIDTH + col * CELL_WIDTH + CELL_WIDTH / 2 - SHAPE_WIDTH / 2 - ARROW_GAP - 4);
      }
      candidates.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
      for (const cx of candidates) {
        if (!vSegHits(cx, y1, y2, skip)) return cx;
      }
      return preferred;
    };

    // Track horizontal routing channels to spread overlapping loopback arrows
    const hChannels: Array<{ y: number; xMin: number; xMax: number }> = [];
    const getHSpread = (baseY: number, x1: number, x2: number): number => {
      const xMin = Math.min(x1, x2);
      const xMax = Math.max(x1, x2);
      let overlap = 0;
      for (const ch of hChannels) {
        if (Math.abs(ch.y - baseY) < 8 && xMax > ch.xMin - 30 && xMin < ch.xMax + 30) overlap++;
      }
      hChannels.push({ y: baseY, xMin, xMax });
      return overlap * 14;
    };

    // Post-process ANY path: iteratively check every segment for shape collisions and detour around
    const avoidShapesInPath = (pathStr: string, skipIds: Set<string>): string => {
      const GAP = ARROW_GAP + 4; // extra clearance for detours
      let pts = parsePath(pathStr);
      if (pts.length < 2) return pathStr;

      // Run multiple passes (max 4) until no more collisions
      for (let pass = 0; pass < 4; pass++) {
        let hadCollision = false;
        const result: { x: number; y: number }[] = [pts[0]];

        for (let i = 0; i < pts.length - 1; i++) {
          const a = result[result.length - 1];
          const b = pts[i + 1];
          const isVert = Math.abs(a.x - b.x) < 1;
          const isHoriz = Math.abs(a.y - b.y) < 1;

          if (isVert) {
            const lo = Math.min(a.y, b.y);
            const hi = Math.max(a.y, b.y);
            const blockers = allShapeBounds.filter(s =>
              !skipIds.has(s.id) &&
              a.x > s.cx - s.hw && a.x < s.cx + s.hw &&
              hi > s.cy - s.hh && lo < s.cy + s.hh
            );
            if (blockers.length > 0) {
              hadCollision = true;
              let bLeft = Infinity, bRight = -Infinity;
              for (const s of blockers) {
                bLeft = Math.min(bLeft, s.cx - s.hw);
                bRight = Math.max(bRight, s.cx + s.hw);
              }
              const dRight = bRight + GAP;
              const dLeft = bLeft - GAP;
              const detourX = Math.abs(dRight - a.x) <= Math.abs(dLeft - a.x) ? dRight : dLeft;
              result.push({ x: detourX, y: a.y });
              result.push({ x: detourX, y: b.y });
            }
          } else if (isHoriz) {
            const lo = Math.min(a.x, b.x);
            const hi = Math.max(a.x, b.x);
            const blockers = allShapeBounds.filter(s =>
              !skipIds.has(s.id) &&
              a.y > s.cy - s.hh && a.y < s.cy + s.hh &&
              hi > s.cx - s.hw && lo < s.cx + s.hw
            );
            if (blockers.length > 0) {
              hadCollision = true;
              let bTop = Infinity, bBottom = -Infinity;
              for (const s of blockers) {
                bTop = Math.min(bTop, s.cy - s.hh);
                bBottom = Math.max(bBottom, s.cy + s.hh);
              }
              const dBelow = bBottom + GAP;
              const dAbove = bTop - GAP;
              const detourY = Math.abs(dAbove - a.y) <= Math.abs(dBelow - a.y) ? dAbove : dBelow;
              result.push({ x: a.x, y: detourY });
              result.push({ x: b.x, y: detourY });
            }
          }

          result.push(b);
        }

        pts = result;
        if (!hadCollision) break;
      }

      return buildPath(pts);
    };

    // ── Suppress flow-through document connections & synthesize bypass arrows ──
    // Documents must be leaf nodes (dead-ends). If the AI incorrectly placed a
    // document as an intermediate node (has BOTH incoming and outgoing connections),
    // we:
    //   1. Suppress the outgoing Doc→Step connection (docFlowSuppressed)
    //   2. Synthesize a direct Step→Step virtual connection so the flow isn't broken
    const _activeConns = data.connections.filter(c =>
      !deletedConnections.has(`${c.from}->${c.to}`) &&
      !deletedShapes.has(c.from) && !deletedShapes.has(c.to)
    );
    const _allShapes = [...data.lanes.flatMap(l => l.steps), ...extraShapes];
    const docFlowSuppressed = new Set<string>();
    const virtualConns: Array<Connection & { _virtual: true }> = [];
    for (const s of _allShapes) {
      if (s.type !== 'document') continue;
      const incoming = _activeConns.filter(c => c.to === s.id);
      const outgoing = _activeConns.filter(c => c.from === s.id);
      if (incoming.length === 0 || outgoing.length === 0) continue;
      docFlowSuppressed.add(s.id);
      for (const inc of incoming) {
        for (const out of outgoing) {
          if (!data.connections.some(c => c.from === inc.from && c.to === out.to)) {
            virtualConns.push({ from: inc.from, to: out.to, _virtual: true });
          }
        }
      }
    }

    // ── Per-connection snapping point spread ─────────────────────────────
    // For every (shape, edge) pair that has multiple connections, assign each
    // connection a unique offset perpendicular to the flow direction so they
    // never share the exact same attachment point.
    const SPREAD_STEP = 14; // px between adjacent snapping points
    const connSpread: Record<string, { fromOffset: number; toOffset: number }> = {};
    {
      const exitGroups: Record<string, string[]> = {};
      const entryGroups: Record<string, string[]> = {};
      const _mergedForSpread = [...data.connections, ...virtualConns];
      for (const conn of _mergedForSpread) {
        const ck = `${conn.from}->${conn.to}`;
        if (!('_virtual' in conn) && (deletedConnections.has(ck) || deletedShapes.has(conn.from) || deletedShapes.has(conn.to))) continue;
        const fPos = getStepPosition(conn.from);
        const tPos = getStepPosition(conn.to);
        if (!fPos || !tPos) continue;
        const cdx = tPos.x - fPos.x;
        const cdy = tPos.y - fPos.y;
        const fStep = [...data.lanes.flatMap(l => l.steps), ...extraShapes].find(s => s.id === conn.from);
        const fLane = stepPositions[conn.from]?.laneIndex ?? 0;
        const tLane = stepPositions[conn.to]?.laneIndex ?? 0;
        const cSameLane = fLane === tLane;
        const cSameCol = Math.abs(cdx) < CELL_WIDTH / 2;
        if (fStep?.type === 'decision') continue; // diamond tips are fixed points
        let exitEdge: string | null = null;
        let entryEdge: string | null = null;
        if      (cSameCol && cdy > 0)       { exitEdge = `${conn.from}:bottom`; entryEdge = `${conn.to}:top`; }
        else if (cSameCol && cdy < 0)       { exitEdge = `${conn.from}:top`;    entryEdge = `${conn.to}:bottom`; }
        else if (cSameLane && cdx < 0)      { exitEdge = `${conn.from}:left`;   entryEdge = `${conn.to}:right`; }
        else if (cdx < 0)                   { exitEdge = `${conn.from}:bottom`; entryEdge = `${conn.to}:top`; }
        else                                { exitEdge = `${conn.from}:right`;  entryEdge = `${conn.to}:left`; }
        if (exitEdge)  { if (!exitGroups[exitEdge])   exitGroups[exitEdge]   = []; exitGroups[exitEdge].push(ck); }
        if (entryEdge) { if (!entryGroups[entryEdge]) entryGroups[entryEdge] = []; entryGroups[entryEdge].push(ck); }
      }
      for (const keys of Object.values(exitGroups)) {
        if (keys.length <= 1) continue;
        keys.forEach((k, i) => {
          if (!connSpread[k]) connSpread[k] = { fromOffset: 0, toOffset: 0 };
          connSpread[k].fromOffset = (i - (keys.length - 1) / 2) * SPREAD_STEP;
        });
      }
      for (const keys of Object.values(entryGroups)) {
        if (keys.length <= 1) continue;
        keys.forEach((k, i) => {
          if (!connSpread[k]) connSpread[k] = { fromOffset: 0, toOffset: 0 };
          connSpread[k].toOffset = (i - (keys.length - 1) / 2) * SPREAD_STEP;
        });
      }
    }

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
            { key: 'system' as const, label: '+ System' },
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
          <div style={{ width: '1px', height: '22px', background: 'rgba(255,255,255,0.25)', margin: '0 4px' }} />
          <button onClick={() => {
            const name = prompt('Swimlane name (e.g., Finance, Legal, IT):');
            if (name && name.trim()) {
              const laneId = `lane-extra-${++extraIdCounter.current}`;
              setExtraLanes(prev => [...prev, { id: laneId, name: name.trim() }]);
            }
          }}
            style={{
              padding: '5px 14px', borderRadius: '6px', cursor: 'pointer',
              border: '1.5px solid rgba(255,255,255,0.35)',
              background: 'rgba(5,150,105,0.35)',
              color: 'white', fontSize: '12px', fontWeight: 600,
              transition: 'all 0.15s ease',
            }}>
            + Lane
          </button>
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
          {/* Divider + Version History buttons */}
          {(onSaveVersion || onToggleHistory) && (
            <>
              <div style={{ width: '1px', height: '22px', background: 'rgba(255,255,255,0.25)', margin: '0 4px' }} />
              {onSaveVersion && (
                <button
                  onClick={() => {
                    const editState: DiagramEditState = {
                      posOffsets: { ...posOffsets },
                      arrowOverrides: Object.fromEntries(Object.entries(arrowOverrides).map(([k, v]) => [k, v.map(p => ({ ...p }))])),
                      labelOverrides: { ...labelOverrides },
                      numberOverrides: { ...numberOverrides },
                      deletedConnections: Array.from(deletedConnections),
                      deletedShapes: Array.from(deletedShapes),
                      extraShapes: extraShapes.map(s => ({ ...s })),
                      extraConnections: extraConnections.map(c => ({ ...c })),
                      extraLanes: extraLanes.map(l => ({ ...l })),
                      laneNameOverrides: { ...laneNameOverrides },
                    };
                    onSaveVersion(editState);
                  }}
                  style={{
                    padding: '5px 14px', borderRadius: '6px', cursor: 'pointer',
                    border: '1.5px solid rgba(255,255,255,0.35)',
                    background: 'rgba(59,130,246,0.25)',
                    color: 'white', fontSize: '12px', fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: '4px',
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                  Save Version
                </button>
              )}
              {onToggleHistory && (
                <button
                  onClick={onToggleHistory}
                  style={{
                    padding: '5px 14px', borderRadius: '6px', cursor: 'pointer',
                    border: showHistoryActive ? '1.5px solid white' : '1.5px solid rgba(255,255,255,0.35)',
                    background: showHistoryActive ? 'rgba(168,85,247,0.4)' : 'rgba(168,85,247,0.15)',
                    color: 'white', fontSize: '12px', fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: '4px',
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  History
                </button>
              )}
            </>
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
          setSelectedShape(null);
          if (addMode && addMode !== 'arrow') {
            const svgPt = screenToSVG(e.clientX, e.clientY);
            const newId = `extra-${++extraIdCounter.current}`;
            // Prompt for step number
            let stepNumber: number | undefined;
            if (addMode !== 'subprocess') {
              const numStr = prompt('Step number for this shape (leave blank for none):');
              if (numStr !== null && numStr.trim()) {
                const parsed = parseInt(numStr.trim(), 10);
                if (!isNaN(parsed)) stepNumber = parsed;
              }
            }
            setExtraShapes(prev => [...prev, {
              id: newId,
              label: addMode === 'decision' ? 'Decision?' : addMode === 'document' ? 'Document' : addMode === 'subprocess' ? 'Subprocess' : 'New Step',
              type: addMode, x: svgPt.x, y: svgPt.y, stepNumber,
            }]);
            setAddMode(null);
          }
          if (addMode === 'arrow') { setArrowStart(null); }
        }}
      >
        {/* Title Header */}
        <rect x="0" y="0" width={svgWidth} height={HEADER_HEIGHT} fill="url(#headerGrad)" />
        <text
          x={svgWidth / 2}
          y={HEADER_HEIGHT / 2 + 6}
          textAnchor="middle"
          fill="white"
          fontSize="16"
          fontFamily="'Segoe UI', Arial, sans-serif"
          fontWeight="700"
          letterSpacing="0.8"
        >
          {data.title || 'Process Flowchart'}
        </text>

        {/* Layer 1: Lane backgrounds and headers */}
        {data.lanes.map((lane, laneIndex) => {
          const laneY = laneYOffsets[laneIndex];
          const laneH = laneHeights[laneIndex] || LANE_HEIGHT;
          const laneKey = `orig-lane-${laneIndex}`;
          const isEditingThisLane = editingLaneId === laneKey;
          const displayName = laneNameOverrides[laneKey] || lane.name;
          return (
            <g key={`bg-${laneIndex}`}>
              <rect x="0" y={laneY} width={LANE_HEADER_WIDTH} height={laneH} fill="url(#laneGrad)" stroke="none" />
              {isEditingThisLane ? (
                <foreignObject x={2} y={laneY + laneH / 2 - 40} width={LANE_HEADER_WIDTH - 4} height={80}>
                  <input
                    ref={laneEditInputRef}
                    value={editLaneText}
                    onChange={(e) => setEditLaneText(e.target.value)}
                    onBlur={() => {
                      if (editLaneText.trim()) {
                        setLaneNameOverrides(prev => ({ ...prev, [laneKey]: editLaneText.trim() }));
                      }
                      setEditingLaneId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (editLaneText.trim()) {
                          setLaneNameOverrides(prev => ({ ...prev, [laneKey]: editLaneText.trim() }));
                        }
                        setEditingLaneId(null);
                      }
                      if (e.key === 'Escape') setEditingLaneId(null);
                    }}
                    style={{
                      width: '100%', textAlign: 'center', border: '2px solid #3b82f6',
                      borderRadius: '4px', background: 'white', color: '#1f2937',
                      fontSize: '11px', fontFamily: 'Arial, sans-serif', fontWeight: 600,
                      padding: '2px 4px', outline: 'none',
                    }}
                  />
                </foreignObject>
              ) : (
                <text
                  x={LANE_HEADER_WIDTH / 2}
                  y={laneY + laneH / 2}
                  textAnchor="middle"
                  fill="white"
                  fontSize="11"
                  fontFamily="Arial, sans-serif"
                  fontWeight="600"
                  transform={`rotate(-90, ${LANE_HEADER_WIDTH / 2}, ${laneY + laneH / 2})`}
                  style={{ cursor: 'pointer' }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingLaneId(laneKey);
                    setEditLaneText(displayName);
                    setTimeout(() => laneEditInputRef.current?.focus(), 50);
                  }}
                >
                  {displayName}
                </text>
              )}
              <rect x={LANE_HEADER_WIDTH} y={laneY} width={svgWidth - LANE_HEADER_WIDTH} height={laneH} fill={laneIndex % 2 === 0 ? 'white' : '#f8fafc'} stroke="#e2e8f0" strokeWidth="0.75" />
              {Array.from({ length: maxColumns }).map((_, colIndex) => (
                <line
                  key={colIndex}
                  x1={LANE_HEADER_WIDTH + (colIndex * CELL_WIDTH)}
                  y1={laneY}
                  x2={LANE_HEADER_WIDTH + (colIndex * CELL_WIDTH)}
                  y2={laneY + laneH}
                  stroke="#e5e7eb"
                  strokeWidth="0.5"
                  strokeDasharray="4,8"
                />
              ))}
            </g>
          );
        })}

        {/* Extra lanes added by user */}
        {extraLanes.map((lane, idx) => {
          const laneIndex = data.lanes.length + idx;
          const laneY = laneYOffsets[laneIndex];
          const laneH = laneHeights[laneIndex] || LANE_HEIGHT;
          const isEditingLane = editingLaneId === lane.id;
          return (
            <g key={`extra-lane-${lane.id}`}>
              <rect x="0" y={laneY} width={LANE_HEADER_WIDTH} height={laneH} fill="url(#laneGrad)" stroke="none" />
              {isEditingLane ? (
                <foreignObject x={2} y={laneY + laneH / 2 - 40} width={LANE_HEADER_WIDTH - 4} height={80}>
                  <input
                    ref={laneEditInputRef}
                    value={editLaneText}
                    onChange={(e) => setEditLaneText(e.target.value)}
                    onBlur={() => {
                      if (editLaneText.trim()) {
                        setExtraLanes(prev => prev.map(l => l.id === lane.id ? { ...l, name: editLaneText.trim() } : l));
                      }
                      setEditingLaneId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (editLaneText.trim()) {
                          setExtraLanes(prev => prev.map(l => l.id === lane.id ? { ...l, name: editLaneText.trim() } : l));
                        }
                        setEditingLaneId(null);
                      }
                      if (e.key === 'Escape') setEditingLaneId(null);
                    }}
                    style={{
                      width: '100%', textAlign: 'center', border: '2px solid #3b82f6',
                      borderRadius: '4px', background: 'white', color: '#1f2937',
                      fontSize: '11px', fontFamily: 'Arial, sans-serif', fontWeight: 600,
                      padding: '2px 4px', outline: 'none',
                    }}
                  />
                </foreignObject>
              ) : (
                <text
                  x={LANE_HEADER_WIDTH / 2}
                  y={laneY + laneH / 2}
                  textAnchor="middle"
                  fill="white"
                  fontSize="11"
                  fontFamily="Arial, sans-serif"
                  fontWeight="600"
                  transform={`rotate(-90, ${LANE_HEADER_WIDTH / 2}, ${laneY + laneH / 2})`}
                  style={{ cursor: 'pointer' }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingLaneId(lane.id);
                    setEditLaneText(lane.name);
                    setTimeout(() => laneEditInputRef.current?.focus(), 50);
                  }}
                >
                  {lane.name}
                </text>
              )}
              <rect x={LANE_HEADER_WIDTH} y={laneY} width={svgWidth - LANE_HEADER_WIDTH} height={laneH} fill={laneIndex % 2 === 0 ? 'white' : '#f8fafc'} stroke="#e2e8f0" strokeWidth="0.75" />
              {Array.from({ length: maxColumns }).map((_, colIndex) => (
                <line
                  key={colIndex}
                  x1={LANE_HEADER_WIDTH + (colIndex * CELL_WIDTH)}
                  y1={laneY}
                  x2={LANE_HEADER_WIDTH + (colIndex * CELL_WIDTH)}
                  y2={laneY + laneH}
                  stroke="#e5e7eb"
                  strokeWidth="0.5"
                  strokeDasharray="4,8"
                />
              ))}
              {/* Delete lane button */}
              <g
                data-no-export="true"
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  setExtraLanes(prev => prev.filter(l => l.id !== lane.id));
                }}
              >
                <circle cx={LANE_HEADER_WIDTH / 2} cy={laneY + 12} r={8} fill="#ef4444" stroke="white" strokeWidth="1.5" />
                <text x={LANE_HEADER_WIDTH / 2} y={laneY + 16} textAnchor="middle" fill="white" fontSize="11" fontWeight="bold" fontFamily="Arial">×</text>
              </g>
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
          <linearGradient id="headerGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#065f46" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
          <linearGradient id="laneGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#047857" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
          <filter id="shadow" x="-10%" y="-10%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000000" floodOpacity="0.10" />
          </filter>
        </defs>

        {/* Connection arrows — rendered BEFORE shapes so shapes sit on top */}
        {[...data.connections, ...virtualConns].map((conn, idx) => {
          const connKey = `${conn.from}->${conn.to}`;
          const isVirtual = '_virtual' in conn && conn._virtual;
          if (!isVirtual && deletedConnections.has(connKey)) return null;
          if (!isVirtual && (deletedShapes.has(conn.from) || deletedShapes.has(conn.to))) return null;
          if (!isVirtual && docFlowSuppressed.has(conn.from)) return null; // suppress Doc→Step on real conns

          const fromPos = getStepPosition(conn.from);
          const toPos = getStepPosition(conn.to);
          if (!fromPos || !toPos) return null;

          const dx = toPos.x - fromPos.x;
          const dy = toPos.y - fromPos.y;
          
          const fromStep = data.lanes.flatMap(l => l.steps).find(s => s.id === conn.from);
          const toStep = data.lanes.flatMap(l => l.steps).find(s => s.id === conn.to);
          const isFromDecision = fromStep?.type === 'decision';
          
          const fromDims = getShapeDims(fromStep?.type || 'process');
          const fromHalfW = fromDims.w / 2;
          const fromHalfH = fromDims.h / 2;
          const toDims = getShapeDims(toStep?.type || 'process');
          const toHalfW = toDims.w / 2;
          const toHalfH = toDims.h / 2;

          const fromLane = stepPositions[conn.from]?.laneIndex ?? 0;
          const toLane = stepPositions[conn.to]?.laneIndex ?? 0;
          const isSameLane = fromLane === toLane;
          const isSameColumn = Math.abs(dx) < CELL_WIDTH / 2;
          
          const isYes = conn.label?.toLowerCase() === 'yes';
          const isNo = conn.label?.toLowerCase() === 'no';

          let path = '';
          let labelX = 0;
          let labelY = 0;
          
          // GAP = clearance from shape edges when routing
          const GAP = ARROW_GAP;

          const skip = new Set([conn.from, conn.to]);
          const spread = connSpread[connKey] || { fromOffset: 0, toOffset: 0 };

          if (isFromDecision && isYes) {
            // ===== YES path: exits RIGHT tip of diamond =====
            const startX = fromPos.x + fromHalfW;
            const startY = fromPos.y;

            if (isSameLane && dx > 0) {
              const endX = toPos.x - toHalfW - GAP;
              if (hSegHits(startY, startX, endX, skip)) {
                const laneTop = laneYOffsets[fromLane] + GAP;
                path = `M ${startX} ${startY} L ${startX} ${laneTop} L ${endX} ${laneTop} L ${endX} ${toPos.y}`;
              } else {
                path = `M ${startX} ${startY} L ${endX} ${toPos.y}`;
              }
            } else {
              // Different lane → elbow with shape-avoiding vertical segment
              const midX = findClearVert((fromPos.x + toPos.x) / 2, startY, toPos.y, skip);
              path = `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${toPos.y} L ${toPos.x - toHalfW - GAP} ${toPos.y}`;
            }
            labelX = startX + 14;
            labelY = startY - 8;

          } else if (isFromDecision && isNo) {
            // ===== NO path: exits BOTTOM tip of diamond =====
            const startX = fromPos.x;
            const startY = fromPos.y + fromHalfH;

            if (isSameColumn && dy > 0) {
              // Target directly below → straight down
              path = `M ${startX} ${startY} L ${toPos.x} ${toPos.y - toHalfH - GAP}`;
            } else if (isSameLane || toLane > fromLane) {
              // Target is in the same lane or a lane below → go down then across to target
              const turnY = Math.max(startY + GAP + 10, toPos.y);
              if (Math.abs(turnY - toPos.y) < 5) {
                // Target is roughly at the same Y → simple L-shape: down then right/left
                path = `M ${startX} ${startY} L ${startX} ${toPos.y} L ${toPos.x - toHalfW - GAP} ${toPos.y}`;
              } else {
                // Target is above the turn point → go down, across, then up
                const midX = findClearVert(toPos.x, startY, turnY, skip);
                path = `M ${startX} ${startY} L ${startX} ${turnY} L ${midX} ${turnY} L ${midX} ${toPos.y} L ${toPos.x - toHalfW - GAP} ${toPos.y}`;
              }
            } else {
              // Target is in a lane above → go down to a clear horizontal channel, across, then up
              const lowerLane = Math.max(fromLane, toLane);
              let routeY = laneYOffsets[lowerLane + 1] - 8;
              routeY += getHSpread(routeY, startX, toPos.x);
              path = `M ${startX} ${startY} L ${startX} ${routeY} L ${toPos.x} ${routeY} L ${toPos.x} ${toPos.y + toHalfH + GAP}`;
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
              const midX = findClearVert((fromPos.x + toPos.x) / 2, startY, toPos.y, skip);
              path = `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${toPos.y} L ${toPos.x - toHalfW - GAP} ${toPos.y}`;
            }
            labelX = startX + 12;
            labelY = startY - 8;

          } else if (isSameLane && dx > 0) {
            // ===== Same lane, going RIGHT =====
            const startX = fromPos.x + fromHalfW;
            const endX = toPos.x - toHalfW - GAP;
            const startY = fromPos.y + spread.fromOffset;
            const endY = toPos.y + spread.toOffset;
            if (hSegHits(startY, startX, endX, skip)) {
              const laneTop = laneYOffsets[fromLane] + GAP;
              const routeY = laneTop;
              path = `M ${startX} ${startY} L ${startX} ${routeY} L ${endX} ${routeY} L ${endX} ${endY}`;
            } else {
              path = `M ${startX} ${startY} L ${endX} ${endY}`;
            }
            labelX = (startX + endX) / 2;
            labelY = startY - 10;

          } else if (isSameLane && dx < 0) {
            // ===== Same lane, going LEFT (loopback) → route below =====
            const startX = fromPos.x - fromHalfW;
            const endX = toPos.x + toHalfW;
            const startY = fromPos.y + spread.fromOffset;
            const endY = toPos.y + spread.toOffset;
            const fromLaneIdx = stepPositions[conn.from]?.laneIndex ?? 0;
            let routeY = laneYOffsets[fromLaneIdx + 1] - 8;
            routeY += getHSpread(routeY, startX, endX);
            path = `M ${startX} ${startY} L ${startX - GAP} ${startY} L ${startX - GAP} ${routeY} L ${endX + GAP} ${routeY} L ${endX + GAP} ${endY} L ${endX} ${endY}`;
            labelX = (startX + endX) / 2;
            labelY = routeY + 12;

          } else if (isSameColumn && dy > 0) {
            // ===== Same column, going DOWN =====
            const startXd = fromPos.x + spread.fromOffset;
            const toXd = toPos.x + spread.toOffset;
            path = `M ${startXd} ${fromPos.y + fromHalfH} L ${toXd} ${toPos.y - toHalfH - GAP}`;
            labelX = startXd + 15;
            labelY = (fromPos.y + fromHalfH + toPos.y - toHalfH) / 2;

          } else if (isSameColumn && dy < 0) {
            // ===== Same column, going UP =====
            const startXu = fromPos.x + spread.fromOffset;
            const toXu = toPos.x + spread.toOffset;
            path = `M ${startXu} ${fromPos.y - fromHalfH} L ${toXu} ${toPos.y + toHalfH + GAP}`;
            labelX = startXu + 15;
            labelY = (fromPos.y - fromHalfH + toPos.y + toHalfH) / 2;

          } else if (dx > 0) {
            // ===== Different lane, going RIGHT → elbow with shape avoidance =====
            const startX = fromPos.x + fromHalfW;
            const startY = fromPos.y + spread.fromOffset;
            const endY = toPos.y + spread.toOffset;
            const midX = findClearVert((fromPos.x + toPos.x) / 2, startY, endY, skip);
            path = `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${toPos.x - toHalfW - GAP} ${endY}`;
            labelX = midX + 8;
            labelY = Math.min(startY, endY) - 8;

          } else {
            // ===== Different lane, going LEFT (loopback across lanes) =====
            const startXl = fromPos.x + spread.fromOffset;
            const toXl = toPos.x + spread.toOffset;
            const startY = fromPos.y + fromHalfH;
            const fromLaneIdx = stepPositions[conn.from]?.laneIndex ?? 0;
            const toLaneIdx = stepPositions[conn.to]?.laneIndex ?? 0;
            const maxLaneIdx = Math.max(fromLaneIdx, toLaneIdx);
            let routeY = (laneYOffsets[maxLaneIdx + 1] || laneYOffsets[totalLanes]) - 8;
            routeY += getHSpread(routeY, fromPos.x, toPos.x);
            path = `M ${startXl} ${startY} L ${startXl} ${routeY} L ${toXl} ${routeY} L ${toXl} ${toPos.y + toHalfH + GAP}`;
            labelX = (fromPos.x + toPos.x) / 2;
            labelY = routeY - 8;
          }

          // Post-process: reroute any segment that passes through a shape
          path = avoidShapesInPath(path, skip);

          // Use manual arrow overrides if available (virtual connections have none)
          const overridePoints = isVirtual ? undefined : arrowOverrides[connKey];
          const finalPath = overridePoints ? buildPath(overridePoints) : path;
          const pathPoints = overridePoints || parsePath(path);

          // Styling
          const isSelected = !isVirtual && selectedArrow === connKey;
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
                strokeWidth={isSelected ? "2.5" : "2"}
                markerEnd={markerEnd}
              />
              {/* Wide transparent hitbox — drag immediately on first touch */}
              {!isVirtual && (
              <path
                d={finalPath}
                fill="none"
                stroke="transparent"
                strokeWidth="16"
                style={{ cursor: 'grab' }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const svgPt = screenToSVG(e.clientX, e.clientY);
                  let bestSegIdx = 0, bestDist = Infinity;
                  for (let si = 0; si < pathPoints.length - 1; si++) {
                    const a = pathPoints[si], b = pathPoints[si + 1];
                    const sdx = b.x - a.x, sdy = b.y - a.y;
                    const lenSq = sdx * sdx + sdy * sdy;
                    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((svgPt.x - a.x) * sdx + (svgPt.y - a.y) * sdy) / lenSq));
                    const dist = Math.hypot(svgPt.x - (a.x + t * sdx), svgPt.y - (a.y + t * sdy));
                    if (dist < bestDist) { bestDist = dist; bestSegIdx = si; }
                  }
                  setPendingArrowDrag({ connKey, segmentIdx: bestSegIdx, pathPoints, startMouse: svgPt });
                }}
              />
              )}
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
              {/* Waypoint handles — always visible at bend points */}
              {!isVirtual && pathPoints.length > 2 && pathPoints.slice(1, -1).map((pt, i) => (
                <circle
                  key={`wp-${connKey}-${i}`}
                  data-no-export="true"
                  cx={pt.x}
                  cy={pt.y}
                  r={isSelected ? 7 : 5}
                  fill={isSelected ? '#3b82f6' : '#93c5fd'}
                  stroke="white"
                  strokeWidth={1.5}
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    handleWaypointPointerDown(e, connKey, i + 1, pathPoints);
                  }}
                />
              ))}
              {/* Start / end endpoint handles and delete button — real connections only */}
              {!isVirtual && (
              <circle
                data-no-export="true"
                cx={pathPoints[0].x} cy={pathPoints[0].y}
                r={isSelected ? 6 : 4}
                fill="white" stroke={strokeColor} strokeWidth={2}
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => { e.stopPropagation(); handleWaypointPointerDown(e, connKey, 0, pathPoints); }}
              />
              )}
              {!isVirtual && (
              <circle
                data-no-export="true"
                cx={pathPoints[pathPoints.length - 1].x} cy={pathPoints[pathPoints.length - 1].y}
                r={isSelected ? 7 : 5}
                fill={strokeColor} stroke="white" strokeWidth={2}
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => { e.stopPropagation(); handleWaypointPointerDown(e, connKey, pathPoints.length - 1, pathPoints); }}
              />
              )}
              {/* Delete button when arrow is selected */}
              {!isVirtual && isSelected && (
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
          const extraSkip = new Set([conn.from, conn.to]);
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
              const midX = findClearVert((fromPos.x + toPos.x) / 2, fromPos.y, toPos.y, extraSkip);
              path = `M ${fromPos.x} ${fromPos.y} L ${midX} ${fromPos.y} L ${midX} ${toPos.y} L ${toPos.x} ${toPos.y}`;
            }
            path = avoidShapesInPath(path, extraSkip);
          }
          const pathPoints = overridePoints || parsePath(path);
          const isSelected = selectedArrow === connKey;
          const midPt = pathPoints[Math.floor(pathPoints.length / 2)] || pathPoints[0];
          // Yes/No coloring for extra connections
          const isYes = conn.label?.toLowerCase() === 'yes';
          const isNo = conn.label?.toLowerCase() === 'no';
          const strokeColor = isYes ? '#16a34a' : isNo ? '#dc2626' : '#6b7280';
          const markerEnd = isYes ? 'url(#arrowhead-green)' : isNo ? 'url(#arrowhead-red)' : 'url(#arrowhead)';
          const labelBgColor = isYes ? '#dcfce7' : isNo ? '#fee2e2' : 'white';
          const labelBorderColor = isYes ? '#16a34a' : isNo ? '#dc2626' : '#d1d5db';
          const labelTextColor = isYes ? '#15803d' : isNo ? '#dc2626' : '#374151';
          // Label position near start of path
          const labelPt = pathPoints.length > 1 ? pathPoints[1] : pathPoints[0];
          const labelX = labelPt.x + 14;
          const labelY = labelPt.y - 8;
          return (
            <g key={`ec-${idx}`}>
              <path d={path} fill="none" stroke="white" strokeWidth="5" />
              {isSelected && <path d={path} fill="none" stroke="#3b82f6" strokeWidth="5" strokeOpacity="0.3" />}
              <path d={path} fill="none" stroke={strokeColor} strokeWidth={isSelected ? "2.5" : "2"} markerEnd={markerEnd} />
              <path d={path} fill="none" stroke="transparent" strokeWidth="16" style={{ cursor: 'grab' }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const svgPt = screenToSVG(e.clientX, e.clientY);
                  let best = 0, bestD = Infinity;
                  for (let i = 0; i < pathPoints.length - 1; i++) {
                    const a = pathPoints[i], b = pathPoints[i + 1];
                    const sdx = b.x - a.x, sdy = b.y - a.y, l2 = sdx * sdx + sdy * sdy;
                    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((svgPt.x - a.x) * sdx + (svgPt.y - a.y) * sdy) / l2));
                    const d = Math.hypot(svgPt.x - (a.x + t * sdx), svgPt.y - (a.y + t * sdy));
                    if (d < bestD) { bestD = d; best = i; }
                  }
                  setPendingArrowDrag({ connKey, segmentIdx: best, pathPoints, startMouse: svgPt });
                }}
              />
              {/* Label badge for Yes/No or custom labels */}
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
                    fontWeight="bold"
                  >
                    {conn.label}
                  </text>
                </>
              )}
              {pathPoints.length > 2 && pathPoints.slice(1, -1).map((pt, i) => (
                <circle key={`ewp-${idx}-${i}`} data-no-export="true" cx={pt.x} cy={pt.y}
                  r={isSelected ? 7 : 5} fill={isSelected ? '#3b82f6' : '#93c5fd'} stroke="white" strokeWidth={1.5}
                  style={{ cursor: 'grab' }} onPointerDown={(e) => { e.stopPropagation(); handleWaypointPointerDown(e, connKey, i + 1, pathPoints); }}
                />
              ))}
              {/* Start endpoint handle */}
              <circle
                data-no-export="true"
                cx={pathPoints[0].x} cy={pathPoints[0].y}
                r={isSelected ? 6 : 4}
                fill="white" stroke={strokeColor} strokeWidth={2}
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => { e.stopPropagation(); handleWaypointPointerDown(e, connKey, 0, pathPoints); }}
              />
              {/* End endpoint handle (arrowhead) */}
              <circle
                data-no-export="true"
                cx={pathPoints[pathPoints.length - 1].x} cy={pathPoints[pathPoints.length - 1].y}
                r={isSelected ? 7 : 5}
                fill={strokeColor} stroke="white" strokeWidth={2}
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => { e.stopPropagation(); handleWaypointPointerDown(e, connKey, pathPoints.length - 1, pathPoints); }}
              />
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
              if (deletedShapes.has(step.id)) return null;
              const isDecision = step.type === 'decision';
              const hw = isDecision ? DECISION_SIZE / 2 : SHAPE_WIDTH / 2;
              const hh = isDecision ? DECISION_SIZE / 2 : SHAPE_HEIGHT / 2;
              const currentLabel = labelOverrides[step.id] || step.label;
              const isEditing = editingStepId === step.id;
              const isShapeSelected = selectedShape === step.id;
              return (
                <g
                  key={`drag-${laneIdx}-${stepIdx}`}
                  style={{ cursor: isEditing ? 'text' : (dragInfo?.type === 'shape' && dragInfo.stepId === step.id) ? 'grabbing' : 'grab' }}
                  onPointerDown={(e) => {
                    handleShapePointerDown(e, step.id);
                    if (!editingStepId && addMode !== 'arrow') {
                      setSelectedShape(step.id);
                      setSelectedArrow(null);
                    }
                  }}
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
                  {/* Selection highlight */}
                  {isShapeSelected && (
                    <rect
                      data-no-export="true"
                      x={pos.x - hw - 6}
                      y={pos.y - hh - 6}
                      width={(hw + 6) * 2}
                      height={(hh + 6) * 2}
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="2.5"
                      strokeDasharray="6,3"
                      rx="6"
                    />
                  )}
                  {renderShape(step, pos.x, pos.y)}
                  {/* Delete button when shape is selected */}
                  {isShapeSelected && !isEditing && (
                    <g
                      data-no-export="true"
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteShape(step.id);
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <circle cx={pos.x + hw - 2} cy={pos.y - hh + 2} r={9} fill="#ef4444" stroke="white" strokeWidth="1.5" />
                      <text x={pos.x + hw - 2} y={pos.y - hh + 6} textAnchor="middle" fill="white" fontSize="12" fontWeight="bold" fontFamily="Arial">×</text>
                    </g>
                  )}
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
              {/* Delete button — red × at top-right corner */}
              {!isEditing && (
                <g data-no-export="true" style={{ cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExtraShapes(prev => prev.filter(s => s.id !== shape.id));
                    setExtraConnections(prev => prev.filter(c => c.from !== shape.id && c.to !== shape.id));
                    setPosOffsets(prev => { const n = { ...prev }; delete n[shape.id]; return n; });
                    setLabelOverrides(prev => { const n = { ...prev }; delete n[shape.id]; return n; });
                    if (arrowStart === shape.id) setArrowStart(null);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <circle cx={pos.x + hw - 2} cy={pos.y - hh + 2} r="9" fill="#ef4444" stroke="white" strokeWidth="1.5" />
                  <text x={pos.x + hw - 2} y={pos.y - hh + 6} textAnchor="middle" fill="white" fontSize="12" fontWeight="bold" fontFamily="Arial">×</text>
                </g>
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
        {(Object.keys(posOffsets).length > 0 || Object.keys(arrowOverrides).length > 0 || Object.keys(labelOverrides).length > 0 || Object.keys(numberOverrides).length > 0 || deletedConnections.size > 0 || deletedShapes.size > 0 || extraShapes.length > 0 || extraConnections.length > 0 || extraLanes.length > 0) && (
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

          <g>
            {/* Horizontal cylinder: ellipses on left/right */}
            <path d="M452,2 L462,2 A4,8 0 0,1 462,18 L452,18 A4,8 0 0,1 452,2 Z" fill="white" stroke="#1f2937" strokeWidth="1.2" />
            <ellipse cx="462" cy="10" rx="4" ry="8" fill="white" stroke="#1f2937" strokeWidth="1.2" />
            <ellipse cx="452" cy="10" rx="4" ry="8" fill="white" stroke="#1f2937" strokeWidth="1.2" />
          </g>
          <text x="472" y="14" fontSize="10" fill="#6b7280" fontFamily="Arial">Database</text>
        </g>
      </svg>
      </div>
    );
  }
);

SwimlaneSVG.displayName = 'SwimlaneSVG';

export default SwimlaneSVG;
