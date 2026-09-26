import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HandLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';

// ---------- Tipos ----------
export type Gesto = 'ABIERTA' | 'CERRADA' | 'AMBIGUA' | null;
export type EstadoCamara = 'inactiva' | 'cargando' | 'activa' | 'error';

interface UseHandGestureOptions {
  /** ms que un gesto debe mantenerse antes de considerarse "confirmado" */
  tiempoEstabilidadMs?: number;
  /** Se llama solo cuando el gesto CONFIRMADO cambia (no en cada fotograma) */
  onGestoConfirmado?: (gesto: 'ABIERTA' | 'CERRADA') => void;
}

interface UseHandGestureResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  estadoCamara: EstadoCamara;
  gestoActual: Gesto; // gesto detectado en el fotograma actual (para mostrar en UI)
  iniciarCamara: () => Promise<void>;
  detenerCamara: () => void;
  errorMensaje: string | null;
}

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

// Conexiones del esqueleto de la mano, igual que en la prueba HTML
const CONEXIONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

function dedosEstirados(landmarks: NormalizedLandmark[]): number {
  const puntas = [8, 12, 16, 20];
  const nudillos = [6, 10, 14, 18];
  let count = 0;
  for (let i = 0; i < puntas.length; i++) {
    if (landmarks[puntas[i]].y < landmarks[nudillos[i]].y) count++;
  }
  if (landmarks[4].x < landmarks[3].x) count++;
  return count;
}

function clasificarGesto(landmarks: NormalizedLandmark[]): Gesto {
  const n = dedosEstirados(landmarks);
  if (n >= 4) return 'ABIERTA';
  if (n <= 1) return 'CERRADA';
  return 'AMBIGUA';
}

export function useHandGesture(options: UseHandGestureOptions = {}): UseHandGestureResult {
  const { tiempoEstabilidadMs = 300, onGestoConfirmado } = options;

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const activaRef = useRef(false);

  // Filtro de estabilidad: se guarda en refs porque no debe disparar re-render
  const gestoConfirmadoRef = useRef<'ABIERTA' | 'CERRADA' | null>(null);
  const gestoCandidatoRef = useRef<Gesto>(null);
  const tiempoCandidatoRef = useRef(0);

  // onGestoConfirmado puede cambiar entre renders; se guarda en ref para no
  // tener que recrear el bucle de detección cada vez que el padre re-renderiza
  const callbackRef = useRef(onGestoConfirmado);
  useEffect(() => {
    callbackRef.current = onGestoConfirmado;
  }, [onGestoConfirmado]);

  const [estadoCamara, setEstadoCamara] = useState<EstadoCamara>('inactiva');
  const [gestoActual, setGestoActual] = useState<Gesto>(null);
  const [errorMensaje, setErrorMensaje] = useState<string | null>(null);

  const dibujarLandmarks = useCallback((landmarks: NormalizedLandmark[] | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!landmarks) return;

    ctx.strokeStyle = '#5b8cff';
    ctx.lineWidth = 2;
    for (const [a, b] of CONEXIONES) {
      ctx.beginPath();
      ctx.moveTo(landmarks[a].x * canvas.width, landmarks[a].y * canvas.height);
      ctx.lineTo(landmarks[b].x * canvas.width, landmarks[b].y * canvas.height);
      ctx.stroke();
    }
    ctx.fillStyle = '#3ecf8e';
    for (const p of landmarks) {
      ctx.beginPath();
      ctx.arc(p.x * canvas.width, p.y * canvas.height, 4, 0, 2 * Math.PI);
      ctx.fill();
    }
  }, []);

  const procesarGesto = useCallback((gesto: Gesto) => {
    const ahora = performance.now();

    if (gesto === 'ABIERTA' || gesto === 'CERRADA') {
      if (gesto !== gestoCandidatoRef.current) {
        gestoCandidatoRef.current = gesto;
        tiempoCandidatoRef.current = ahora;
      } else if (ahora - tiempoCandidatoRef.current >= tiempoEstabilidadMs) {
        if (gestoCandidatoRef.current !== gestoConfirmadoRef.current) {
          gestoConfirmadoRef.current = gestoCandidatoRef.current;
          callbackRef.current?.(gestoCandidatoRef.current);
        }
      }
    } else {
      gestoCandidatoRef.current = null;
    }

    setGestoActual(gesto);
  }, [tiempoEstabilidadMs]);

  const loopDeteccion = useCallback(() => {
    if (!activaRef.current) return;
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;

    if (video && landmarker && video.readyState >= 2) {
      const resultado = landmarker.detectForVideo(video, performance.now());
      if (resultado.landmarks.length > 0) {
        const landmarks = resultado.landmarks[0];
        dibujarLandmarks(landmarks);
        procesarGesto(clasificarGesto(landmarks));
      } else {
        dibujarLandmarks(null);
        procesarGesto(null);
      }
    }
    animationRef.current = requestAnimationFrame(loopDeteccion);
  }, [dibujarLandmarks, procesarGesto]);

  const iniciarCamara = useCallback(async () => {
    setEstadoCamara('cargando');
    setErrorMensaje(null);
    try {
      if (!landmarkerRef.current) {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        landmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 1,
        });
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 360 },
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) throw new Error('Elemento de video no disponible.');
      video.srcObject = stream;
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => resolve();
      });
      await video.play();

      if (canvasRef.current) {
        canvasRef.current.width = video.videoWidth;
        canvasRef.current.height = video.videoHeight;
      }

      activaRef.current = true;
      setEstadoCamara('activa');
      loopDeteccion();
    } catch (err) {
      setEstadoCamara('error');
      setErrorMensaje((err as Error).message);
    }
  }, [loopDeteccion]);

  const detenerCamara = useCallback(() => {
    activaRef.current = false;
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    gestoConfirmadoRef.current = null;
    gestoCandidatoRef.current = null;
    setGestoActual(null);
    setEstadoCamara('inactiva');
  }, []);

  // Libera cámara y modelo si el componente se desmonta con todo activo
  useEffect(() => {
    return () => {
      activaRef.current = false;
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      landmarkerRef.current?.close();
    };
  }, []);

  return {
    videoRef,
    canvasRef,
    estadoCamara,
    gestoActual,
    iniciarCamara,
    detenerCamara,
    errorMensaje,
  };
}