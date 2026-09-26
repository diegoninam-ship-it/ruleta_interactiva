import { useCallback, useEffect, useRef, useState } from 'react';

// ---------- Tipos ----------
export type EstadoConexion = 'desconectado' | 'conectando' | 'conectado';

export interface LogEntry {
  hora: string;
  texto: string;
  tipo: 'tx' | 'rx' | 'sys' | 'warn';
}

interface UseArduinoSerialResult {
  estado: EstadoConexion;
  logs: LogEntry[];
  conectar: () => Promise<void>;
  desconectar: () => Promise<void>;
  enviarComando: (comando: string) => Promise<void>;
  soportado: boolean;
}

const BAUD_RATE = 9600;
const MAX_LOGS = 200; // evita que la lista crezca sin límite en una demo larga

export function useArduinoSerial(): UseArduinoSerialResult {
  const [estado, setEstado] = useState<EstadoConexion>('desconectado');
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Refs porque estos objetos no deben disparar un re-render al cambiar
  const portRef = useRef<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
  const keepReadingRef = useRef(false);

  const soportado = typeof navigator !== 'undefined' && 'serial' in navigator;

  const agregarLog = useCallback((texto: string, tipo: LogEntry['tipo'] = 'sys') => {
    const hora = new Date().toLocaleTimeString('es-PE', { hour12: false });
    setLogs((prev) => {
      const siguiente = [...prev, { hora, texto, tipo }];
      return siguiente.length > MAX_LOGS ? siguiente.slice(-MAX_LOGS) : siguiente;
    });
  }, []);

  const iniciarLectura = useCallback(
    async (port: SerialPort) => {
      keepReadingRef.current = true;
      const decoder = new TextDecoderStream();
      const cierrePromesa = port.readable!.pipeTo(decoder.writable);
      const reader = decoder.readable.getReader();
      readerRef.current = reader;

      let buffer = '';
      try {
        while (keepReadingRef.current) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            buffer += value;
            let idx: number;
            while ((idx = buffer.indexOf('\n')) >= 0) {
              const linea = buffer.slice(0, idx).replace('\r', '').trim();
              buffer = buffer.slice(idx + 1);
              if (linea) agregarLog(linea, 'rx');
            }
          }
        }
      } catch (err) {
        if (keepReadingRef.current) {
          agregarLog('Error de lectura: ' + (err as Error).message, 'warn');
        }
      } finally {
        await cierrePromesa.catch(() => {});
      }
    },
    [agregarLog],
  );

  const conectar = useCallback(async () => {
    if (!soportado) {
      agregarLog('Web Serial API no disponible en este navegador.', 'warn');
      return;
    }
    setEstado('conectando');
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: BAUD_RATE });
      portRef.current = port;
      setEstado('conectado');
      agregarLog(`Puerto abierto a ${BAUD_RATE} baudios.`, 'sys');
      // No se espera esta promesa: la lectura corre en paralelo mientras el hook sigue vivo
      void iniciarLectura(port);
    } catch (err) {
      setEstado('desconectado');
      agregarLog('Error al conectar: ' + (err as Error).message, 'warn');
    }
  }, [soportado, agregarLog, iniciarLectura]);

  const desconectar = useCallback(async () => {
    keepReadingRef.current = false;
    try {
      if (readerRef.current) {
        await readerRef.current.cancel();
        readerRef.current.releaseLock();
        readerRef.current = null;
      }
      if (portRef.current) {
        await portRef.current.close();
        portRef.current = null;
      }
    } catch (err) {
      agregarLog('Aviso al cerrar: ' + (err as Error).message, 'warn');
    }
    setEstado('desconectado');
    agregarLog('Puerto cerrado.', 'sys');
  }, [agregarLog]);

  const enviarComando = useCallback(
    async (comando: string) => {
      const port = portRef.current;
      if (!port || !port.writable) {
        agregarLog('No hay puerto abierto.', 'warn');
        return;
      }
      const writer = port.writable.getWriter();
      try {
        await writer.write(new TextEncoder().encode(comando));
        agregarLog(comando, 'tx');
      } catch (err) {
        agregarLog('Error al enviar: ' + (err as Error).message, 'warn');
      } finally {
        writer.releaseLock();
      }
    },
    [agregarLog],
  );

  // Cierra el puerto si el componente que usa el hook se desmonta con la conexión abierta
  useEffect(() => {
    return () => {
      if (portRef.current) {
        keepReadingRef.current = false;
        portRef.current.close().catch(() => {});
      }
    };
  }, []);

  return { estado, logs, conectar, desconectar, enviarComando, soportado };
}