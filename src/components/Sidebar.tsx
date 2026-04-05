'use client';

import { useState, useEffect } from 'react';
import { supabase, Conversation } from '@/lib/supabase';

interface SidebarProps {
  currentConversationId: string | null;
  onSelectConversation: (id: string | null) => void;
}

export default function Sidebar({ currentConversationId, onSelectConversation }: SidebarProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    loadConversations();
  }, []);

  const loadConversations = async () => {
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false });
    if (data) setConversations(data);
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
    <div className="w-64 bg-gray-900 text-white flex flex-col h-full">
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-xl font-bold text-emerald-400">Process Tool</h1>
        <p className="text-xs text-gray-400 mt-1">Process Diagram Generator</p>
      </div>

      <button
        onClick={handleNewChat}
        className="mx-4 mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium transition-colors"
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
                  ? 'bg-gray-700'
                  : 'hover:bg-gray-800'
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

      <div className="p-4 border-t border-gray-700 text-xs text-gray-500">
        Powered by Claude AI
      </div>
    </div>
  );
}
