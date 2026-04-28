'use client';

import { ManualData } from '@/lib/generateDocx';
import { PolicyData } from '@/lib/generatePolicyDocx';

interface ManualPreviewProps {
  manualData?: ManualData | null;
  policyData?: PolicyData | null;
  onClose: () => void;
  onDownloadManual?: () => void;
  onDownloadPolicy?: () => void;
}

export default function ManualPreview({ manualData, policyData, onClose, onDownloadManual, onDownloadPolicy }: ManualPreviewProps) {
  const stakeholders: string[] = manualData
    ? (Array.isArray(manualData.stakeholders)
        ? manualData.stakeholders.map((s: string | { role: string }) => (typeof s === 'string' ? s : s.role))
        : [])
    : [];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-800">
              {manualData ? manualData.processName : policyData?.policyName}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {manualData ? 'Process Manual Preview' : 'Policy Document Preview'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {manualData && onDownloadManual && (
              <button
                onClick={onDownloadManual}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download .docx
              </button>
            )}
            {policyData && onDownloadPolicy && (
              <button
                onClick={onDownloadPolicy}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download .docx
              </button>
            )}
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-gray-700">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* ── MANUAL ── */}
          {manualData && (
            <>
              {/* Overview */}
              <section>
                <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-700 border-b border-emerald-200 pb-1 mb-3">
                  1. Process Overview
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="font-semibold text-gray-700">Process Level</p>
                    <p className="text-gray-600">{manualData.processLevel || '—'}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-700">Scope</p>
                    <p className="text-gray-600">{manualData.processScope || '—'}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="font-semibold text-gray-700">Objectives</p>
                    <p className="text-gray-600">{manualData.processObjectives || (manualData as any).processOverview?.purpose || '—'}</p>
                  </div>
                </div>
              </section>

              {/* Stakeholders */}
              {stakeholders.length > 0 && (
                <section>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-700 border-b border-emerald-200 pb-1 mb-3">
                    2. Process Stakeholders
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {stakeholders.map((s, i) => (
                      <span key={i} className="px-3 py-1 bg-emerald-50 text-emerald-800 rounded-full text-sm border border-emerald-200">
                        {s}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* RACI Definition */}
              {manualData.authorityMatrixDefinition && (
                <section>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-700 border-b border-emerald-200 pb-1 mb-3">
                    3. Authority Matrix (RACI)
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {(['R', 'A', 'C', 'I'] as const).map(key => (
                      manualData.authorityMatrixDefinition?.[key] && (
                        <div key={key} className="flex gap-2 items-start">
                          <span className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">{key}</span>
                          <p className="text-gray-600">{manualData.authorityMatrixDefinition[key]}</p>
                        </div>
                      )
                    ))}
                  </div>
                </section>
              )}

              {/* Process Steps Table */}
              {manualData.processSteps?.length > 0 && (
                <section>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-700 border-b border-emerald-200 pb-1 mb-3">
                    4. Process Description
                  </h3>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-emerald-700 text-white">
                          <th className="px-3 py-2 text-left font-semibold w-10">#</th>
                          <th className="px-3 py-2 text-left font-semibold">Step Name</th>
                          <th className="px-3 py-2 text-left font-semibold">Description</th>
                          <th className="px-3 py-2 text-left font-semibold">Inputs</th>
                          <th className="px-3 py-2 text-left font-semibold">Outputs</th>
                          <th className="px-3 py-2 text-center font-semibold w-8">R</th>
                          <th className="px-3 py-2 text-center font-semibold w-8">A</th>
                          <th className="px-3 py-2 text-center font-semibold w-8">C</th>
                          <th className="px-3 py-2 text-center font-semibold w-8">I</th>
                        </tr>
                      </thead>
                      <tbody>
                        {manualData.processSteps.map((step, idx) => (
                          <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <td className="px-3 py-2 font-bold text-emerald-700 align-top">{step.stepNumber}</td>
                            <td className="px-3 py-2 font-medium text-gray-800 align-top whitespace-nowrap">{step.stepName}</td>
                            <td className="px-3 py-2 text-gray-600 align-top max-w-xs">{step.description}</td>
                            <td className="px-3 py-2 text-gray-600 align-top whitespace-nowrap">{step.inputs || '—'}</td>
                            <td className="px-3 py-2 text-gray-600 align-top whitespace-nowrap">{step.outputs || '—'}</td>
                            <td className="px-3 py-2 text-center align-top text-xs text-gray-700">{step.responsible || '—'}</td>
                            <td className="px-3 py-2 text-center align-top text-xs text-gray-700">{step.accountable || '—'}</td>
                            <td className="px-3 py-2 text-center align-top text-xs text-gray-700">{step.consulted || '—'}</td>
                            <td className="px-3 py-2 text-center align-top text-xs text-gray-700">{step.informed || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}

          {/* ── POLICY ── */}
          {policyData && (
            <>
              <section>
                <h3 className="text-sm font-bold uppercase tracking-wider text-blue-700 border-b border-blue-200 pb-1 mb-3">
                  Purpose
                </h3>
                <p className="text-sm text-gray-600">{policyData.purpose}</p>
              </section>

              <section>
                <h3 className="text-sm font-bold uppercase tracking-wider text-blue-700 border-b border-blue-200 pb-1 mb-3">
                  Scope
                </h3>
                <p className="text-sm text-gray-600">{policyData.scope}</p>
              </section>

              {policyData.sections?.map((section, idx) => (
                <section key={idx}>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-blue-700 border-b border-blue-200 pb-1 mb-3">
                    {section.title}
                  </h3>
                  {Array.isArray(section.content) ? (
                    <ul className="list-disc list-inside space-y-1">
                      {section.content.map((item, i) => (
                        <li key={i} className="text-sm text-gray-600">{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-600">{section.content}</p>
                  )}
                </section>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
