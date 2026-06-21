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
}

export default function ChatInterface({ 
  conversationId, 
  onNewDiagram,
  onConversationCreated,
  uploadedImageBase64,
  currentSwimlaneData,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pendingFiles, setPendingFiles] = useState<{ name: string; content: string }[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const visioInputRef = useRef<HTMLInputElement>(null);
  const [visioCount, setVisioCount] = useState(0);
  const MAX_VISIO_FILES = 4;

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

  const handleVisioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const visioFiles = Array.from(files).filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      return ext === 'vsdx' || ext === 'vsd';
    });

    const currentVisioCount = pendingFiles.filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      return ext === 'vsdx' || ext === 'vsd';
    }).length;

    const allowedCount = MAX_VISIO_FILES - currentVisioCount;
    if (allowedCount <= 0) {
      alert(`Maximum ${MAX_VISIO_FILES} Visio files allowed. Remove some to add more.`);
      return;
    }

    const filesToProcess = visioFiles.slice(0, allowedCount);
    if (filesToProcess.length < visioFiles.length) {
      alert(`Only ${allowedCount} more Visio file(s) allowed. Added first ${filesToProcess.length}.`);
    }

    for (const file of filesToProcess) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        let visioContent = `Visio File: ${file.name}\n\n`;

        const pageFiles = Object.keys(zip.files)
          .filter(name => name.match(/visio\/pages\/page\d+\.xml/i))
          .sort();

        if (pageFiles.length > 0) {
          for (const pagePath of pageFiles) {
            const xml = await zip.files[pagePath].async('text');
            visioContent += `--- ${pagePath} ---\n${xml}\n\n`;
          }
        }

        const masterFiles = Object.keys(zip.files)
          .filter(name => name.match(/visio\/masters\/master/i))
          .sort();
        for (const masterPath of masterFiles) {
          const xml = await zip.files[masterPath].async('text');
          visioContent += `--- ${masterPath} ---\n${xml}\n\n`;
        }

        if (pageFiles.length === 0) {
          for (const [name, zipFile] of Object.entries(zip.files)) {
            if (!zipFile.dir && name.endsWith('.xml')) {
              const xml = await zipFile.async('text');
              visioContent += `--- ${name} ---\n${xml}\n\n`;
            }
          }
        }

        setPendingFiles(prev => [...prev, { name: file.name, content: visioContent }]);
      } catch (error) {
        console.error('Error parsing Visio file:', error);
        alert(`Failed to parse Visio file: ${file.name}. Make sure it's a valid .vsdx file.`);
      }
    }

    // Auto-suggest prompt if input is empty
    if (!input.trim()) {
      setInput('Based on the attached Visio process diagrams, generate a best practice version of this process as a professional swimlane flowchart. Analyze the existing flows, identify improvements, and produce an optimized process.');
    }

    // Update visio count
    setVisioCount(currentVisioCount + filesToProcess.length);

    // Reset input
    if (visioInputRef.current) visioInputRef.current.value = '';
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
          let visioContent = `Visio File: ${file.name}\n\n`;

          // Extract page XML files which contain the diagram shapes and connections
          const pageFiles = Object.keys(zip.files)
            .filter(name => name.match(/visio\/pages\/page\d+\.xml/i))
            .sort();

          if (pageFiles.length > 0) {
            for (const pagePath of pageFiles) {
              const xml = await zip.files[pagePath].async('text');
              visioContent += `--- ${pagePath} ---\n${xml}\n\n`;
            }
          }

          // Also extract masters (shape definitions)
          const masterFiles = Object.keys(zip.files)
            .filter(name => name.match(/visio\/masters\/master/i))
            .sort();
          for (const masterPath of masterFiles) {
            const xml = await zip.files[masterPath].async('text');
            visioContent += `--- ${masterPath} ---\n${xml}\n\n`;
          }

          // Fallback: if no page files found, extract all XML files
          if (pageFiles.length === 0) {
            for (const [name, zipFile] of Object.entries(zip.files)) {
              if (!zipFile.dir && name.endsWith('.xml')) {
                const xml = await zipFile.async('text');
                visioContent += `--- ${name} ---\n${xml}\n\n`;
              }
            }
          }

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
          attachments: [...attachments, ...pendingFiles.map(f => ({ file_name: f.name, file_content: f.content }))],
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
    const removed = pendingFiles[index];
    const ext = removed?.name.split('.').pop()?.toLowerCase();
    if (ext === 'vsdx' || ext === 'vsd') {
      setVisioCount(prev => Math.max(0, prev - 1));
    }
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
          <input
            type="file"
            ref={visioInputRef}
            onChange={handleVisioUpload}
            className="hidden"
            multiple
            accept=".vsdx,.vsd"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600 h-10"
            title="Upload context documents"
          >
            📎
          </button>
          <button
            type="button"
            onClick={() => visioInputRef.current?.click()}
            className={`px-3 py-2 rounded-lg h-10 text-xs font-medium transition-colors ${
              visioCount >= MAX_VISIO_FILES
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-[#059669]/10 hover:bg-[#059669]/20 text-[#059669] border border-[#059669]/30'
            }`}
            title={`Upload Visio files (${visioCount}/${MAX_VISIO_FILES})`}
            disabled={visioCount >= MAX_VISIO_FILES}
          >
            <span className="flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" /></svg>
              Visio ({visioCount}/{MAX_VISIO_FILES})
            </span>
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
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2EAD6D] text-gray-900 resize-none min-h-[40px] max-h-[150px] overflow-y-auto"
            disabled={isLoading}
            rows={1}
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
