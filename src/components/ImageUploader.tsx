'use client';

import { useState, useRef } from 'react';

interface ImageUploaderProps {
  onImageUploaded: (imageBase64: string) => void;
  onDrawioUploaded?: (xmlContent: string, fileName: string) => void;
  onError: (error: string) => void;
}

export default function ImageUploader({ onImageUploaded, onDrawioUploaded, onError }: ImageUploaderProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [drawioFile, setDrawioFile] = useState<{ name: string; content: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const isDrawio = ext === 'drawio' || (ext === 'xml' && file.name.toLowerCase().includes('drawio'));

    if (isDrawio) {
      // Handle draw.io files
      const reader = new FileReader();
      reader.onload = (e) => {
        const xmlContent = e.target?.result as string;
        setDrawioFile({ name: file.name, content: xmlContent });
        setPreviewUrl(null);
        if (onDrawioUploaded) {
          onDrawioUploaded(xmlContent, file.name);
        }
      };
      reader.onerror = () => {
        onError('Failed to read draw.io file');
      };
      reader.readAsText(file);
      return;
    }

    if (!file.type.startsWith('image/')) {
      onError('Please upload an image file (PNG, JPG, etc.) or a .drawio file');
      return;
    }

    // Read file as base64
    const reader = new FileReader();
    reader.onload = (e) => {
      const imageBase64 = e.target?.result as string;
      setPreviewUrl(imageBase64);
      setDrawioFile(null);
      // Just pass the image to parent - no analysis needed here
      onImageUploaded(imageBase64);
    };
    reader.onerror = () => {
      onError('Failed to read image file');
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  const clearImage = () => {
    setPreviewUrl(null);
    setDrawioFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="p-4 bg-white rounded-lg border border-gray-200">
      <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
        <svg className="w-5 h-5" style={{ color: '#0C3B2E' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        Upload Flowchart
      </h3>
      
      <p className="text-sm text-gray-500 mb-4">
        Upload a flowchart image or draw.io file and we&apos;ll analyze it to generate a professional manual.
      </p>

      {!previewUrl && !drawioFile ? (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`
            border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
            ${isDragging 
              ? 'border-[#2EAD6D] bg-[#E8F5EE]' 
              : 'border-gray-300 hover:border-[#2EAD6D] hover:bg-gray-50'
            }
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.drawio,.xml"
            onChange={handleFileSelect}
            className="hidden"
          />
          
          <svg className="w-12 h-12 mx-auto text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          
          <p className="text-gray-600 font-medium">
            {isDragging ? 'Drop file here' : 'Click or drag to upload'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            PNG, JPG, or .drawio files
          </p>
        </div>
      ) : drawioFile ? (
        <div className="relative p-4 bg-[#E8F5EE] rounded-lg border border-[#B8E0CC]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#059669] flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-800">{drawioFile.name}</p>
              <p className="text-xs text-gray-500">Draw.io diagram ready — ask in chat to generate a manual</p>
            </div>
          </div>
          <button
            onClick={clearImage}
            className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white p-1.5 rounded-full shadow-md"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="relative">
          <img
            src={previewUrl!}
            alt="Uploaded flowchart"
            className="w-full rounded-lg border border-gray-200"
          />
          
          <div className="absolute top-2 left-2 text-white px-2 py-1 rounded text-xs font-medium" style={{ background: '#2EAD6D' }}>
            ✓ Image Ready
          </div>
          
          <button
            onClick={clearImage}
            className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white p-1.5 rounded-full shadow-md"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
