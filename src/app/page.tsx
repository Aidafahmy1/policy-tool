'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Sidebar from '@/components/Sidebar';
import ChatInterface from '@/components/ChatInterface';
import ManualGenerator from '@/components/ManualGenerator';
import ImageUploader from '@/components/ImageUploader';
import SwimlaneSVG, { SwimlaneData } from '@/components/SwimlaneSVG';
import { supabase } from '@/lib/supabase';

const MermaidDiagram = dynamic(() => import('@/components/MermaidDiagram'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-full text-gray-500">Loading diagram...</div>,
});

export default function Home() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [mermaidCode, setMermaidCode] = useState<string | null>(null);
  const [swimlaneData, setSwimlaneData] = useState<SwimlaneData | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [processName, setProcessName] = useState<string | null>(null);
  const [uploadedImageBase64, setUploadedImageBase64] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const svgDiagramRef = useRef<SVGSVGElement>(null);
  const htmlDiagramRef = useRef<HTMLDivElement>(null);
  const expandedSvgRef = useRef<SVGSVGElement>(null);
  const expandedHtmlRef = useRef<HTMLDivElement>(null);
  const prevConversationId = useRef<string | null>(null);

  // Load diagram data when conversation changes
  useEffect(() => {
    const prev = prevConversationId.current;
    prevConversationId.current = conversationId;

    const loadDiagramData = async () => {
      if (!conversationId) {
        // New conversation - clear diagram data
        setMermaidCode(null);
        setSwimlaneData(null);
        setProcessName(null);
        setUploadedImageBase64(null);
        return;
      }

      // Only clear uploaded image when switching between existing conversations,
      // NOT when a new conversation is first created (null → id) so the image
      // stays available for follow-up questions.
      if (prev !== null && prev !== conversationId) {
        setUploadedImageBase64(null);
      }

      // Load the latest diagram for this conversation
      const { data: diagrams } = await supabase
        .from('diagrams')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (diagrams && diagrams.length > 0) {
        const diagram = diagrams[0];
        setMermaidCode(diagram.mermaid_code);
        
        // Try to parse swimlane data if stored
        if (diagram.swimlane_data) {
          try {
            const parsed = typeof diagram.swimlane_data === 'string' 
              ? JSON.parse(diagram.swimlane_data) 
              : diagram.swimlane_data;
            setSwimlaneData(parsed);
            setProcessName(parsed.title || null);
          } catch (e) {
            console.error('Failed to parse swimlane data:', e);
          }
        }
      } else {
        // No diagram for this conversation
        setMermaidCode(null);
        setSwimlaneData(null);
        setProcessName(null);
      }
    };

    loadDiagramData();
  }, [conversationId]);

  const handleNewDiagram = (code: string, swimlane?: unknown) => {
    setMermaidCode(code);
    if (swimlane) {
      setSwimlaneData(swimlane as SwimlaneData);
    }
    setUploadError(null);
  };

  const handleImageUploaded = (imageBase64: string) => {
    setUploadedImageBase64(imageBase64);
    setUploadError(null);
  };

  // Download flowchart as PNG
  const handleDownloadFlowchart = useCallback(async () => {
    const svgElement = isExpanded ? expandedSvgRef.current : svgDiagramRef.current;
    
    if (!svgElement) {
      alert('No flowchart to download');
      return;
    }

    setIsDownloading(true);

    try {
      // Get SVG dimensions
      const svgRect = svgElement.getBoundingClientRect();
      const width = svgElement.getAttribute('width') || svgRect.width;
      const height = svgElement.getAttribute('height') || svgRect.height;

      // Clone the SVG to avoid modifying the original
      const svgClone = svgElement.cloneNode(true) as SVGSVGElement;

      // Remove UI-only elements (waypoint handles, reset button, edit overlays)
      svgClone.querySelectorAll('[data-no-export]').forEach(el => el.remove());
      svgClone.querySelectorAll('foreignObject').forEach(el => el.remove());
      
      // Ensure proper attributes for export
      svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svgClone.setAttribute('width', String(width));
      svgClone.setAttribute('height', String(height));

      // Serialize SVG to string
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svgClone);

      // Create a canvas with higher resolution for better quality
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = Number(width) * scale;
      canvas.height = Number(height) * scale;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Could not get canvas context');
      }

      // Scale for higher resolution
      ctx.scale(scale, scale);

      // Create image from SVG
      const img = new Image();
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
          // Fill white background
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, Number(width), Number(height));
          
          // Draw the SVG
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          resolve();
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('Failed to load SVG'));
        };
        img.src = url;
      });

      // Convert canvas to PNG and download
      const pngUrl = canvas.toDataURL('image/png');
      const downloadLink = document.createElement('a');
      downloadLink.href = pngUrl;
      downloadLink.download = `${swimlaneData?.title || 'Process_Flowchart'}.png`.replace(/\s+/g, '_');
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);

    } catch (error) {
      console.error('Error downloading flowchart:', error);
      alert('Failed to download flowchart. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  }, [isExpanded, swimlaneData?.title]);

  const hasDiagram = swimlaneData || mermaidCode;

  return (
    <main className="h-screen flex bg-gray-100">
      {/* Sidebar */}
      <Sidebar
        currentConversationId={conversationId}
        onSelectConversation={setConversationId}
      />

      {/* Main content */}
      <div className="flex-1 flex">
        {/* Chat panel */}
        <div className="w-1/2 border-r border-gray-200">
          <ChatInterface
            conversationId={conversationId}
            onNewDiagram={handleNewDiagram}
            onConversationCreated={setConversationId}
            uploadedImageBase64={uploadedImageBase64}
            currentSwimlaneData={swimlaneData}
          />
        </div>

        {/* Diagram & Manual panel */}
        <div className="w-1/2 p-4 flex flex-col gap-4 overflow-y-auto">
          {/* Image Uploader - for uploading existing flowchart images */}
          <ImageUploader
            onImageUploaded={handleImageUploaded}
            onError={(err) => setUploadError(err)}
          />
          
          {uploadError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {uploadError}
            </div>
          )}

          {/* Diagram Preview */}
          <div className="flex-1 min-h-[300px] relative bg-white rounded-lg border border-gray-200 overflow-hidden">
            {hasDiagram && (
              <>
                {processName && (
                  <div className="absolute top-2 left-2 z-10 bg-emerald-100 text-emerald-800 px-3 py-1 rounded-lg text-sm font-medium">
                    {processName}
                  </div>
                )}
                <div className="absolute top-2 right-2 z-10 flex gap-2">
                  {/* Download Button */}
                  {swimlaneData && (
                    <button
                      onClick={handleDownloadFlowchart}
                      disabled={isDownloading}
                      className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 shadow-md"
                    >
                      {isDownloading ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Downloading...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Download PNG
                        </>
                      )}
                    </button>
                  )}
                  {/* Full View Button */}
                  <button
                    onClick={() => setIsExpanded(true)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 shadow-md"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                    </svg>
                    Full View
                  </button>
                </div>
              </>
            )}
            <div className="w-full h-full overflow-auto p-2">
              {swimlaneData ? (
                <SwimlaneSVG ref={svgDiagramRef} data={swimlaneData} />
              ) : mermaidCode ? (
                <MermaidDiagram ref={htmlDiagramRef} code={mermaidCode} />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center text-gray-500">
                    <div className="text-4xl mb-4">📊</div>
                    <p className="text-lg font-medium">No diagram yet</p>
                    <p className="text-sm mt-2">
                      Upload an image above or chat to generate a flowchart
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Manual Generator */}
          <ManualGenerator
            conversationId={conversationId}
            mermaidCode={mermaidCode}
            swimlaneData={swimlaneData}
            processName={processName}
            uploadedImageBase64={uploadedImageBase64}
            svgRef={svgDiagramRef}
          />
        </div>
      </div>

      {/* Expanded Diagram Modal */}
      {isExpanded && hasDiagram && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-[95vw] max-h-[95vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">Process Flowchart - Full View</h2>
              <div className="flex items-center gap-2">
                {/* Download Button in Modal */}
                {swimlaneData && (
                  <button
                    onClick={handleDownloadFlowchart}
                    disabled={isDownloading}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1"
                  >
                    {isDownloading ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Downloading...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download PNG
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={() => setIsExpanded(false)}
                  className="text-gray-500 hover:text-gray-700 p-1"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            {/* Modal Content - Full diagram without scroll constraints */}
            <div className="p-4 overflow-auto" style={{ maxHeight: 'calc(95vh - 120px)' }}>
              <div className="inline-block min-w-max">
                {swimlaneData ? (
                  <SwimlaneSVG ref={expandedSvgRef} data={swimlaneData} />
                ) : mermaidCode ? (
                  <MermaidDiagram ref={expandedHtmlRef} code={mermaidCode} />
                ) : null}
              </div>
            </div>
            
            {/* Modal Footer */}
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <p className="text-sm text-gray-600 text-center">
                Click &quot;Download Word Doc&quot; below while this view is open to capture the full diagram
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
