'use client';

import { useState } from 'react';
import { Diagram, DiagramEditState } from '@/lib/supabase';

interface DiagramVersionHistoryProps {
  versions: Diagram[];
  currentVersionId?: string | null;
  onRestore: (version: Diagram) => void;
  onClose: () => void;
  isLoading?: boolean;
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export default function DiagramVersionHistory({
  versions,
  currentVersionId,
  onRestore,
  onClose,
  isLoading,
}: DiagramVersionHistoryProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div
      style={{
        width: '260px',
        background: '#f8fafc',
        borderLeft: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: '0 8px 8px 0',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid #e2e8f0',
          background: '#f1f5f9',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#6b7280"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span style={{ fontWeight: 700, fontSize: '13px', color: '#334155' }}>
            Version History
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#94a3b8',
            fontSize: '18px',
            lineHeight: 1,
            padding: '2px',
          }}
        >
          &times;
        </button>
      </div>

      {/* Version list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {isLoading ? (
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              color: '#94a3b8',
              fontSize: '13px',
            }}
          >
            Loading versions...
          </div>
        ) : versions.length === 0 ? (
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              color: '#94a3b8',
              fontSize: '13px',
            }}
          >
            No saved versions yet.
            <br />
            Click &quot;Save Version&quot; to create one.
          </div>
        ) : (
          versions.map((v, idx) => {
            const isCurrent = v.id === currentVersionId;
            const isConfirming = confirmId === v.id;

            return (
              <div
                key={v.id}
                style={{
                  padding: '10px 12px',
                  marginBottom: '6px',
                  borderRadius: '8px',
                  background: isCurrent ? '#dbeafe' : 'white',
                  border: isCurrent
                    ? '1.5px solid #93c5fd'
                    : '1px solid #e2e8f0',
                  transition: 'all 0.15s ease',
                }}
              >
                {/* Version label */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginBottom: '4px',
                  }}
                >
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: isCurrent ? '#3b82f6' : '#cbd5e1',
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: '12px',
                      color: '#1e293b',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {v.label || `Version ${versions.length - idx}`}
                  </span>
                </div>

                {/* Timestamp */}
                <div
                  style={{
                    fontSize: '11px',
                    color: '#94a3b8',
                    marginLeft: '14px',
                    marginBottom: '6px',
                  }}
                >
                  {timeAgo(v.created_at)}
                </div>

                {/* Restore button */}
                {!isCurrent && (
                  <div style={{ marginLeft: '14px' }}>
                    {isConfirming ? (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span
                          style={{ fontSize: '11px', color: '#f59e0b' }}
                        >
                          Restore?
                        </span>
                        <button
                          onClick={() => {
                            onRestore(v);
                            setConfirmId(null);
                          }}
                          style={{
                            padding: '2px 10px',
                            borderRadius: '4px',
                            background: '#3b82f6',
                            color: 'white',
                            fontSize: '11px',
                            fontWeight: 600,
                            border: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          style={{
                            padding: '2px 10px',
                            borderRadius: '4px',
                            background: '#e2e8f0',
                            color: '#64748b',
                            fontSize: '11px',
                            fontWeight: 600,
                            border: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmId(v.id)}
                        style={{
                          padding: '3px 12px',
                          borderRadius: '5px',
                          background: '#f1f5f9',
                          color: '#475569',
                          fontSize: '11px',
                          fontWeight: 600,
                          border: '1px solid #e2e8f0',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          (e.target as HTMLButtonElement).style.background =
                            '#e2e8f0';
                        }}
                        onMouseLeave={(e) => {
                          (e.target as HTMLButtonElement).style.background =
                            '#f1f5f9';
                        }}
                      >
                        Restore
                      </button>
                    )}
                  </div>
                )}

                {isCurrent && (
                  <div
                    style={{
                      marginLeft: '14px',
                      fontSize: '11px',
                      color: '#3b82f6',
                      fontWeight: 600,
                    }}
                  >
                    Current
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
