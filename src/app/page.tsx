'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Sidebar from '@/components/Sidebar';
import ChatInterface from '@/components/ChatInterface';
import ManualGenerator from '@/components/ManualGenerator';
import ImageUploader from '@/components/ImageUploader';
import SwimlaneSVG, { SwimlaneData, DiagramEditState } from '@/components/SwimlaneSVG';
import DiagramVersionHistory from '@/components/DiagramVersionHistory';
import { supabase, Diagram } from '@/lib/supabase';
import { jsPDF } from 'jspdf';
import { downloadDrawioFile } from '@/lib/exportDrawio';
import { downloadExcelFile } from '@/lib/exportExcel';

const MermaidDiagram = dynamic(() => import('@/components/MermaidDiagram'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-full text-gray-500">Loading diagram...</div>,
});

export default function Home() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [mermaidCode, setMermaidCode] = useState<string | null>(null);
  const [swimlaneData, setSwimlaneData] = useState<SwimlaneData | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [processName, setProcessName] = useState<string | null>(null);
  const [uploadedImageBase64, setUploadedImageBase64] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [clientLogo, setClientLogo] = useState<string | null>(null);
  const [companyLogo, setCompanyLogo] = useState<string | null>(null);
  // Version history state
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState<Diagram[]>([]);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [restoredEditState, setRestoredEditState] = useState<DiagramEditState | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const svgDiagramRef = useRef<SVGSVGElement>(null);
  const htmlDiagramRef = useRef<HTMLDivElement>(null);
  const expandedSvgRef = useRef<SVGSVGElement>(null);
  const expandedHtmlRef = useRef<HTMLDivElement>(null);
  const expandedEditStateRef = useRef<DiagramEditState | null>(null);
  const mainEditStateRef = useRef<DiagramEditState | null>(null);
  const prevConversationId = useRef<string | null>(null);

  // Load versions for current conversation
  const loadVersions = useCallback(async (convId: string) => {
    setVersionsLoading(true);
    const { data } = await supabase
      .from('diagrams')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: false });
    if (data) setVersions(data as Diagram[]);
    setVersionsLoading(false);
  }, []);

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
        setVersions([]);
        setCurrentVersionId(null);
        setRestoredEditState(null);
        setShowHistory(false);
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
        setCurrentVersionId(diagram.id);
        
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

        // Restore edit state if saved
        if (diagram.edit_state) {
          try {
            const editState = typeof diagram.edit_state === 'string'
              ? JSON.parse(diagram.edit_state)
              : diagram.edit_state;
            setRestoredEditState(editState);
          } catch (e) {
            console.error('Failed to parse edit state:', e);
          }
        } else {
          setRestoredEditState(null);
        }
      } else {
        // No diagram for this conversation
        setMermaidCode(null);
        setSwimlaneData(null);
        setProcessName(null);
        setCurrentVersionId(null);
        setRestoredEditState(null);
      }

      // Load version list
      loadVersions(conversationId);
    };

    loadDiagramData();
  }, [conversationId, loadVersions]);

  // Save a version snapshot to Supabase
  const handleSaveVersion = useCallback(async (editState: DiagramEditState) => {
    if (!conversationId || !swimlaneData) return;
    const label = prompt('Version label (optional):') ?? undefined;

    // Count existing versions for this conversation
    const nextVersion = versions.length + 1;

    const { data: saved, error } = await supabase
      .from('diagrams')
      .insert({
        conversation_id: conversationId,
        mermaid_code: mermaidCode || '',
        swimlane_data: JSON.stringify(swimlaneData),
        version: nextVersion,
        label: label?.trim() || `Manual save v${nextVersion}`,
        edit_state: editState,
      })
      .select()
      .single();

    if (saved && !error) {
      setCurrentVersionId(saved.id);
      loadVersions(conversationId);
    }
  }, [conversationId, swimlaneData, mermaidCode, versions.length, loadVersions]);

  // Restore a version from history
  const handleRestoreVersion = useCallback((version: Diagram) => {
    setCurrentVersionId(version.id);
    setMermaidCode(version.mermaid_code);

    if (version.swimlane_data) {
      try {
        const parsed = typeof version.swimlane_data === 'string'
          ? JSON.parse(version.swimlane_data)
          : version.swimlane_data;
        setSwimlaneData(parsed);
        setProcessName(parsed.title || null);
      } catch (e) {
        console.error('Failed to parse swimlane data:', e);
      }
    }

    if (version.edit_state) {
      try {
        const editState = typeof version.edit_state === 'string'
          ? JSON.parse(version.edit_state)
          : version.edit_state;
        setRestoredEditState(editState);
      } catch (e) {
        console.error('Failed to parse edit state:', e);
        setRestoredEditState(null);
      }
    } else {
      setRestoredEditState(null);
    }
  }, []);

  const handleNewDiagram = useCallback((code: string, swimlane?: unknown) => {
    setMermaidCode(code);
    if (swimlane) {
      setSwimlaneData(swimlane as SwimlaneData);
    }
    setUploadError(null);
    setRestoredEditState(null);
    setIsChatCollapsed(true);
    setIsSidebarCollapsed(true);
    if (conversationId) {
      loadVersions(conversationId);
    }
  }, [conversationId, loadVersions]);

  const handleImageUploaded = (imageBase64: string) => {
    setUploadedImageBase64(imageBase64);
    setUploadError(null);
  };

  // Helper: load an image from a base64 string
  const loadImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

  // Helper: draw a logo onto the canvas, scaled to fit within maxW x maxH
  const drawLogoOnCanvas = async (
    ctx: CanvasRenderingContext2D,
    src: string,
    x: number, y: number,
    maxW: number, maxH: number,
    align: 'left' | 'right' = 'left'
  ) => {
    try {
      const img = await loadImage(src);
      const ratio = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * ratio;
      const h = img.height * ratio;
      const dx = align === 'right' ? x - w : x;
      const dy = y + (maxH - h) / 2;
      ctx.drawImage(img, dx, dy, w, h);
    } catch {}
  };

  // Shared helper: render current SVG to a canvas and return it
  const svgToCanvas = useCallback(async (withLogos = false): Promise<{ canvas: HTMLCanvasElement; width: number; height: number } | null> => {
    const svgElement = isExpanded ? expandedSvgRef.current : svgDiagramRef.current;
    if (!svgElement) return null;

    const svgRect = svgElement.getBoundingClientRect();
    const width = Number(svgElement.getAttribute('width') || svgRect.width);
    const height = Number(svgElement.getAttribute('height') || svgRect.height);

    const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
    svgClone.querySelectorAll('[data-no-export]').forEach(el => el.remove());
    svgClone.querySelectorAll('foreignObject').forEach(el => el.remove());
    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgClone.setAttribute('width', String(width));
    svgClone.setAttribute('height', String(height));

    const svgString = new XMLSerializer().serializeToString(svgClone);
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);

    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load SVG')); };
      img.src = url;
    });

    // If logos present (PDF only), add a white bar above the SVG content
    if (withLogos && (clientLogo || companyLogo)) {
      const LOGO_BAR_H = 90;
      const LOGO_PAD = 16;
      const LOGO_MAX_W = 180;
      const LOGO_MAX_H = LOGO_BAR_H - LOGO_PAD * 2;
      const COMPANY_LOGO_MAX_W = 240;
      const COMPANY_LOGO_MAX_H = LOGO_MAX_H;

      // Create a taller canvas: logo bar + original SVG
      const tallCanvas = document.createElement('canvas');
      tallCanvas.width = width * scale;
      tallCanvas.height = (height + LOGO_BAR_H) * scale;
      const tctx = tallCanvas.getContext('2d')!;
      tctx.scale(scale, scale);

      // White logo bar
      tctx.fillStyle = 'white';
      tctx.fillRect(0, 0, width, LOGO_BAR_H);

      // Thin separator line
      tctx.strokeStyle = '#e5e7eb';
      tctx.lineWidth = 1;
      tctx.beginPath();
      tctx.moveTo(0, LOGO_BAR_H);
      tctx.lineTo(width, LOGO_BAR_H);
      tctx.stroke();

      // Copy original SVG canvas below the logo bar
      // Use 9-arg drawImage to map the high-res source into CSS coords correctly
      tctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, LOGO_BAR_H, width, height);

      // Draw logos in the white bar
      if (clientLogo) {
        await drawLogoOnCanvas(tctx, clientLogo, LOGO_PAD, LOGO_PAD, LOGO_MAX_W, LOGO_MAX_H, 'left');
      }
      if (companyLogo) {
        await drawLogoOnCanvas(tctx, companyLogo, width - LOGO_PAD, LOGO_PAD, COMPANY_LOGO_MAX_W, COMPANY_LOGO_MAX_H, 'right');
      }

      return { canvas: tallCanvas, width, height: height + LOGO_BAR_H };
    }

    return { canvas, width, height };
  }, [isExpanded, clientLogo, companyLogo]);

  // Download flowchart as PNG
  const handleDownloadFlowchart = useCallback(async () => {
    if (!svgDiagramRef.current && !expandedSvgRef.current) { alert('No flowchart to download'); return; }
    setIsDownloading(true);
    try {
      const result = await svgToCanvas();
      if (!result) throw new Error('Could not render SVG');
      const pngUrl = result.canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = `${swimlaneData?.title || 'Process_Flowchart'}.png`.replace(/\s+/g, '_');
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading flowchart:', error);
      alert('Failed to download flowchart. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  }, [svgToCanvas, swimlaneData?.title]);

  // Download flowchart as PDF
  const handleDownloadPDF = useCallback(async () => {
    if (!svgDiagramRef.current && !expandedSvgRef.current) { alert('No flowchart to download'); return; }
    setIsDownloading(true);
    try {
      // Capture original SVG dimensions BEFORE logo bar is added (for correct orientation)
      const svgEl = isExpanded ? expandedSvgRef.current : svgDiagramRef.current;
      const svgRect = svgEl!.getBoundingClientRect();
      const origW = Number(svgEl!.getAttribute('width') || svgRect.width);
      const origH = Number(svgEl!.getAttribute('height') || svgRect.height);
      const isLandscape = origW > origH;

      const result = await svgToCanvas(true);
      if (!result) throw new Error('Could not render SVG');
      const { canvas, width, height } = result;
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: isLandscape ? 'landscape' : 'portrait', unit: 'px', format: [width, height] });
      pdf.addImage(imgData, 'PNG', 0, 0, width, height);
      pdf.save(`${swimlaneData?.title || 'Process_Flowchart'}.pdf`.replace(/\s+/g, '_'));
    } catch (error) {
      console.error('Error downloading PDF:', error);
      alert('Failed to download PDF. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  }, [svgToCanvas, swimlaneData?.title]);

  // Download flowchart as editable draw.io file
  const handleDownloadDrawio = useCallback(() => {
    if (!swimlaneData) { alert('No flowchart to export'); return; }
    const editState = isExpanded ? expandedEditStateRef.current : mainEditStateRef.current;
    downloadDrawioFile(swimlaneData, editState, swimlaneData.title || 'Process_Flowchart', { clientLogo, companyLogo });
  }, [swimlaneData, isExpanded, clientLogo, companyLogo]);

  // Download flowchart as Visio-compatible Excel file
  const handleDownloadExcel = useCallback(() => {
    if (!swimlaneData) { alert('No flowchart to export'); return; }
    const editState = isExpanded ? expandedEditStateRef.current : mainEditStateRef.current;
    downloadExcelFile(swimlaneData, editState, swimlaneData.title || 'Process_Flowchart');
  }, [swimlaneData, isExpanded]);

  const hasDiagram = swimlaneData || mermaidCode;

  return (
    <main className="h-screen flex bg-gray-100">
      {/* Collapsible Sidebar */}
      <div
        className="flex-shrink-0 transition-all duration-300 overflow-hidden"
        style={{ width: isSidebarCollapsed ? '52px' : '256px' }}
      >
        {isSidebarCollapsed ? (
          <div className="flex flex-col items-center pt-4 gap-3 h-full" style={{ background: '#0C3B2E' }}>
            <button
              onClick={() => setIsSidebarCollapsed(false)}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-white shadow" style={{ background: '#2EAD6D' }}
              title="Open sidebar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span
              className="text-xs text-gray-500 font-medium select-none"
              style={{ writingMode: 'vertical-lr', textOrientation: 'mixed', transform: 'rotate(180deg)' }}
            >
              History
            </span>
          </div>
        ) : (
          <Sidebar
            currentConversationId={conversationId}
            onSelectConversation={setConversationId}
            onCollapse={() => setIsSidebarCollapsed(true)}
          />
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Collapsible Chat Panel */}
        <div
          className="flex-shrink-0 border-r border-gray-200 flex flex-col bg-gray-50 transition-all duration-300"
          style={{ width: isChatCollapsed ? '52px' : '400px' }}
        >
          {isChatCollapsed ? (
            /* Collapsed state */
            <div className="flex flex-col items-center pt-4 gap-3">
              <button
                onClick={() => setIsChatCollapsed(false)}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-white shadow"
                style={{ background: '#0C3B2E' }}
                title="Open chat"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 16V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2h3l3 3 3-3h3a2 2 0 002-2z" />
                </svg>
              </button>
              <span
                className="text-xs text-gray-400 font-medium select-none"
                style={{ writingMode: 'vertical-lr', textOrientation: 'mixed', transform: 'rotate(180deg)' }}
              >
                Chat
              </span>
            </div>
          ) : (
            /* Expanded state */
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-white flex-shrink-0">
                <span className="text-sm font-semibold text-gray-700">💬 Chat</span>
                <button
                  onClick={() => setIsChatCollapsed(true)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500"
                  title="Collapse chat"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <ChatInterface
                  conversationId={conversationId}
                  onNewDiagram={handleNewDiagram}
                  onConversationCreated={setConversationId}
                  uploadedImageBase64={uploadedImageBase64}
                  currentSwimlaneData={swimlaneData}
                />
              </div>
            </div>
          )}
        </div>

        {/* Diagram & Manual panel — expands to fill remaining space */}
        <div className="flex-1 p-4 flex flex-col gap-4 overflow-y-auto">
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

          {/* Logo upload strip — for PNG/PDF export only */}
          <div className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
            <span className="text-xs text-gray-400 font-medium whitespace-nowrap">Export logos:</span>
            {/* Client logo */}
            <label className="flex items-center gap-2 cursor-pointer group flex-1">
              {clientLogo ? (
                <div className="flex items-center gap-2">
                  <img src={clientLogo} alt="Client logo" className="h-7 max-w-[90px] object-contain rounded border border-gray-200 bg-white p-0.5" />
                  <button
                    onClick={(e) => { e.preventDefault(); setClientLogo(null); }}
                    className="text-gray-400 hover:text-red-500 text-xs leading-none"
                    title="Remove"
                  >✕</button>
                  <span className="text-xs text-gray-500">Client</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-gray-300 rounded-lg hover:border-[#2EAD6D] hover:bg-[#E8F5EE] transition-colors">
                  <svg className="w-3.5 h-3.5 text-gray-400 group-hover:text-[#2EAD6D]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-xs text-gray-500 group-hover:text-[#0C3B2E]">Client logo</span>
                </div>
              )}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => setClientLogo(ev.target?.result as string);
                reader.readAsDataURL(file);
                e.target.value = '';
              }} />
            </label>
            <span className="text-xs text-gray-300">|</span>
            {/* Company logo */}
            <label className="flex items-center gap-2 cursor-pointer group flex-1 justify-end">
              {companyLogo ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Logic logo</span>
                  <button
                    onClick={(e) => { e.preventDefault(); setCompanyLogo(null); }}
                    className="text-gray-400 hover:text-red-500 text-xs leading-none"
                    title="Remove"
                  >✕</button>
                  <img src={companyLogo} alt="Company logo" className="h-7 max-w-[90px] object-contain rounded border border-gray-200 bg-white p-0.5" />
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-gray-300 rounded-lg hover:border-[#2EAD6D] hover:bg-[#E8F5EE] transition-colors">
                  <span className="text-xs text-gray-500 group-hover:text-[#0C3B2E]">Logic logo</span>
                  <svg className="w-3.5 h-3.5 text-gray-400 group-hover:text-[#2EAD6D]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              )}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => setCompanyLogo(ev.target?.result as string);
                reader.readAsDataURL(file);
                e.target.value = '';
              }} />
            </label>
            <span className="text-xs text-gray-400 italic whitespace-nowrap">PNG/PDF only</span>
          </div>

          {/* Diagram Preview + Version History */}
          <div className="flex-1 min-h-[300px] flex rounded-lg border border-gray-200 overflow-hidden">
            {/* Diagram area */}
            <div className="flex-1 relative bg-white overflow-hidden">
              {hasDiagram && (
                <>
                  {processName && (
                    <div className="absolute top-2 left-2 z-10 px-3 py-1 rounded-lg text-sm font-medium" style={{ background: '#E8F5EE', color: '#0C3B2E' }}>
                      {processName}
                    </div>
                  )}
                  <div className="absolute top-2 right-2 z-10 flex gap-2">
                    {/* Download Buttons */}
                    {swimlaneData && (
                      <>
                        <button
                          onClick={handleDownloadFlowchart}
                          disabled={isDownloading}
                          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 shadow-md"
                        >
                          {isDownloading ? (
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                          )}
                          {isDownloading ? 'Downloading...' : 'PNG'}
                        </button>
                        <button
                          onClick={handleDownloadPDF}
                          disabled={isDownloading}
                          className="bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 shadow-md"
                        >
                          {isDownloading ? (
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                          )}
                          {isDownloading ? 'Downloading...' : 'PDF'}
                        </button>
                        <button
                          onClick={handleDownloadDrawio}
                          className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 shadow-md"
                          title="Download as editable draw.io file"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          draw.io
                        </button>
                        <button
                          onClick={handleDownloadExcel}
                          className="bg-emerald-700 hover:bg-emerald-800 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 shadow-md"
                          title="Download as Visio-compatible Excel file"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          Excel
                        </button>
                      </>
                    )}
                    {/* Full View Button */}
                    <button
                      onClick={() => {
                        // Snapshot main view's current edits so full view starts with them
                        if (mainEditStateRef.current) {
                          setRestoredEditState({ ...mainEditStateRef.current });
                        }
                        setIsExpanded(true);
                      }}
                      className="text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 shadow-md"
                      style={{ background: '#0C3B2E' }}
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
                  <SwimlaneSVG
                    ref={svgDiagramRef}
                    data={swimlaneData}
                    onSaveVersion={conversationId ? handleSaveVersion : undefined}
                    onToggleHistory={conversationId ? () => setShowHistory(h => !h) : undefined}
                    restoredEditState={restoredEditState}
                    showHistoryActive={showHistory}
                    onEditStateChange={(state) => { mainEditStateRef.current = state; }}
                  />
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
            {/* Version History Panel */}
            {showHistory && swimlaneData && (
              <DiagramVersionHistory
                versions={versions}
                currentVersionId={currentVersionId}
                onRestore={handleRestoreVersion}
                onClose={() => setShowHistory(false)}
                isLoading={versionsLoading}
              />
            )}
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
                {/* Download Buttons in Modal */}
                {swimlaneData && (
                  <>
                    <button
                      onClick={handleDownloadFlowchart}
                      disabled={isDownloading}
                      className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1"
                    >
                      {isDownloading ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      )}
                      {isDownloading ? 'Downloading...' : 'PNG'}
                    </button>
                    <button
                      onClick={handleDownloadPDF}
                      disabled={isDownloading}
                      className="bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1"
                    >
                      {isDownloading ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      )}
                      {isDownloading ? 'Downloading...' : 'PDF'}
                    </button>
                    <button
                      onClick={handleDownloadDrawio}
                      className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1"
                      title="Download as editable draw.io file"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      draw.io
                    </button>
                    <button
                      onClick={handleDownloadExcel}
                      className="bg-emerald-700 hover:bg-emerald-800 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1"
                      title="Download as Visio-compatible Excel file"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Excel
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    // Sync edits from full view back to main view before closing
                    if (expandedEditStateRef.current) {
                      setRestoredEditState({ ...expandedEditStateRef.current });
                    }
                    setIsExpanded(false);
                  }}
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
                  <SwimlaneSVG
                    ref={expandedSvgRef}
                    data={swimlaneData}
                    restoredEditState={restoredEditState}
                    onEditStateChange={(state) => { expandedEditStateRef.current = state; }}
                    onSaveVersion={conversationId ? handleSaveVersion : undefined}
                    onToggleHistory={conversationId ? () => setShowHistory(h => !h) : undefined}
                    showHistoryActive={showHistory}
                  />
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
