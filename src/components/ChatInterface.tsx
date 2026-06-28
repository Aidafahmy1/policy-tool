'use client';

import { useState, useRef, useEffect } from 'react';
import { supabase, Message, Conversation, Attachment } from '@/lib/supabase';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

interface ChatInterfaceProps {
  conversationId: string | null;
  onNewDiagram: (code: string, swimlaneData?: unknown) => void;
  onConversationCreated: (id: string) => void;
  uploadedImageBase64?: string | null;
  currentSwimlaneData?: unknown | null;
  drawioContent?: { fileName: string; content: string } | null;
}

export default function ChatInterface({ 
  conversationId, 
  onNewDiagram,
  onConversationCreated,
  uploadedImageBase64,
  currentSwimlaneData,
  drawioContent,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pendingFiles, setPendingFiles] = useState<{ name: string; content: string }[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load messages when conversation changes
  useEffect(() => {
    if (conversationId) {
      loadMessages();
      loadAttachments();
    } else {
      setMessages([]);
      setAttachments([]);
    }
  }, [conversationId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadMessages = async () => {
    if (!conversationId) return;
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (data) setMessages(data);
  };

  const loadAttachments = async () => {
    if (!conversationId) return;
    const { data } = await supabase
      .from('attachments')
      .select('*')
      .eq('conversation_id', conversationId);
    if (data) setAttachments(data);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      const fileExt = file.name.split('.').pop()?.toLowerCase();
      const isExcel = fileExt === 'xlsx' || fileExt === 'xls' || fileExt === 'xlsm' || fileExt === 'xlsb';
      const isVisio = fileExt === 'vsdx' || fileExt === 'vsd';
      const isPowerPoint = fileExt === 'pptx';
      const isOldPowerPoint = fileExt === 'ppt';

      if (isOldPowerPoint) {
        alert('Old .ppt format is not supported. Please save the file as .pptx and re-upload.');
        continue;
      }

      if (isPowerPoint) {
        // Handle PowerPoint files (.pptx is a ZIP of XML files)
        try {
          const arrayBuffer = await file.arrayBuffer();
          const zip = await JSZip.loadAsync(arrayBuffer);
          let pptContent = `PowerPoint File: ${file.name}\n\n`;

          // Extract slide XML files which contain the text content
          const slideFiles = Object.keys(zip.files)
            .filter(name => name.match(/ppt\/slides\/slide\d+\.xml/i))
            .sort((a, b) => {
              const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
              const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
              return numA - numB;
            });

          for (const slidePath of slideFiles) {
            const xml = await zip.files[slidePath].async('text');
            // Extract text content from XML by removing tags
            const textContent = xml
              .replace(/<a:p[^>]*>/g, '\n')
              .replace(/<[^>]+>/g, '')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&amp;/g, '&')
              .replace(/&quot;/g, '"')
              .replace(/&apos;/g, "'")
              .replace(/\n{3,}/g, '\n\n')
              .trim();
            const slideNum = slidePath.match(/slide(\d+)/)?.[1] || '?';
            pptContent += `--- Slide ${slideNum} ---\n${textContent}\n\n`;
          }

          // Also try to extract notes
          const noteFiles = Object.keys(zip.files)
            .filter(name => name.match(/ppt\/notesSlides\/notesSlide\d+\.xml/i))
            .sort();
          if (noteFiles.length > 0) {
            pptContent += '\n--- SPEAKER NOTES ---\n';
            for (const notePath of noteFiles) {
              const xml = await zip.files[notePath].async('text');
              const textContent = xml
                .replace(/<a:p[^>]*>/g, '\n')
                .replace(/<[^>]+>/g, '')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, "'")
                .replace(/\n{3,}/g, '\n\n')
                .trim();
              const noteNum = notePath.match(/notesSlide(\d+)/)?.[1] || '?';
              pptContent += `Note ${noteNum}: ${textContent}\n\n`;
            }
          }

          setPendingFiles(prev => [...prev, { name: file.name, content: pptContent }]);
        } catch (error) {
          console.error('Error parsing PowerPoint file:', error);
          alert(`Failed to parse PowerPoint file: ${file.name}. Make sure it's a valid .pptx file.`);
        }
      } else if (isVisio) {
        // Handle Visio files (.vsdx is a ZIP of XML files)
        try {
          const arrayBuffer = await file.arrayBuffer();
          const zip = await JSZip.loadAsync(arrayBuffer);

          // Extract page XML files which contain the diagram shapes and connections
          const pageFiles = Object.keys(zip.files)
            .filter(name => name.match(/visio\/pages\/page\d+\.xml/i))
            .sort();

          let rawXml = '';
          if (pageFiles.length > 0) {
            for (const pagePath of pageFiles) {
              const xml = await zip.files[pagePath].async('text');
              rawXml += xml + '\n';
            }
          } else {
            // Fallback: extract all XML files
            for (const [name, zipFile] of Object.entries(zip.files)) {
              if (!zipFile.dir && name.endsWith('.xml')) {
                const xml = await zipFile.async('text');
                rawXml += xml + '\n';
              }
            }
          }

          // Pre-process: extract shapes, connections, and swimlanes into a clean summary
          const shapes: { id: string; text: string; type: string; masterName: string }[] = [];
          const connections: { from: string; to: string; label: string }[] = [];
          const swimlanes: string[] = [];

          // Extract shape data from XML
          const shapeRegex = /<Shape[^>]*ID=['"](\d+)['"][^>]*(?:NameU=['"]([^'"]*?)['"])?[^>]*(?:Master=['"](\d+)['"])?[^>]*>([\s\S]*?)<\/Shape>/gi;
          let shapeMatch;
          while ((shapeMatch = shapeRegex.exec(rawXml)) !== null) {
            const id = shapeMatch[1];
            const nameU = shapeMatch[2] || '';
            const innerXml = shapeMatch[4];
            
            // Extract text content
            const textMatch = innerXml.match(/<Text[^>]*>([\s\S]*?)<\/Text>/i);
            let text = textMatch ? textMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
            
            // Determine shape type from NameU or Master reference
            const lowerName = nameU.toLowerCase();
            let type = 'process';
            if (lowerName.includes('decision') || lowerName.includes('diamond')) type = 'decision';
            else if (lowerName.includes('document')) type = 'document';
            else if (lowerName.includes('start') || lowerName.includes('terminator') || lowerName.includes('end')) type = 'start/end';
            else if (lowerName.includes('dynamic connector') || lowerName.includes('connector')) type = 'connector';
            else if (lowerName.includes('swimlane') || lowerName.includes('functional band') || lowerName.includes('separator')) type = 'swimlane';
            else if (lowerName.includes('subprocess') || lowerName.includes('sub-process')) type = 'subprocess';
            
            if (type === 'swimlane' && text) {
              swimlanes.push(text);
            }
            
            if (text && type !== 'connector') {
              shapes.push({ id, text, type, masterName: nameU });
            }
            
            // Check for connections within shape (Connect elements)
            if (type === 'connector') {
              const fromMatch = innerXml.match(/<Connect[^>]*FromSheet=['"](\d+)['"][^>]*>/i) || innerXml.match(/<Cell[^>]*N=['"]BeginX['"][^>]*F=['"].*Sheet\.(\d+)/i);
              const toMatch = innerXml.match(/<Connect[^>]*ToSheet=['"](\d+)['"][^>]*>/i) || innerXml.match(/<Cell[^>]*N=['"]EndX['"][^>]*F=['"].*Sheet\.(\d+)/i);
              if (fromMatch && toMatch) {
                connections.push({ from: fromMatch[1], to: toMatch[1], label: text });
              }
            }
          }

          // Also extract connections from top-level Connect elements
          const connectRegex = /<Connect[^>]*FromSheet=['"](\d+)['"][^>]*ToSheet=['"](\d+)['"][^>]*/gi;
          let connMatch;
          while ((connMatch = connectRegex.exec(rawXml)) !== null) {
            const fromId = connMatch[1];
            const toId = connMatch[2];
            // Only add if not a duplicate
            if (!connections.find(c => c.from === fromId && c.to === toId)) {
              connections.push({ from: fromId, to: toId, label: '' });
            }
          }

          // Build clean summary
          let visioContent = `=== VISIO FILE: ${file.name} ===\n\n`;
          
          if (swimlanes.length > 0) {
            visioContent += `SWIMLANES/DEPARTMENTS:\n${swimlanes.map(s => `- ${s}`).join('\n')}\n\n`;
          }
          
          visioContent += `PROCESS SHAPES (${shapes.filter(s => s.type !== 'swimlane').length} total):\n`;
          for (const shape of shapes) {
            if (shape.type !== 'swimlane') {
              visioContent += `- [${shape.type.toUpperCase()}] ID:${shape.id} "${shape.text}"\n`;
            }
          }
          
          visioContent += `\nCONNECTIONS (${connections.length} total):\n`;
          for (const conn of connections) {
            const fromShape = shapes.find(s => s.id === conn.from);
            const toShape = shapes.find(s => s.id === conn.to);
            const fromLabel = fromShape ? `"${fromShape.text}"` : `Shape#${conn.from}`;
            const toLabel = toShape ? `"${toShape.text}"` : `Shape#${conn.to}`;
            visioContent += `- ${fromLabel} → ${toLabel}${conn.label ? ` [${conn.label}]` : ''}\n`;
          }

          // Also include raw XML as backup (truncated) in case pre-processing missed something
          visioContent += `\n--- RAW XML (for reference) ---\n${rawXml.substring(0, 30000)}\n`;

          setPendingFiles(prev => [...prev, { name: file.name, content: visioContent }]);
        } catch (error) {
          console.error('Error parsing Visio file:', error);
          alert(`Failed to parse Visio file: ${file.name}. Make sure it's a valid .vsdx file.`);
        }
      } else if (isExcel) {
        // Handle Excel files
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const data = event.target?.result;
            const workbook = XLSX.read(data, { type: 'binary' });
            
            // Convert all sheets to readable text
            let excelContent = `Excel File: ${file.name}\n\n`;
            workbook.SheetNames.forEach((sheetName) => {
              const worksheet = workbook.Sheets[sheetName];
              const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
              
              excelContent += `--- Sheet: ${sheetName} ---\n`;
              jsonData.forEach((row: any) => {
                if (Array.isArray(row) && row.length > 0) {
                  excelContent += row.join('\t') + '\n';
                }
              });
              excelContent += '\n';
            });
            
            setPendingFiles(prev => [...prev, { name: file.name, content: excelContent }]);
          } catch (error) {
            console.error('Error parsing Excel file:', error);
            alert(`Failed to parse Excel file: ${file.name}`);
          }
        };
        reader.readAsBinaryString(file);
      } else {
        // Handle text files (CSV, TXT, etc.)
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target?.result as string;
          setPendingFiles(prev => [...prev, { name: file.name, content }]);
        };
        reader.readAsText(file);
      }
    }

    // Auto-suggest prompt when Visio files are uploaded and input is empty
    // Count ALL pending Visio files (previously uploaded + just uploaded)
    const newVisioFiles = Array.from(files).filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      return ext === 'vsdx' || ext === 'vsd';
    });
    const existingVisioFiles = pendingFiles.filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      return ext === 'vsdx' || ext === 'vsd';
    });
    const totalVisioCount = newVisioFiles.length + existingVisioFiles.length;

    if (totalVisioCount > 0 && !input.trim()) {
      if (totalVisioCount >= 2) {
        // Benchmarking mode: 2+ Visio files
        setInput('Benchmark these processes and generate one consolidated best practice swimlane flowchart.');
      } else {
        // Single Visio file
        setInput('Analyze this Visio process diagram and generate it as a professional swimlane flowchart.');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && pendingFiles.length === 0) return;

    setIsLoading(true);
    let currentConversationId = conversationId;

    try {
      // Create conversation if needed
      if (!currentConversationId) {
        const { data: newConv } = await supabase
          .from('conversations')
          .insert({ user_id: 'default-user', title: input.slice(0, 50) })
          .select()
          .single();
        if (newConv) {
          currentConversationId = newConv.id;
          onConversationCreated(newConv.id);
        }
      }

      // Save attachments if any
      if (pendingFiles.length > 0 && currentConversationId) {
        for (const file of pendingFiles) {
          await supabase.from('attachments').insert({
            conversation_id: currentConversationId,
            file_name: file.name,
            file_type: 'text',
            file_content: file.content,
          });
        }
        await loadAttachments();
      }

      // Save user message
      const userMessage: Partial<Message> = {
        conversation_id: currentConversationId!,
        role: 'user',
        content: input + (pendingFiles.length > 0 ? `\n\n[Attached ${pendingFiles.length} file(s): ${pendingFiles.map(f => f.name).join(', ')}]` : ''),
      };

      const { data: savedUserMsg } = await supabase
        .from('messages')
        .insert(userMessage)
        .select()
        .single();

      if (savedUserMsg) {
        setMessages(prev => [...prev, savedUserMsg]);
      }

      // Prepare messages for API
      const apiMessages = [...messages, savedUserMsg].map(m => ({
        role: m!.role,
        content: m!.content,
      }));

      // Call chat API - include uploaded image if available (streamed SSE response)
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          messages: apiMessages,
          attachments: [...attachments, ...pendingFiles.map(f => ({ file_name: f.name, file_content: f.content })), ...(drawioContent ? [{ file_name: drawioContent.fileName, file_content: drawioContent.content }] : [])],
          uploadedImageBase64: uploadedImageBase64 || undefined,
          currentSwimlaneData: currentSwimlaneData || undefined,
        }),
      });

      if (!response.ok) {
        let errText = `API error (${response.status})`;
        try { const errData = await response.json(); errText = errData.error || errText; } catch {}
        console.error('Chat API error:', errText);
        setMessages(prev => [...prev, {
          id: `error-${Date.now()}`,
          conversation_id: currentConversationId!,
          role: 'assistant',
          content: `Sorry, something went wrong: ${errText}`,
          created_at: new Date().toISOString(),
        } as Message]);
        setIsLoading(false);
        return;
      }

      // Read the SSE stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let data: { message?: string; mermaidCode?: string | null; swimlaneData?: any; error?: string } | null = null;
      let streamedText = '';

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
              if (parsed.delta) {
                streamedText += parsed.delta;
              }
              if (parsed.done) {
                data = parsed;
              }
              if (parsed.error) {
                data = { message: `Sorry, something went wrong: ${parsed.error}` };
              }
            } catch {}
          }
        }
      }

      if (!data) {
        data = { message: streamedText || 'No response received.' };
      }

      // Save assistant message
      const assistantMessage: Partial<Message> = {
        conversation_id: currentConversationId!,
        role: 'assistant',
        content: data.message || streamedText || '',
      };

      const { data: savedAssistantMsg } = await supabase
        .from('messages')
        .insert(assistantMessage)
        .select()
        .single();

      if (savedAssistantMsg) {
        setMessages(prev => [...prev, savedAssistantMsg]);
      }

      // Update diagram if new code generated
      if (data.mermaidCode || data.swimlaneData) {
        onNewDiagram(data.mermaidCode || '', data.swimlaneData);
        
        // Save diagram to database with swimlane data and auto-label
        const title = data.swimlaneData?.title || 'Diagram';
        await supabase.from('diagrams').insert({
          conversation_id: currentConversationId,
          mermaid_code: data.mermaidCode || '',
          swimlane_data: data.swimlaneData ? JSON.stringify(data.swimlaneData) : null,
          label: `AI generated — ${title}`,
        });
      }

      setInput('');
      setPendingFiles([]);
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const removePendingFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !uploadedImageBase64 && (
          <div className="text-center text-gray-500 mt-8">
            <h3 className="text-lg font-medium mb-2">Welcome to Logic Process Tool</h3>
            <p className="text-sm">
              Describe a business process you want to visualize, like &quot;Create a Procure-to-Pay process&quot;
            </p>
            <p className="text-sm mt-2">
              You can also upload context documents (ERP data, org charts) using the 📎 button
            </p>
          </div>
        )}
        
        {uploadedImageBase64 && messages.length === 0 && (
          <div className="text-center mt-8">
            <div className="inline-block rounded-lg p-4" style={{ background: '#E8F5EE', border: '1px solid #B8E0CC' }}>
              <div className="flex items-center justify-center gap-2 mb-2" style={{ color: '#0C3B2E' }}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="font-medium">Flowchart Image Uploaded</span>
              </div>
              <p className="text-sm text-gray-600">
                I can see your flowchart! Ask me anything about it:
              </p>
              <ul className="text-sm text-gray-500 mt-2 text-left list-disc list-inside">
                <li>&quot;What steps are in this process?&quot;</li>
                <li>&quot;Who are the stakeholders?&quot;</li>
                <li>&quot;Suggest improvements for this workflow&quot;</li>
                <li>&quot;What should the manual include?&quot;</li>
              </ul>
            </div>
          </div>
        )}
        
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                message.role === 'user'
                  ? 'text-white'
                  : 'bg-white border border-gray-200 text-gray-800'
              }`}
              style={message.role === 'user' ? { background: '#0C3B2E' } : undefined}
            >
              <pre className="whitespace-pre-wrap font-sans text-sm">{message.content}</pre>
            </div>
          </div>
        ))}
        
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-lg px-4 py-2">
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200" />
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Pending files */}
      {pendingFiles.length > 0 && (
        <div className="px-4 py-2 bg-gray-100 border-t border-gray-200">
          <div className="flex flex-wrap gap-2">
            {pendingFiles.map((file, index) => (
              <div key={index} className="flex items-center bg-white rounded px-2 py-1 text-sm border">
                <span className="mr-2">📄 {file.name}</span>
                <button
                  onClick={() => removePendingFile(index)}
                  className="text-red-500 hover:text-red-700"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-200 bg-white">
        <div className="flex space-x-2 items-end">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
            multiple
            accept=".txt,.csv,.json,.md,.xlsx,.xls,.xlsm,.xlsb,.vsdx,.vsd,.pptx,.ppt"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600 h-10"
            title="Upload context documents"
          >
            📎
          </button>
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="Describe your process or ask a question..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2EAD6D] text-gray-900 resize-none min-h-[80px] max-h-[200px] overflow-y-auto text-sm"
            disabled={isLoading}
            rows={3}
          />
          <button
            type="submit"
            disabled={isLoading || (!input.trim() && pendingFiles.length === 0)}
            className="px-4 py-2 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed h-10"
            style={{ background: '#0C3B2E' }}
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
