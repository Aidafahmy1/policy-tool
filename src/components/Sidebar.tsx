'use client';

import { useState, useEffect } from 'react';
import { supabase, Conversation } from '@/lib/supabase';

interface SidebarProps {
  currentConversationId: string | null;
  onSelectConversation: (id: string | null) => void;
  onCollapse?: () => void;
}

export default function Sidebar({ currentConversationId, onSelectConversation, onCollapse }: SidebarProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    loadConversations();
  }, []);

  const loadConversations = async () => {
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false });
    if (data) {
      const seen = new Set<string>();
      setConversations(data.filter(c => seen.has(c.id) ? false : seen.add(c.id) as unknown as boolean));
    }
  };

  const handleNewChat = () => {
    onSelectConversation(null);
  };

  const handleDeleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await supabase.from('conversations').delete().eq('id', id);
    if (currentConversationId === id) {
      onSelectConversation(null);
    }
    loadConversations();
  };

  // Refresh conversations when a new one is created
  useEffect(() => {
    if (currentConversationId && !conversations.find(c => c.id === currentConversationId)) {
      loadConversations();
    }
  }, [currentConversationId]);

  return (
    <div className="w-64 text-white flex flex-col h-full" style={{ background: '#0C3B2E' }}>
      <div className="p-4 border-b border-white/15 flex items-start justify-between">
        <div>
          <img src="/logic-logo.png" alt="Logic Consulting" className="h-14 w-48 rounded bg-white px-1 py-0 object-cover mb-1" />
          <p className="text-xs text-white/50 mt-1">Process Diagram & Manual Generator</p>
        </div>
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white mt-0.5 flex-shrink-0"
            title="Collapse sidebar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M21 19l-7-7 7-7" />
            </svg>
          </button>
        )}
      </div>

      <button
        onClick={handleNewChat}
        className="mx-4 mt-4 px-4 py-2 rounded-lg text-sm font-medium transition-colors text-white"
        style={{ background: '#2EAD6D' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#259A5E')}
        onMouseLeave={(e) => (e.currentTarget.style.background = '#2EAD6D')}
      >
        + New Process
      </button>

      <div className="flex-1 overflow-y-auto mt-4">
        <div className="px-4 py-2 text-xs text-gray-500 uppercase tracking-wider">
          History
        </div>
        {conversations.length === 0 ? (
          <div className="px-4 py-2 text-sm text-gray-500">
            No conversations yet
          </div>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => onSelectConversation(conv.id)}
              className={`mx-2 px-3 py-2 rounded-lg cursor-pointer flex items-center justify-between group ${
                currentConversationId === conv.id
                  ? 'bg-white/15'
                  : 'hover:bg-white/10'
              }`}
            >
              <span className="text-sm truncate flex-1">{conv.title}</span>
              <button
                onClick={(e) => handleDeleteConversation(conv.id, e)}
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 ml-2"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      <div className="p-4 border-t border-white/15 text-xs text-white/40">
        Powered by Claude AI | Logic Consulting
      </div>
    </div>
  );
}
