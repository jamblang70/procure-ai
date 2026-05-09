import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Send, Bot, User, FileText, AlertCircle, Loader2,
  BookOpen, Settings, Search, Paperclip, X, FileUp, Trash2, Upload
} from 'lucide-react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://api.siswandana.web.id";
const SUPPORTED_EXTENSIONS = ".pdf,.txt,.csv,.html,.md,.png,.jpg,.jpeg,.webp";

const App = () => {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Halo Arief! Sekarang lo bisa upload dokumen PTK-007 atau file pengadaan ke Knowledge Base (sidebar kiri), dan gue bakal otomatis merujuk ke dokumen itu tiap kali lo nanya. File tersimpan permanen di server \u2014 bisa diakses dari browser mana aja. Mau mulai dari mana?'
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [attachedFile, setAttachedFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [knowledgeFiles, setKnowledgeFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const kbFileInputRef = useRef(null);

  const fetchFiles = useCallback(async () => {
    try {
      const resp = await fetch(`${BACKEND_URL}/api/files`);
      if (resp.ok) {
        const data = await resp.json();
        setKnowledgeFiles(data.files || []);
      }
    } catch {
      // Backend mungkin belum ready
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`${BACKEND_URL}/api/files`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (active && data) setKnowledgeFiles(data.files || []); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleKbUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (kbFileInputRef.current) kbFileInputRef.current.value = '';

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const resp = await fetch(`${BACKEND_URL}/api/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.detail || 'Upload gagal');
      }

      await fetchFiles();
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleKbDelete = async (fileId) => {
    try {
      await fetch(`${BACKEND_URL}/api/files/${fileId}`, { method: 'DELETE' });
      await fetchFiles();
    } catch {
      // Ignore delete errors
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setAttachedFile(file);
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => setFilePreview(reader.result);
        reader.readAsDataURL(file);
      } else {
        setFilePreview('document');
      }
    }
  };

  const removeAttachment = () => {
    setAttachedFile(null);
    setFilePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = (error) => reject(error);
    });
  };

  const fetchChatResponse = async (userQuery, file) => {
    const payload = { message: userQuery || "Analisis file ini berdasarkan pedoman PTK-007." };

    if (file && file.type.startsWith('image/')) {
      payload.image_base64 = await fileToBase64(file);
      payload.image_mime_type = file.type;
    }

    const response = await fetch(`${BACKEND_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.detail || 'Gagal konek ke server.');
    }
    
    const data = await response.json();
    return data.response || "Maaf Rief, gue agak pusing bacanya. Bisa diulang?";
  };

  const handleSend = async () => {
    if ((!input.trim() && !attachedFile) || isLoading) return;

    const userMessage = input.trim();
    const currentFile = attachedFile;
    const currentPreview = filePreview;

    setInput('');
    removeAttachment();
    setError(null);
    
    setMessages(prev => [...prev, { 
      role: 'user', 
      content: userMessage || (currentFile ? `[File: ${currentFile.name}]` : ""),
      attachment: currentPreview && currentPreview !== 'document' ? currentPreview : null,
      fileName: currentFile?.name
    }]);
    
    setIsLoading(true);

    try {
      const aiResponse = await fetchChatResponse(userMessage, currentFile);
      setMessages(prev => [...prev, { role: 'assistant', content: aiResponse }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const formatFileSize = (bytes) => {
    const num = parseInt(bytes, 10);
    if (num < 1024) return `${num} B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
    return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex h-screen bg-[#0a0f1e] text-slate-200 font-sans overflow-hidden">
      {/* Sidebar UI */}
      <div className="hidden lg:flex flex-col w-72 bg-[#0d1425] border-r border-white/5 shadow-2xl">
        <div className="p-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-blue-600 p-2 rounded-xl shadow-[0_0_15px_rgba(37,99,235,0.4)]">
              <Bot size={24} className="text-white" />
            </div>
            <h1 className="text-2xl font-black tracking-tighter text-white italic">ProcureAI</h1>
          </div>
          <div className="h-1 w-12 bg-blue-600 rounded-full mb-6"></div>
        </div>

        <div className="flex-1 px-6 space-y-6 overflow-y-auto custom-scrollbar">
          {/* Knowledge Base Section */}
          <div className="space-y-3">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-2">Knowledge Base</p>
            
            <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-3">
              <h2 className="text-xs font-bold flex items-center gap-2 text-blue-400">
                <BookOpen size={14} /> Dokumen Referensi
              </h2>
              
              {knowledgeFiles.length === 0 && (
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Belum ada dokumen. Upload file sekali — tersimpan permanen di server, bisa diakses dari browser mana aja.
                </p>
              )}

              {knowledgeFiles.map((file) => (
                <div key={file.id} className="flex items-center gap-2 p-2 bg-white/5 rounded-xl group">
                  <FileText size={14} className="text-blue-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-slate-300 truncate">{file.display_name}</p>
                    <p className="text-[9px] text-slate-500">{formatFileSize(file.size_bytes)}</p>
                  </div>
                  <button
                    onClick={() => handleKbDelete(file.id)}
                    className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-all p-1"
                    title="Hapus dokumen"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}

              {uploadError && (
                <p className="text-[10px] text-red-400 bg-red-500/10 p-2 rounded-lg">{uploadError}</p>
              )}

              <button
                onClick={() => kbFileInputRef.current?.click()}
                disabled={isUploading}
                className="w-full flex items-center justify-center gap-2 p-3 border border-dashed border-white/10 rounded-xl text-[11px] font-bold text-slate-400 hover:text-blue-400 hover:border-blue-500/30 hover:bg-blue-500/5 transition-all disabled:opacity-50"
              >
                {isUploading ? (
                  <><Loader2 size={14} className="animate-spin" /> Uploading...</>
                ) : (
                  <><Upload size={14} /> Upload Dokumen</>
                )}
              </button>
              <input
                type="file"
                ref={kbFileInputRef}
                onChange={handleKbUpload}
                accept={SUPPORTED_EXTENSIONS}
                className="hidden"
              />
            </div>
          </div>
          
          <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-blue-500/10 border border-white/5">
            <h3 className="text-[11px] font-bold text-emerald-400 mb-1">
              {knowledgeFiles.length > 0 
                ? `${knowledgeFiles.length} dokumen aktif` 
                : "Status: Siap"}
            </h3>
            <p className="text-[10px] text-slate-500 italic">"Cerdas dalam Audit, Tangkas dalam Tender."</p>
          </div>
        </div>

        <div className="p-6 border-t border-white/5 bg-[#0a0f1e]/50 text-center">
          <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">Admin: Arief</p>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 flex flex-col relative">
        <header className="h-16 border-b border-white/5 bg-[#0d1425]/80 backdrop-blur-xl flex items-center justify-between px-8 z-20">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] animate-pulse"></div>
            <span className="text-xs font-bold tracking-widest text-slate-400 uppercase">Procurement Consulting Room</span>
          </div>
          <div className="flex gap-4">
            <button className="text-slate-500 hover:text-white transition-colors"><Search size={18} /></button>
            <button className="text-slate-500 hover:text-white transition-colors"><Settings size={18} /></button>
          </div>
        </header>

        {/* Chat History */}
        <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-8 custom-scrollbar">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex gap-4 md:gap-6 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-xl ${
                msg.role === 'assistant' ? 'bg-blue-600 text-white shadow-blue-500/20' : 'bg-slate-800 text-blue-400 border border-slate-700'
              }`}>
                {msg.role === 'assistant' ? <Bot size={20} /> : <User size={20} />}
              </div>
              <div className={`max-w-[85%] md:max-w-[70%] space-y-2 ${msg.role === 'user' ? 'text-right' : ''}`}>
                <div className={`p-5 rounded-[2rem] text-sm md:text-base leading-relaxed ${
                  msg.role === 'assistant' 
                    ? 'bg-[#161e31] border border-white/5 text-slate-300 rounded-tl-none' 
                    : 'bg-blue-600 text-white rounded-tr-none shadow-lg'
                }`}>
                  {msg.attachment && <img src={msg.attachment} className="mb-4 rounded-xl border border-white/10 max-h-60 object-contain mx-auto" />}
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-4 animate-pulse">
              <div className="w-10 h-10 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center">
                <Loader2 className="animate-spin text-blue-500" size={18} />
              </div>
              <div className="p-4 bg-slate-900/50 rounded-2xl italic text-xs text-slate-500">
                Sabar ya Rief, lagi buka-buka jilid PTK-007 nih...
              </div>
            </div>
          )}
          {error && (
            <div className="flex justify-center">
              <div className="px-4 py-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle size={14} /> {error}
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input UI */}
        <div className="p-6 md:p-10 bg-gradient-to-t from-[#0a0f1e] to-transparent">
          <div className="max-w-4xl mx-auto">
            {filePreview && (
              <div className="mb-4 flex items-center gap-3 p-3 bg-blue-600/10 border border-blue-500/20 rounded-2xl">
                <div className="relative">
                  {filePreview === 'document' ? (
                    <div className="w-12 h-12 bg-slate-800 rounded-lg flex items-center justify-center"><FileUp size={24} className="text-blue-400" /></div>
                  ) : (
                    <img src={filePreview} className="w-12 h-12 object-cover rounded-lg" />
                  )}
                  <button onClick={removeAttachment} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-lg hover:scale-110 transition-all"><X size={12} /></button>
                </div>
                <p className="text-[10px] font-bold text-slate-400 truncate flex-1">{attachedFile?.name}</p>
              </div>
            )}
            
            <div className="relative flex items-end bg-[#161e31] border border-white/5 rounded-[2.5rem] p-2 pr-4 focus-within:border-blue-500/40 focus-within:ring-4 focus-within:ring-blue-500/5 transition-all shadow-2xl">
              <button 
                onClick={() => fileInputRef.current.click()}
                className="p-4 text-slate-500 hover:text-blue-500 transition-colors"
              >
                <Paperclip size={24} />
              </button>
              <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
              
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                placeholder="Tulis kasus pengadaan atau upload screenshot di sini..."
                className="flex-1 bg-transparent border-none py-4 px-2 focus:ring-0 text-sm md:text-base text-slate-200 placeholder:text-slate-600 resize-none max-h-48"
                rows={1}
              />

              <button
                onClick={handleSend}
                disabled={(!input.trim() && !attachedFile) || isLoading}
                className={`mb-1 p-4 rounded-full transition-all ${
                  (input.trim() || attachedFile) && !isLoading 
                    ? 'bg-blue-600 text-white hover:bg-blue-500 hover:scale-105 active:scale-95 shadow-lg shadow-blue-600/20' 
                    : 'bg-slate-800 text-slate-600'
                }`}
              >
                <Send size={20} />
              </button>
            </div>
            <p className="text-center text-[10px] text-slate-700 mt-4 font-black uppercase tracking-[0.3em]">SCM Analytics Engine v3.0</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
