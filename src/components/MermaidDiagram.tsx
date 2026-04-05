'use client';

import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import mermaid from 'mermaid';

interface MermaidDiagramProps {
  code: string;
}

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  flowchart: {
    useMaxWidth: true,
    htmlLabels: true,
    curve: 'linear',
    nodeSpacing: 30,
    rankSpacing: 50,
    padding: 15,
    diagramPadding: 8,
  },
  themeVariables: {
    primaryColor: '#ffffff',
    primaryTextColor: '#000000',
    primaryBorderColor: '#10B981',
    lineColor: '#374151',
    secondaryColor: '#f3f4f6',
    tertiaryColor: '#10B981',
    fontFamily: 'Arial, sans-serif',
    fontSize: '12px',
    clusterBkg: '#10B981',
    clusterBorder: '#059669',
    edgeLabelBackground: '#ffffff',
    nodeTextColor: '#000000',
    textColor: '#000000',
  },
});

const MermaidDiagram = forwardRef<HTMLDivElement, MermaidDiagramProps>(
  ({ code }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => wrapperRef.current as HTMLDivElement);

    useEffect(() => {
      const renderDiagram = async () => {
        if (containerRef.current && code) {
          try {
            containerRef.current.innerHTML = '';
            const { svg } = await mermaid.render('mermaid-diagram-' + Date.now(), code);
            containerRef.current.innerHTML = svg;
            
            // Force all text elements to be black for better visibility in exports
            const svgElement = containerRef.current.querySelector('svg');
            if (svgElement) {
              // Add inline styles to all text elements
              const textElements = svgElement.querySelectorAll('text, tspan, .nodeLabel, .label, .edgeLabel');
              textElements.forEach((el) => {
                (el as HTMLElement).style.fill = '#000000';
                (el as HTMLElement).style.color = '#000000';
              });
              
              // Also update foreignObject text (for HTML labels)
              const foreignTexts = svgElement.querySelectorAll('foreignObject div, foreignObject span, foreignObject p');
              foreignTexts.forEach((el) => {
                (el as HTMLElement).style.color = '#000000';
              });
            }
          } catch (error) {
            console.error('Mermaid render error:', error);
            containerRef.current.innerHTML = `<div class="text-red-500 p-4">Error rendering diagram. Please check the syntax.</div>`;
          }
        }
      };

      renderDiagram();
    }, [code]);

    return (
      <div ref={wrapperRef} className="w-full h-full overflow-auto bg-white rounded-lg border border-gray-200">
        <div className="bg-emerald-600 text-white text-center py-2 font-semibold">
          Process Flowchart
        </div>
        <div ref={containerRef} className="p-4 min-h-[400px] overflow-auto" />
      </div>
    );
  }
);

MermaidDiagram.displayName = 'MermaidDiagram';

export default MermaidDiagram;
