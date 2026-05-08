import { useState, useEffect, useRef } from 'react';
import { 
  Send, Bot, User, FileText, AlertCircle, Loader2,
  BookOpen, Settings, Search, Paperclip, X, FileUp, Trash2, Upload
} from 'lucide-react';

const getApiKey = () => {
  try {
    return import.meta.env.VITE_GEMINI_API_KEY || "";
  } catch {
    console.warn("Environment tidak mendukung import.meta.env secara langsung.");
    return "";
  }
};

const API_KEY = getApiKey(); 
const MODEL_NAME = "gemini-2.5-flash";
const FILES_API_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const STORAGE_KEY = "procureai_knowledge_files";
const IDB_NAME = "procureai_kb";
const IDB_STORE = "files";

const openKbDatabase = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(IDB_STORE);
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
};

const saveFileToIDB = async (id, file) => {
  const db = await openKbDatabase();
  const tx = db.transaction(IDB_STORE, "readwrite");
  tx.objectStore(IDB_STORE).put({ blob: file, name: file.name, type: file.type, size: file.size }, id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
};

const getFileFromIDB = async (id) => {
  const db = await openKbDatabase();
  const tx = db.transaction(IDB_STORE, "readonly");
  const request = tx.objectStore(IDB_STORE).get(id);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

const deleteFileFromIDB = async (id) => {
  const db = await openKbDatabase();
  const tx = db.transaction(IDB_STORE, "readwrite");
  tx.objectStore(IDB_STORE).delete(id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
};

const uploadFileToGemini = async (file) => {
  if (!API_KEY) throw new Error("API Key belum di-set.");

  const blob = file instanceof Blob ? file : new Blob([file]);
  const fileName = file.name || "document";
  const fileType = file.type || "application/octet-stream";
  const fileSize = blob.size;

  const initResponse = await fetch(`${FILES_API_URL}?key=${API_KEY}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": fileSize.toString(),
      "X-Goog-Upload-Header-Content-Type": fileType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: fileName } }),
  });

  if (!initResponse.ok) {
    const errText = await initResponse.text();
    throw new Error(`Upload gagal (init): ${errText}`);
  }

  const uploadUrl = initResponse.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Tidak dapat upload URL dari Gemini.");

  const arrayBuffer = await blob.arrayBuffer();

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": fileSize.toString(),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: arrayBuffer,
  });

  if (!uploadResponse.ok) {
    const errText = await uploadResponse.text();
    throw new Error(`Upload gagal (finalize): ${errText}`);
  }

  const result = await uploadResponse.json();
  return result.file;
};

const deleteFileFromGemini = async (fileName) => {
  if (!API_KEY) return;
  try {
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${API_KEY}`,
      { method: "DELETE" }
    );
  } catch {
    // File mungkin sudah expired, abaikan error
  }
};

const App = () => {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Halo Arief! Sekarang lo bisa upload dokumen PTK-007 atau file pengadaan ke Knowledge Base (sidebar kiri), dan gue bakal otomatis merujuk ke dokumen itu tiap kali lo nanya. Mau mulai dari mana?'
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [attachedFile, setAttachedFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [knowledgeFiles, setKnowledgeFiles] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored);
      const now = Date.now();
      const valid = parsed.filter(f => f.expirationTime && new Date(f.expirationTime).getTime() > now);
      if (valid.length !== parsed.length) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
      }
      return valid;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }
  });
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [isReUploading, setIsReUploading] = useState(false);
  
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const kbFileInputRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const saveKnowledgeFiles = (files) => {
    setKnowledgeFiles(files);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
  };

  const handleKbUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (kbFileInputRef.current) kbFileInputRef.current.value = '';

    setIsUploading(true);
    setUploadError(null);

    try {
      const uploaded = await uploadFileToGemini(file);
      const idbId = `kb_${Date.now()}_${file.name}`;
      await saveFileToIDB(idbId, file);
      const fileInfo = {
        name: uploaded.name,
        displayName: uploaded.displayName,
        mimeType: uploaded.mimeType,
        uri: uploaded.uri,
        sizeBytes: uploaded.sizeBytes,
        expirationTime: uploaded.expirationTime,
        uploadedAt: new Date().toISOString(),
        idbId,
      };
      saveKnowledgeFiles([...knowledgeFiles, fileInfo]);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleKbDelete = async (index) => {
    const file = knowledgeFiles[index];
    await deleteFileFromGemini(file.name);
    if (file.idbId) {
      await deleteFileFromIDB(file.idbId).catch(() => {});
    }
    const updated = knowledgeFiles.filter((_, i) => i !== index);
    saveKnowledgeFiles(updated);
  };

  const ensureFilesActive = async () => {
    if (knowledgeFiles.length === 0) return knowledgeFiles;
    const now = Date.now();
    let needsUpdate = false;
    const refreshed = [];

    for (const file of knowledgeFiles) {
      const expired = file.expirationTime && new Date(file.expirationTime).getTime() <= now;
      if (!expired) {
        refreshed.push(file);
        continue;
      }
      if (!file.idbId) {
        needsUpdate = true;
        continue;
      }
      const stored = await getFileFromIDB(file.idbId).catch(() => null);
      if (!stored) {
        needsUpdate = true;
        continue;
      }
      const blob = stored.blob instanceof Blob ? stored.blob : new Blob([stored.blob], { type: stored.type });
      const reFile = new File([blob], stored.name, { type: stored.type });
      const uploaded = await uploadFileToGemini(reFile);
      refreshed.push({
        ...file,
        name: uploaded.name,
        uri: uploaded.uri,
        expirationTime: uploaded.expirationTime,
        uploadedAt: new Date().toISOString(),
      });
      needsUpdate = true;
    }

    if (needsUpdate) {
      saveKnowledgeFiles(refreshed);
    }
    return refreshed;
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

  const fetchGeminiResponse = async (userQuery, file) => {
    if (!API_KEY) {
      throw new Error("API Key belum terdeteksi. Pastikan file .env.local sudah benar, Rief!");
    }

    setIsReUploading(true);
    let activeFiles;
    try {
      activeFiles = await ensureFilesActive();
    } catch {
      activeFiles = knowledgeFiles;
    } finally {
      setIsReUploading(false);
    }

    const kbContext = activeFiles.length > 0
      ? `\nAnda memiliki akses ke ${activeFiles.length} dokumen referensi yang sudah di-upload oleh user. Gunakan informasi dari dokumen tersebut untuk menjawab pertanyaan.`
      : "";

    const systemPrompt = `Anda adalah ahli pengadaan (Procurement Expert) hulu migas Indonesia berdasarkan PTK-007 Revisi 05.
Gaya bahasa: Santai, informatif, panggil user "Arief".
Fokus pada solusi yang sesuai aturan hukum dan pedoman SCM.${kbContext}`;

    let parts = [];

    // Tambahkan referensi file Knowledge Base
    for (const kbFile of activeFiles) {
      parts.push({
        fileData: {
          fileUri: kbFile.uri,
          mimeType: kbFile.mimeType,
        }
      });
    }

    // Tambahkan file attachment dari chat (inline image)
    if (file && file.type.startsWith('image/')) {
      const base64Data = await fileToBase64(file);
      parts.push({
        inlineData: {
          mimeType: file.type,
          data: base64Data
        }
      });
    }

    parts.push({ text: userQuery || "Analisis file ini berdasarkan pedoman PTK-007." });

    const payload = {
      contents: [{ role: "user", parts }],
      systemInstruction: { parts: [{ text: systemPrompt }] }
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error?.message || 'Gagal konek ke Gemini.');
    }
    
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "Maaf Rief, gue agak pusing bacanya. Bisa diulang?";
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
      const aiResponse = await fetchGeminiResponse(userMessage, currentFile);
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
                  Belum ada dokumen. Upload file sekali — akan tersimpan permanen dan otomatis di-upload ulang ke Gemini kalau expired.
                </p>
              )}

              {knowledgeFiles.map((file, idx) => (
                <div key={idx} className="flex items-center gap-2 p-2 bg-white/5 rounded-xl group">
                  <FileText size={14} className="text-blue-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-slate-300 truncate">{file.displayName}</p>
                    <p className="text-[9px] text-slate-500">{formatFileSize(file.sizeBytes)}</p>
                  </div>
                  <button
                    onClick={() => handleKbDelete(idx)}
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
                accept=".pdf,.doc,.docx,.txt,.csv,.xls,.xlsx,.png,.jpg,.jpeg"
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
                {isReUploading ? "Re-upload dokumen expired ke Gemini..." : "Sabar ya Rief, lagi buka-buka jilid PTK-007 nih..."}
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
            <p className="text-center text-[10px] text-slate-700 mt-4 font-black uppercase tracking-[0.3em]">SCM Analytics Engine v2.0</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
