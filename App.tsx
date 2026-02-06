
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { DeviceStatus, Message } from './types';
import { NEXUS_TOOLS, SYSTEM_INSTRUCTION } from './constants';
import { getBatteryInfo, getPosition, triggerVibration, shareText, getDeviceInfo } from './services/deviceService';

// Utility functions
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  const [isLive, setIsLive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [isTermux, setIsTermux] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>({
    batteryLevel: 0,
    isCharging: false,
    latitude: null,
    longitude: null,
    orientation: { alpha: 0, beta: 0, gamma: 0 },
    motion: {
      acceleration: { x: 0, y: 0, z: 0 },
      rotationRate: { alpha: 0, beta: 0, gamma: 0 }
    },
    lastAction: 'Standby'
  });
  const [hardwareInfo, setHardwareInfo] = useState<any>(null);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);

  useEffect(() => {
    // Detect if running on localhost (common for Termux)
    setIsTermux(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    const updateStats = async () => {
      const battery = await getBatteryInfo();
      setDeviceStatus(prev => ({
        ...prev,
        batteryLevel: battery.level,
        isCharging: battery.charging
      }));
      setHardwareInfo(getDeviceInfo());
    };

    const handleOrientation = (e: DeviceOrientationEvent) => {
      setDeviceStatus(prev => ({
        ...prev,
        orientation: { alpha: e.alpha, beta: e.beta, gamma: e.gamma }
      }));
    };

    const handleMotion = (e: DeviceMotionEvent) => {
      setDeviceStatus(prev => ({
        ...prev,
        motion: {
          acceleration: { x: e.acceleration?.x ?? 0, y: e.acceleration?.y ?? 0, z: e.acceleration?.z ?? 0 },
          rotationRate: { alpha: e.rotationRate?.alpha ?? 0, beta: e.rotationRate?.beta ?? 0, gamma: e.rotationRate?.gamma ?? 0 }
        }
      }));
    };

    updateStats();
    const interval = setInterval(updateStats, 10000);
    window.addEventListener('deviceorientation', handleOrientation);
    window.addEventListener('devicemotion', handleMotion);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('deviceorientation', handleOrientation);
      window.removeEventListener('devicemotion', handleMotion);
    };
  }, []);

  const handleLiveToggle = useCallback(async () => {
    if (isLive) {
      if (sessionRef.current) {
        sessionRef.current.close();
        sessionRef.current = null;
      }
      setIsLive(false);
      setAudioLevel(0);
      return;
    }

    try {
      const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || '' });
      
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      if (!outputAudioContextRef.current) {
        outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }

      if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
        await (DeviceMotionEvent as any).requestPermission();
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
          tools: [{ functionDeclarations: NEXUS_TOOLS }],
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        },
        callbacks: {
          onopen: () => {
            setIsLive(true);
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
              setAudioLevel(Math.sqrt(sum / inputData.length) * 100);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              const pcmBlob = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
              source.onended = () => sourcesRef.current.delete(source);
            }
            if (message.serverContent?.inputTranscription) {
               setTranscript(prev => [...prev.slice(-10), `User: ${message.serverContent!.inputTranscription!.text}`]);
               setIsProcessing(true);
            }
            if (message.serverContent?.outputTranscription) {
               setTranscript(prev => [...prev.slice(-10), `Nexus: ${message.serverContent!.outputTranscription!.text}`]);
               setIsProcessing(false);
            }
            if (message.toolCall) {
              setIsProcessing(true);
              for (const fc of message.toolCall.functionCalls) {
                let result: any = "ok";
                setDeviceStatus(prev => ({ ...prev, lastAction: `Executing ${fc.name}...` }));
                try {
                  switch (fc.name) {
                    case 'vibrateDevice': triggerVibration(fc.args.pattern as string); result = "Success"; break;
                    case 'getDeviceInfo': setHardwareInfo(getDeviceInfo()); result = getDeviceInfo(); break;
                    case 'getGeolocation': const pos = await getPosition(); setDeviceStatus(prev => ({ ...prev, latitude: pos.lat, longitude: pos.lng })); result = pos; break;
                    case 'sendSystemNotification': if (Notification.permission === 'granted') new Notification(fc.args.title as string, { body: fc.args.message as string }); result = "Sent"; break;
                    case 'shareContent': const shared = await shareText(fc.args.text as string); result = shared; break;
                  }
                } catch (err) { result = `Error: ${err}`; }
                sessionPromise.then(session => session.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result } } }));
              }
              setTimeout(() => setIsProcessing(false), 1000);
            }
          },
          onerror: () => setIsLive(false),
          onclose: () => setIsLive(false)
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) { setIsLive(false); }
  }, [isLive]);

  return (
    <div className="relative h-screen w-full flex flex-col font-mono overflow-hidden bg-black text-sky-400 select-none touch-none">
      <div className="scanline"></div>
      
      {/* Header */}
      <header className="p-4 flex justify-between items-center glass-panel z-20 h-14">
        <div className="flex items-center space-x-2">
          <div className={`w-2 h-2 rounded-full transition-all duration-500 ${isLive ? (isProcessing ? 'bg-white shadow-[0_0_12px_#fff] scale-125' : 'bg-sky-400 shadow-[0_0_8px_#38bdf8]') : 'bg-gray-600'}`}></div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold tracking-widest uppercase leading-none">Nexus OS v3.5</span>
            <span className="text-[7px] text-sky-500/50 uppercase tracking-tighter">
              {isTermux ? 'TERMUX_LOCAL_NODE' : 'REMOTE_WEB_DEPLOY'}
            </span>
          </div>
        </div>
        <button onClick={() => setShowInstallGuide(!showInstallGuide)} className="text-[10px] bg-sky-400/10 px-2 py-1 rounded border border-sky-400/30 flex items-center space-x-1 active:scale-95 transition-all">
          <i className="fas fa-terminal"></i>
          <span>SYSTEM_LOG</span>
        </button>
      </header>

      {/* Main UI */}
      <main className="flex-1 p-3 flex flex-col space-y-3 overflow-hidden relative z-10">
        
        {/* Install/Termux Guide Overlay */}
        {showInstallGuide && (
          <div className="absolute inset-0 z-50 glass-panel flex flex-col p-6 animate-in fade-in slide-in-from-bottom duration-300">
             <div className="flex justify-between items-center mb-6">
               <h2 className="text-lg font-black tracking-widest text-white underline decoration-sky-400 uppercase">System Integration</h2>
               <button onClick={() => setShowInstallGuide(false)} className="text-xl"><i className="fas fa-times"></i></button>
             </div>
             <div className="space-y-4 text-[11px] overflow-y-auto pr-2">
                <div className="bg-sky-400/5 p-4 rounded-lg border border-sky-400/20">
                   <p className="text-sky-100 mb-2 font-bold uppercase"><i className="fas fa-terminal mr-2"></i>Compilación en Termux:</p>
                   <p className="mb-3 text-sky-400/80">Has solicitado compilar en el dispositivo. Sigue estos pasos en tu terminal Android:</p>
                   <div className="bg-black/80 p-3 rounded font-mono text-[9px] text-green-400 border border-green-900/30 overflow-x-auto">
                      <p># 1. Ejecutar el script de setup</p>
                      <p>sh termux-setup.sh</p>
                      <br/>
                      <p># 2. Iniciar el motor Nexus</p>
                      <p>npm start</p>
                   </div>
                </div>
                <div className="bg-sky-400/5 p-4 rounded-lg border border-sky-400/20">
                   <p className="text-sky-100 mb-2 font-bold uppercase"><i className="fas fa-mobile-alt mr-2"></i>Acceso como WebAPK:</p>
                   <p className="text-sky-400/80">Para una experiencia idéntica a una App nativa, usa el menú 'Instalar aplicación' en tu navegador Chrome.</p>
                </div>
                <div className="opacity-50 text-[9px] space-y-1 pt-4 border-t border-sky-900/30">
                   <p>CORE_ENGINE: GEMINI_LIVE_2.5_NATIVE</p>
                   <p>HARDWARE_ACCESS: GRANTED</p>
                   <p>BUILD_HASH: {Math.random().toString(16).slice(2, 10).toUpperCase()}</p>
                </div>
             </div>
             <button onClick={() => setShowInstallGuide(false)} className="mt-6 bg-sky-400 text-black py-3 rounded font-bold tracking-widest active:scale-95 transition-all">CIERRE DE CONSOLA</button>
          </div>
        )}

        {/* Dashboard Grid */}
        <div className="grid grid-cols-2 gap-3 shrink-0">
          <div className="glass-panel p-3 rounded-lg flex flex-col space-y-2 hover:scale-[1.02] active:scale-95 transition-all border-t border-sky-400/20">
            <span className="text-[8px] text-sky-500/50 uppercase tracking-widest flex justify-between">Telemetry <i className="fas fa-bolt animate-pulse"></i></span>
            <div className="space-y-1">
              <div className="flex justify-between text-[9px]"><span className="opacity-50">BATTERY</span> <span className="text-sky-100">{deviceStatus.batteryLevel}%</span></div>
              <div className="flex justify-between text-[9px]"><span className="opacity-50">STATUS</span> <span className="text-sky-100 text-[8px] uppercase">{deviceStatus.isCharging ? 'Charging' : 'Standby'}</span></div>
            </div>
          </div>
          <div className="glass-panel p-3 rounded-lg flex flex-col space-y-2 hover:scale-[1.02] active:scale-95 transition-all border-t border-sky-400/20">
            <span className="text-[8px] text-sky-500/50 uppercase tracking-widest flex justify-between">Sensor <i className="fas fa-crosshairs"></i></span>
            <div className="space-y-1">
              <div className="flex justify-between text-[9px]"><span className="opacity-50">ACCEL</span> <span className="text-sky-100 truncate">{deviceStatus.motion.acceleration.x?.toFixed(1)}</span></div>
              <div className="flex justify-between text-[9px]"><span className="opacity-50">ROT</span> <span className="text-sky-100 truncate">{deviceStatus.orientation.alpha?.toFixed(0)}°</span></div>
            </div>
          </div>
        </div>

        {/* AI Console */}
        <div className={`flex-1 glass-panel rounded-lg p-3 flex flex-col relative overflow-hidden transition-all duration-700 border-l-4 ${isProcessing ? 'border-sky-400 shadow-[0_0_20px_rgba(56,189,248,0.1)]' : 'border-sky-900/50'}`}>
          <div className="flex-1 overflow-y-auto space-y-2 text-[10px] scrollbar-hide">
             {transcript.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-sky-700/40 space-y-3 text-center px-4">
                   <div className="w-12 h-12 rounded-full border border-sky-900/30 flex items-center justify-center animate-pulse">
                      <i className="fas fa-shield-alt text-xl"></i>
                   </div>
                   <p className="tracking-widest font-black uppercase text-[9px]">Nexus Core Secured & Ready</p>
                </div>
             ) : (
                transcript.map((line, idx) => (
                  <div key={idx} className={`p-2 rounded transition-all duration-300 ${line.startsWith('Nexus:') ? 'bg-sky-400/5 text-sky-100 border-l border-sky-400' : 'text-sky-400/60'}`}>
                    <div className="flex items-center space-x-1 mb-1 opacity-20 text-[7px] uppercase font-bold">
                       <i className={`fas ${line.startsWith('Nexus:') ? 'fa-brain' : 'fa-user'}`}></i>
                       <span>{new Date().toLocaleTimeString()}</span>
                    </div>
                    {line}
                  </div>
                ))
             )}
          </div>
        </div>

        {/* Controller */}
        <div className={`glass-panel rounded-2xl p-4 flex flex-col items-center space-y-4 transition-all duration-500 shrink-0 ${isProcessing ? 'bg-sky-400/5 border-sky-400/30' : ''}`}>
           <div className="relative w-28 h-28 flex items-center justify-center">
              <div className={`absolute inset-0 rounded-full border transition-all duration-1000 ${isLive ? (isProcessing ? 'border-white animate-pulse' : 'border-sky-400 animate-ping') : 'border-sky-900/20'}`}></div>
              <div className="flex items-end justify-center space-x-1 h-6 w-20">
                {[...Array(10)].map((_, i) => (
                  <div key={i} className={`w-1 rounded-full transition-all duration-75 ${isProcessing ? 'bg-white' : 'bg-sky-400'}`}
                    style={{ height: isLive ? `${Math.max(10, Math.random() * (isProcessing ? 100 : audioLevel * 2))}%` : '4px', opacity: isLive ? 1 : 0.1 }} />
                ))}
              </div>
              <div className={`absolute bottom-[-0.5rem] text-[7px] tracking-[0.2em] font-black uppercase ${isLive ? (isProcessing ? 'text-white' : 'text-sky-400') : 'text-sky-900'}`}>
                {isLive ? (isProcessing ? 'Processing' : 'Nexus Linked') : 'Standby'}
              </div>
           </div>

           <div className="w-full flex justify-center relative py-1">
              {isLive && <div className={`absolute inset-0 rounded-full blur-xl transition-all duration-300 ${isProcessing ? 'bg-white/20 animate-pulse' : 'bg-sky-400/10 animate-pulse'}`} style={{ transform: `scale(${1 + (audioLevel / 200)})`, opacity: 0.1 + (audioLevel / 100) }} />}
              <button onClick={handleLiveToggle} className={`group relative flex items-center justify-center w-14 h-14 rounded-full transition-all duration-500 border-2 z-10 active:scale-90 ${isLive ? 'bg-red-500/5 border-red-500/50 shadow-[0_0_15px_#ef4444]' : 'bg-sky-500/5 border-sky-400/50 shadow-[0_0_15px_#38bdf8]'}`}>
                <i className={`fas ${isLive ? 'fa-power-off text-red-500' : 'fa-microphone text-sky-400'} text-lg`}></i>
              </button>
           </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="h-10 glass-panel flex items-center px-4 border-t border-sky-400/10 z-20 shrink-0">
        <div className="flex space-x-4 text-[7px] text-sky-500/40 w-full items-center font-bold overflow-hidden">
           <span className="flex items-center space-x-1">
             <span className="text-sky-400">LOG:</span>
             <span className="text-sky-100 truncate max-w-[100px] uppercase">{deviceStatus.lastAction}</span>
           </span>
           <span className="flex items-center space-x-1 ml-auto">
              <div className={`w-1 h-1 rounded-full animate-pulse ${isTermux ? 'bg-green-400' : 'bg-orange-400'}`}></div>
              <span>NEXUS_LINK: {isTermux ? 'LOCAL' : 'REMOTE'}</span>
           </span>
        </div>
      </footer>
    </div>
  );
};

export default App;
