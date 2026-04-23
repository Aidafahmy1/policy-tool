'use client';

import { forwardRef, useMemo } from 'react';

export interface ProcessStep {
  id: string;
  label: string;
  type: 'start' | 'end' | 'process' | 'decision' | 'document';
  x: number; // Column position
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

interface SwimlaneDiagramProps {
  data: SwimlaneData;
}

const SwimlaneDiagram = forwardRef<HTMLDivElement, SwimlaneDiagramProps>(
  ({ data }, ref) => {
    
    // Calculate the grid dimensions
    const { maxColumns, stepPositions } = useMemo(() => {
      let maxX = 0;
      const positions: Record<string, { laneIndex: number; x: number }> = {};
      
      data.lanes.forEach((lane, laneIndex) => {
        lane.steps.forEach((step) => {
          maxX = Math.max(maxX, step.x);
          positions[step.id] = { laneIndex, x: step.x };
        });
      });
      
      return { maxColumns: maxX + 1, stepPositions: positions };
    }, [data]);

    const renderShape = (step: ProcessStep) => {
      switch (step.type) {
        case 'start':
        case 'end':
          return (
            <div className="flex items-center justify-center rounded-full bg-emerald-700 text-white text-[10px] font-medium px-3 py-1.5 min-w-[60px] min-h-[28px] text-center leading-tight">
              {step.label}
            </div>
          );
        case 'decision':
          return (
            <div className="relative w-16 h-16 flex items-center justify-center flex-shrink-0">
              <div className="absolute inset-0 bg-white border-2 border-emerald-600 transform rotate-45 scale-[0.7]" />
              <span className="relative z-10 text-[9px] font-medium text-emerald-700 text-center leading-tight max-w-[50px] break-words">
                {step.label}
              </span>
            </div>
          );
        case 'document':
          return (
            <div className="flex items-center justify-center bg-emerald-600 text-white text-[10px] font-medium px-2 py-1.5 min-w-[80px] max-w-[120px] min-h-[32px] text-center leading-tight"
                 style={{ 
                   borderRadius: '2px',
                   clipPath: 'polygon(0 0, 100% 0, 100% 80%, 95% 100%, 5% 100%, 0 80%)'
                 }}>
              <span className="break-words">{step.label}</span>
            </div>
          );
        case 'process':
        default:
          return (
            <div className="flex items-center justify-center bg-white border-2 border-emerald-600 text-gray-800 text-[10px] font-medium px-2 py-1.5 min-w-[80px] max-w-[130px] min-h-[32px] rounded-sm text-center leading-tight">
              <span className="break-words">{step.label}</span>
            </div>
          );
      }
    };

    // Group steps by column for each lane
    const getStepsInColumn = (lane: Swimlane, colIndex: number) => {
      return lane.steps.filter(step => step.x === colIndex);
    };

    // Check if there's a connection between two steps
    const hasConnection = (fromId: string, toId: string) => {
      return data.connections.some(c => c.from === fromId && c.to === toId);
    };

    // Get connection label
    const getConnectionLabel = (fromId: string, toId: string) => {
      const conn = data.connections.find(c => c.from === fromId && c.to === toId);
      return conn?.label;
    };

    return (
      <div ref={ref} className="bg-white rounded-lg border border-gray-200">
        {/* Header */}
        <div className="bg-emerald-600 text-white text-center py-3 font-semibold text-lg">
          {data.title || 'Process Flowchart'}
        </div>
        
        {/* Swimlane Container */}
        <div className="p-3">
          <div className="border border-gray-400 inline-block min-w-full">
            {data.lanes.map((lane, laneIndex) => (
              <div 
                key={lane.name} 
                className={`flex ${laneIndex < data.lanes.length - 1 ? 'border-b border-gray-400' : ''}`}
              >
                {/* Stakeholder Label - Left Side (Vertical Green Box) */}
                <div 
                  className="w-24 flex-shrink-0 bg-emerald-600 flex items-center justify-center border-r border-gray-400"
                  style={{ minHeight: '90px' }}
                >
                  <span 
                    className="text-white font-semibold text-xs text-center leading-tight"
                    style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', maxWidth: '80px' }}
                  >
                    {lane.name}
                  </span>
                </div>
                
                {/* Process Steps Grid - Horizontal Lane */}
                <div 
                  className="flex-1 flex items-center bg-white relative"
                  style={{ minHeight: '90px' }}
                >
                  {/* Grid columns */}
                  {Array.from({ length: maxColumns }).map((_, colIndex) => {
                    const stepsInCol = getStepsInColumn(lane, colIndex);
                    return (
                      <div 
                        key={colIndex}
                        className={`flex-1 min-w-[120px] flex flex-col items-center justify-center py-2 px-2 ${
                          colIndex < maxColumns - 1 ? 'border-r border-gray-200' : ''
                        }`}
                      >
                        {stepsInCol.map((step, idx) => (
                          <div key={step.id} className={`flex items-center ${idx > 0 ? 'mt-2' : ''}`}>
                            {renderShape(step)}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  
                  {/* Connection arrows overlay */}
                  <svg 
                    className="absolute inset-0 pointer-events-none" 
                    style={{ width: '100%', height: '100%' }}
                    preserveAspectRatio="none"
                  >
                    <defs>
                      <marker
                        id="arrowhead"
                        markerWidth="10"
                        markerHeight="7"
                        refX="9"
                        refY="3.5"
                        orient="auto"
                      >
                        <polygon points="0 0, 10 3.5, 0 7" fill="#374151" />
                      </marker>
                    </defs>
                  </svg>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        {/* Legend */}
        <div className="px-4 py-2 border-t border-gray-200 flex flex-wrap gap-4 text-xs text-gray-600">
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 rounded-full bg-emerald-700"></div>
            <span>Start/End</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 border-2 border-emerald-600 bg-white"></div>
            <span>Process</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 border-2 border-emerald-600 bg-white transform rotate-45"></div>
            <span>Decision</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 rounded bg-blue-600" style={{borderRadius: '50% / 30%'}}></div>
            <span>System</span>
          </div>
        </div>
      </div>
    );
  }
);

SwimlaneDiagram.displayName = 'SwimlaneDiagram';

export default SwimlaneDiagram;
