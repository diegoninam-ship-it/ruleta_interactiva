import { useCallback, useEffect } from 'react';
import { useArduinoSerial } from '../hooks/useArduinoSerial';
import { useHandGesture } from '../hooks/useHandGesture';

const INTERVALO_HEARTBEAT_MS = 500;

function colorLog(tipo: string) {
  switch (tipo) {
    case 'tx':
      return 'text-blue-400';
    case 'rx':
      return 'text-emerald-400';
    case 'warn':
      return 'text-red-400';
    default:
      return 'text-slate-400';
  }
}

function badgeGesto(gesto: string | null) {
  if (gesto === 'ABIERTA') {
    return { texto: '✋ abierta', clase: 'bg-emerald-500/15 text-emerald-400 border-emerald-500' };
  }
  if (gesto === 'CERRADA') {
    return { texto: '✊ cerrada', clase: 'bg-red-500/15 text-red-400 border-red-500' };
  }
  return { texto: 'sin mano / ambigua', clase: 'bg-slate-500/15 text-slate-400 border-slate-600' };
}

export default function RuletaControl() {
  const { estado, logs, conectar, desconectar, enviarComando, soportado } = useArduinoSerial();

  // Se envuelve en useCallback para que useHandGesture no reinicie
  // su bucle de detección cada vez que RuletaControl se re-renderiza
  const onGestoConfirmado = useCallback(
    (gesto: 'ABIERTA' | 'CERRADA') => {
      void enviarComando(gesto === 'ABIERTA' ? 'O' : 'C');
    },
    [enviarComando],
  );

  const { videoRef, canvasRef, estadoCamara, gestoActual, iniciarCamara, errorMensaje } =
    useHandGesture({ tiempoEstabilidadMs: 300, onGestoConfirmado });

  // Heartbeat: solo corre mientras el Arduino está conectado
  useEffect(() => {
    if (estado !== 'conectado') return;
    const intervalo = setInterval(() => {
      void enviarComando('H');
    }, INTERVALO_HEARTBEAT_MS);
    return () => clearInterval(intervalo);
  }, [estado, enviarComando]);

  const badge = badgeGesto(gestoActual);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex justify-center px-4 py-8">
      <div className="w-full max-w-2xl space-y-4">
        <div>
          <h1 className="text-xl font-bold">🎯 Ruleta interactiva por gestos</h1>
          <p className="text-slate-400 text-sm mt-1">
            Detecta la mano y controla el Arduino directo desde el navegador.
          </p>
        </div>

        {!soportado && (
          <div className="bg-red-500/10 border border-red-500 rounded-lg p-3 text-sm text-red-300">
            ⚠️ Este navegador no soporta Web Serial API. Ábrelo en Chrome o Edge.
          </div>
        )}

        {/* Cámara y detección */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <label className="text-slate-400 text-sm block mb-2">Cámara y detección</label>
          <div className="relative w-full max-w-md mx-auto rounded-lg overflow-hidden bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full block scale-x-[-1]"
            />
            <canvas
              ref={canvasRef}
              className="absolute top-0 left-0 w-full h-full scale-x-[-1]"
            />
          </div>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <button
              onClick={() => void iniciarCamara()}
              disabled={estadoCamara === 'activa' || estadoCamara === 'cargando'}
              className="bg-blue-600 hover:opacity-85 disabled:opacity-35 disabled:cursor-not-allowed
                         text-white text-sm font-semibold px-4 py-2 rounded-lg"
            >
              {estadoCamara === 'cargando' ? 'Cargando...' : '🎥 Iniciar cámara'}
            </button>
            <span className={`text-sm font-bold px-3 py-1 rounded-full border ${badge.clase}`}>
              {badge.texto}
            </span>
          </div>
          {errorMensaje && (
            <p className="text-red-400 text-sm mt-2">Error de cámara: {errorMensaje}</p>
          )}
        </div>

        {/* Conexión Arduino */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                estado === 'conectado' ? 'bg-emerald-400' : 'bg-red-400'
              }`}
            />
            <span className="text-slate-400 text-sm">
              {estado === 'conectado'
                ? 'Arduino conectado'
                : estado === 'conectando'
                  ? 'Conectando...'
                  : 'Arduino desconectado'}
            </span>
          </div>
          <div className="flex gap-3 mt-3">
            <button
              onClick={() => void conectar()}
              disabled={estado !== 'desconectado' || !soportado}
              className="flex-1 bg-blue-600 hover:opacity-85 disabled:opacity-35 disabled:cursor-not-allowed
                         text-white text-sm font-semibold px-4 py-2 rounded-lg"
            >
              🔌 Conectar Arduino
            </button>
            <button
              onClick={() => void desconectar()}
              disabled={estado !== 'conectado'}
              className="flex-1 bg-red-600 hover:opacity-85 disabled:opacity-35 disabled:cursor-not-allowed
                         text-white text-sm font-semibold px-4 py-2 rounded-lg"
            >
              Desconectar
            </button>
          </div>
        </div>

        {/* Consola */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <label className="text-slate-400 text-sm block mb-2">Consola serial</label>
          <div className="bg-black border border-slate-800 rounded-lg p-3 h-48 overflow-y-auto font-mono text-xs space-y-0.5">
            {logs.map((entry, i) => (
              <div key={i} className={colorLog(entry.tipo)}>
                [{entry.hora}] {entry.texto}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}