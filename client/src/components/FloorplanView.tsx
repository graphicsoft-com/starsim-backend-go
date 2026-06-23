/**
 * FloorplanView — 3D GLB floorplan viewer.
 *
 * - Lazy-loaded from Dashboard (Three.js bundle only downloads on first switch)
 * - GLB streams progressively with a loading overlay (important for 42 MB file)
 * - OrbitControls: left-drag to orbit, right-drag to pan, scroll to zoom
 */

import { Suspense, useRef, useCallback, useState, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  useGLTF,
  Html,
  useProgress,
  Center,
  Environment,
} from '@react-three/drei';
import * as THREE from 'three';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { RoomStatus } from '../hooks/useRoomStatus';

// ─── Mesh name → room ID mapping (discovered from GLB console logs) ───────────
const MESH_TO_ROOM: Record<string, string> = {
  Text003: 'room1',
  Text002: 'room2',
  Text001: 'room3',
  Text: 'room4',
  Text004: 'room6',
  Text005: 'room8',
};

// ─── Microphone mesh → room ID mapping ───────────────────────────────────────
const MIC_MESH_TO_ROOM: Record<string, string> = {
  'unnamed_(2)svg003': 'room1',
  'unnamed_(2)svg001': 'room2',
  'unnamed_(2)svg002': 'room3',
  'unnamed_(2)svg004': 'room4',
  'unnamed_(2)svg005': 'room6',
  'unnamed_(2)svg006': 'room8',
};

// ─── Audio live-listen helpers ────────────────────────────────────────────────
const AUDIO_SERVER_URL =
  import.meta.env['VITE_AUDIO_SERVER_URL'] ||
  import.meta.env['VITE_SONO_SERVER_URL'] ||
  'http://localhost:3003';

const LIVE_LISTEN_FALLBACK_MESSAGE =
  'Having problems listening. Please make sure Sona is online.';

interface LiveStreamInfoResponse {
  error?: string;
  message?: string;
  sensor?: { isOnline?: boolean };
  stream?: {
    socket?: { url?: string | null; path?: string };
    subscription?: {
      subscribeEvent?: string;
      unsubscribeEvent?: string;
      audioEvent?: string;
      subscribedEvent?: string;
    };
    audioFormat?: { sampleRate?: number };
  };
}

function getSensorIdFromRoomId(roomId: string): number | null {
  const m = roomId.match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

// R3F 9.x uses THREE.Clock internally which Three.js r169+ marks as deprecated.
// Suppress the known warning until @react-three/fiber ships a fix.
const _warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('THREE.Clock')) return;
  _warn(...args);
};

// Start fetching the GLB as soon as this module is imported (first mode switch)
useGLTF.preload('/floorplan.glb');

// ─── Types ────────────────────────────────────────────────────────────────────

interface FloorplanViewProps {
  rooms: RoomStatus[];
  /** Override the default mesh→room mapping if needed. */
  meshToRoom?: Record<string, string>;
  /** Microphone meshes → room IDs for live-listen (wired in next step). */
  micMeshToRoom?: Record<string, string>;
}

// ─── Loading overlay (rendered inside Canvas via Html) ────────────────────────

function LoadingOverlay() {
  const { progress } = useProgress();
  return (
    <Html center>
      <div
        style={{
          background: 'rgba(15,23,42,0.9)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '12px',
          padding: '20px 28px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '10px',
          minWidth: '200px',
          backdropFilter: 'blur(8px)',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ color: '#94a3b8', fontSize: '13px' }}>
          Loading floorplan…
        </span>
        <div
          style={{
            width: '160px',
            height: '4px',
            background: 'rgba(255,255,255,0.1)',
            borderRadius: '2px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: '100%',
              background: '#6366f1',
              borderRadius: '2px',
              transition: 'width 0.15s ease',
            }}
          />
        </div>
        <span style={{ color: '#475569', fontSize: '11px' }}>
          {Math.round(progress)}%
        </span>
      </div>
    </Html>
  );
}

// ─── The GLB model ────────────────────────────────────────────────────────────

const HIGHLIGHT_COLOR = new THREE.Color(0x6366f1); // indigo — selected room
const HOVER_COLOR = new THREE.Color(0xf59e0b); // amber  — hovered room
const MIC_HOVER_COLOR = new THREE.Color(0x22c55e); // green  — hovered mic
const MIC_ACTIVE_COLOR = new THREE.Color(0x15803d); // green  — active mic listen
const DEFAULT_EMISSIVE = new THREE.Color(0x000000);

function FloorModel({
  selectedMesh,
  hoveredMesh,
  listeningMesh,
  meshToRoom,
  micMeshToRoom,
  onMeshClick,
  onMeshHover,
}: {
  selectedMesh: string | null;
  hoveredMesh: string | null;
  listeningMesh: string | null;
  meshToRoom: Record<string, string>;
  micMeshToRoom: Record<string, string>;
  onMeshClick: (name: string) => void;
  onMeshHover: (name: string | null) => void;
}) {
  const { scene } = useGLTF('/floorplan.glb');
  const meshMapRef = useRef<Record<string, THREE.Mesh>>({});

  // Clone materials for every interactive mesh (room + mic) so changes are isolated.
  useEffect(() => {
    const names: string[] = [];
    const map: Record<string, THREE.Mesh> = {};
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || !obj.name) return;
      names.push(obj.name);
      if (meshToRoom[obj.name] || micMeshToRoom[obj.name]) {
        obj.material = Array.isArray(obj.material)
          ? obj.material.map((m: THREE.Material) => m.clone())
          : (obj.material as THREE.Material).clone();
        map[obj.name] = obj;
      }
    });
    meshMapRef.current = map;
    console.log('[FloorplanView] mesh names in GLB:', names);
  }, [scene, meshToRoom, micMeshToRoom]);

  useEffect(() => {
    const applyEmissive = (
      mesh: THREE.Mesh,
      color: THREE.Color,
      intensity: number,
    ) => {
      const mats = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const mat of mats) {
        if (!mat || !('emissive' in mat)) continue;
        const m = mat as THREE.MeshStandardMaterial;
        m.emissive.copy(color);
        m.emissiveIntensity = intensity;
      }
    };

    Object.values(meshMapRef.current).forEach((mesh) =>
      applyEmissive(mesh, DEFAULT_EMISSIVE, 0),
    );

    // Room: selected > hovered
    if (selectedMesh && meshMapRef.current[selectedMesh])
      applyEmissive(meshMapRef.current[selectedMesh], HIGHLIGHT_COLOR, 0.4);
    if (
      hoveredMesh &&
      meshToRoom[hoveredMesh] &&
      hoveredMesh !== selectedMesh &&
      meshMapRef.current[hoveredMesh]
    )
      applyEmissive(meshMapRef.current[hoveredMesh], HOVER_COLOR, 0.35);

    // Mic: active listening > hovered
    if (listeningMesh && meshMapRef.current[listeningMesh])
      applyEmissive(meshMapRef.current[listeningMesh], MIC_ACTIVE_COLOR, 0.55);
    if (
      hoveredMesh &&
      micMeshToRoom[hoveredMesh] &&
      hoveredMesh !== listeningMesh &&
      meshMapRef.current[hoveredMesh]
    )
      applyEmissive(meshMapRef.current[hoveredMesh], MIC_HOVER_COLOR, 0.35);
  }, [selectedMesh, hoveredMesh, listeningMesh, meshToRoom, micMeshToRoom]);

  return (
    <Center>
      <primitive
        object={scene}
        onClick={(e: {
          stopPropagation: () => void;
          object: THREE.Object3D;
        }) => {
          e.stopPropagation();
          if (e.object.name) {
            console.log('[FloorplanView] clicked mesh:', e.object.name);
            onMeshClick(e.object.name);
          }
        }}
        onPointerOver={(e: {
          stopPropagation: () => void;
          object: THREE.Object3D;
        }) => {
          e.stopPropagation();
          const name = e.object.name;
          if (meshToRoom[name] || micMeshToRoom[name]) {
            document.body.style.cursor = 'pointer';
            onMeshHover(name);
          }
        }}
        onPointerOut={(e: { object: THREE.Object3D }) => {
          const name = e.object.name;
          if (meshToRoom[name] || micMeshToRoom[name]) {
            document.body.style.cursor = 'auto';
            onMeshHover(null);
          }
        }}
      />
    </Center>
  );
}

// ─── Wires up the reset callback from inside Canvas (needs useThree) ──────────

const DEFAULT_POSITION: [number, number, number] = [0, 12, 18];

function CameraController({
  controlsRef,
  onResetReady,
}: {
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  onResetReady: (fn: () => void) => void;
}) {
  const { camera } = useThree();

  const reset = useCallback(() => {
    camera.position.set(...DEFAULT_POSITION);
    camera.lookAt(0, 0, 0);
    controlsRef.current?.reset();
  }, [camera, controlsRef]);

  // Expose the reset function to the parent on every render (stable ref)
  onResetReady(reset);

  return null;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function FloorplanView(props: FloorplanViewProps) {
  const {
    meshToRoom = MESH_TO_ROOM,
    micMeshToRoom: micMap = MIC_MESH_TO_ROOM,
  } = props;
  const navigate = useNavigate();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const resetFnRef = useRef<(() => void) | null>(null);
  const [resetHovered, setResetHovered] = useState(false);
  const [selectedMesh, setSelectedMesh] = useState<string | null>(null);
  const [hoveredMesh, setHoveredMesh] = useState<string | null>(null);

  // ── Live-listen state & refs ─────────────────────────────────────────────
  const [listeningRoomId, setListeningRoomId] = useState<string | null>(null);
  const [listeningMesh, setListeningMesh] = useState<string | null>(null);
  const [isListenBusy, setIsListenBusy] = useState(false);
  const [listenError, setListenError] = useState<string | null>(null);
  const isListeningRef = useRef(false);
  const liveSocketRef = useRef<Socket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);
  const unsubscribeEventRef = useRef('leave-live');
  const liveSensorIdRef = useRef<number | null>(null);

  function stopListen() {
    const socket = liveSocketRef.current;
    if (socket) {
      if (liveSensorIdRef.current != null)
        socket.emit(unsubscribeEventRef.current, liveSensorIdRef.current);
      socket.disconnect();
    }
    liveSocketRef.current = null;
    liveSensorIdRef.current = null;
    const ctx = audioContextRef.current;
    if (ctx) void ctx.close();
    audioContextRef.current = null;
    nextPlayTimeRef.current = 0;
    isListeningRef.current = false;
    setListeningRoomId(null);
    setListeningMesh(null);
    setIsListenBusy(false);
    setListenError(null);
  }

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      liveSocketRef.current?.disconnect();
      void audioContextRef.current?.close();
    };
  }, []);

  function playLiveChunk(chunk: unknown) {
    const ctx = audioContextRef.current;
    if (!ctx || !isListeningRef.current) return;
    let ab: ArrayBuffer | null = null;
    if (chunk instanceof ArrayBuffer) {
      ab = chunk;
    } else if (ArrayBuffer.isView(chunk)) {
      const v = chunk as ArrayBufferView;
      ab = new Uint8Array(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))
        .buffer as ArrayBuffer;
    } else if (
      typeof chunk === 'object' &&
      chunk !== null &&
      'type' in chunk &&
      (chunk as { type: string }).type === 'Buffer' &&
      'data' in chunk &&
      Array.isArray((chunk as { data: unknown[] }).data)
    ) {
      ab = new Uint8Array((chunk as { data: number[] }).data).buffer;
    }
    if (!ab) return;
    const int16 = new Int16Array(ab);
    if (!int16.length) return;
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
    const buf = ctx.createBuffer(1, float32.length, ctx.sampleRate);
    buf.copyToChannel(float32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    if (nextPlayTimeRef.current < now + 0.05)
      nextPlayTimeRef.current = now + 0.1;
    src.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += buf.duration;
  }

  async function startListen(roomId: string, meshName: string) {
    if (isListenBusy) return;
    if (listeningRoomId === roomId) {
      stopListen();
      return;
    }
    if (listeningRoomId) stopListen();

    const sensorId = getSensorIdFromRoomId(roomId);
    if (sensorId == null) {
      setListenError('Invalid room → sensor mapping');
      return;
    }

    setIsListenBusy(true);
    setListenError(null);
    liveSensorIdRef.current = sensorId;

    try {
      const resp = await fetch(
        `${AUDIO_SERVER_URL}/audio/api/live/${sensorId}`,
      );
      const payload = (await resp.json()) as LiveStreamInfoResponse;
      if (!resp.ok)
        throw new Error(
          payload.error || payload.message || LIVE_LISTEN_FALLBACK_MESSAGE,
        );
      if (payload.sensor?.isOnline === false) {
        setListenError('Sona Offline');
        setIsListenBusy(false);
        return;
      }

      const stream = payload.stream;
      const socketUrl = (stream?.socket?.url ?? AUDIO_SERVER_URL) as string;
      const socketPath = stream?.socket?.path ?? '/socket.io/';
      const subscribeEvent =
        stream?.subscription?.subscribeEvent ?? 'join-live';
      unsubscribeEventRef.current =
        stream?.subscription?.unsubscribeEvent ?? 'leave-live';
      const audioEvent = stream?.subscription?.audioEvent ?? 'audio-chunk';
      const subscribedEvent =
        stream?.subscription?.subscribedEvent ?? 'live-subscribed';
      const sampleRate = stream?.audioFormat?.sampleRate ?? 16000;

      const AudioCtx =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) throw new Error('Web Audio not supported.');
      const ctx = new AudioCtx({ sampleRate });
      if (ctx.state === 'suspended') await ctx.resume();
      audioContextRef.current = ctx;
      nextPlayTimeRef.current = ctx.currentTime + 0.2;

      const socket = io(socketUrl, {
        transports: ['websocket'],
        path: socketPath,
        reconnectionAttempts: 5,
      });
      liveSocketRef.current = socket;

      socket.on('connect', () => socket.emit(subscribeEvent, sensorId));
      socket.on(subscribedEvent, () => {
        isListeningRef.current = true;
        setListeningRoomId(roomId);
        setListeningMesh(meshName);
        setIsListenBusy(false);
        setListenError(null);
      });
      socket.on('live-error', (err: { error?: string }) => {
        setListenError(err?.error ?? 'Live audio error');
        isListeningRef.current = false;
        setListeningRoomId(null);
        setListeningMesh(null);
        setIsListenBusy(false);
        void audioContextRef.current?.close();
        audioContextRef.current = null;
        nextPlayTimeRef.current = 0;
        socket.disconnect();
        liveSocketRef.current = null;
      });
      socket.on(audioEvent, playLiveChunk);
      socket.on('disconnect', () => {
        isListeningRef.current = false;
        setListeningRoomId(null);
        setListeningMesh(null);
      });
    } catch (error) {
      stopListen();
      setListenError(
        error instanceof Error ? error.message : LIVE_LISTEN_FALLBACK_MESSAGE,
      );
      setIsListenBusy(false);
    }
  }

  const handleMeshClick = useCallback(
    (meshName: string) => {
      // Mic mesh → toggle live listen
      if (micMap[meshName]) {
        void startListen(micMap[meshName], meshName);
        return;
      }
      // Room label → navigate
      const roomId = meshToRoom[meshName];
      if (roomId) {
        navigate(`/oid?room=${roomId}`);
        return;
      }
      // Unmapped → info panel
      setSelectedMesh((prev) => (prev === meshName ? null : meshName));
    },
    // Re-create when listen state changes so toggle logic reads fresh values
    [meshToRoom, micMap, navigate, listeningRoomId, isListenBusy],
  );

  return (
    <div
      className="w-full rounded-2xl border border-border overflow-hidden"
      style={{ height: '70vh', position: 'relative' }}
    >
      <Canvas
        camera={{ position: DEFAULT_POSITION, fov: 45, near: 0.1, far: 2000 }}
        gl={{ antialias: true }}
        shadows="percentage"
      >
        <color attach="background" args={['#0f172a']} />

        <ambientLight intensity={0.5} />
        <directionalLight
          position={[15, 25, 15]}
          intensity={1.5}
          castShadow
          shadow-mapSize={[2048, 2048]}
        />
        <directionalLight position={[-10, 15, -10]} intensity={0.4} />

        <Suspense fallback={<LoadingOverlay />}>
          <FloorModel
            selectedMesh={selectedMesh}
            hoveredMesh={hoveredMesh}
            listeningMesh={listeningMesh}
            meshToRoom={meshToRoom}
            micMeshToRoom={micMap}
            onMeshClick={handleMeshClick}
            onMeshHover={setHoveredMesh}
          />
          <Environment preset="city" />
        </Suspense>

        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping
          dampingFactor={0.06}
          maxPolarAngle={Math.PI / 2.05}
        />

        <CameraController
          controlsRef={controlsRef}
          onResetReady={(fn) => {
            resetFnRef.current = fn;
          }}
        />
      </Canvas>

      {/* Live-listen status bar — top center */}
      {(listeningRoomId || isListenBusy || listenError) && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            background: 'rgba(15,23,42,0.92)',
            border: `1px solid ${
              listenError
                ? 'rgba(239,68,68,0.45)'
                : isListenBusy
                  ? 'rgba(245,158,11,0.3)'
                  : 'rgba(34,197,94,0.4)'
            }`,
            borderRadius: '10px',
            padding: '7px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            backdropFilter: 'blur(8px)',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              flexShrink: 0,
              background: listenError
                ? '#ef4444'
                : isListenBusy
                  ? '#f59e0b'
                  : '#22c55e',
            }}
          />
          <span style={{ color: '#e2e8f0', fontSize: '12px', fontWeight: 500 }}>
            {listenError
              ? listenError
              : isListenBusy
                ? 'Connecting…'
                : `Listening · ${listeningRoomId}`}
          </span>
          <button
            onClick={stopListen}
            style={{
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '6px',
              color: '#f87171',
              fontSize: '10px',
              fontWeight: 600,
              padding: '2px 8px',
              cursor: 'pointer',
            }}
          >
            Stop
          </button>
        </div>
      )}

      {/* Live-listen status bar — top center */}
      {(listeningRoomId || isListenBusy || listenError) && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            background: 'rgba(15,23,42,0.92)',
            border: `1px solid ${
              listenError
                ? 'rgba(239,68,68,0.45)'
                : isListenBusy
                  ? 'rgba(245,158,11,0.3)'
                  : 'rgba(34,197,94,0.4)'
            }`,
            borderRadius: '10px',
            padding: '7px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            backdropFilter: 'blur(8px)',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              flexShrink: 0,
              background: listenError
                ? '#ef4444'
                : isListenBusy
                  ? '#f59e0b'
                  : '#22c55e',
            }}
          />
          <span style={{ color: '#e2e8f0', fontSize: '12px', fontWeight: 500 }}>
            {listenError
              ? listenError
              : isListenBusy
                ? 'Connecting…'
                : `Listening · ${listeningRoomId}`}
          </span>
          <button
            onClick={stopListen}
            style={{
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '6px',
              color: '#f87171',
              fontSize: '10px',
              fontWeight: 600,
              padding: '2px 8px',
              cursor: 'pointer',
            }}
          >
            Stop
          </button>
        </div>
      )}

      {/* Selection panel — top right */}
      {selectedMesh && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 10,
            background: 'rgba(15,23,42,0.88)',
            border: '1px solid rgba(99,102,241,0.35)',
            borderRadius: '10px',
            padding: '12px 14px',
            minWidth: '200px',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '8px',
            }}
          >
            <span
              style={{
                color: '#6366f1',
                fontSize: '10px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              Selected part
            </span>
            <button
              onClick={() => setSelectedMesh(null)}
              title="Deselect"
              style={{
                background: 'none',
                border: 'none',
                color: '#475569',
                cursor: 'pointer',
                fontSize: '13px',
                lineHeight: 1,
                padding: 0,
              }}
            >
              ✕
            </button>
          </div>

          <div
            style={{
              color: '#e2e8f0',
              fontSize: '12px',
              fontFamily: 'monospace',
              marginBottom: '8px',
              wordBreak: 'break-all',
            }}
          >
            {selectedMesh}
          </div>

          {meshToRoom[selectedMesh] ? (
            <>
              <div
                style={{
                  color: '#94a3b8',
                  fontSize: '11px',
                  marginBottom: '10px',
                }}
              >
                Room:{' '}
                <span style={{ color: '#a5b4fc' }}>
                  {meshToRoom[selectedMesh]}
                </span>
              </div>
              <button
                onClick={() =>
                  navigate(`/oid?room=${meshToRoom[selectedMesh]}`)
                }
                style={{
                  width: '100%',
                  padding: '6px 0',
                  background: '#6366f1',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Open room
              </button>
            </>
          ) : (
            <div style={{ color: '#475569', fontSize: '10px' }}>
              Unmapped — add to{' '}
              <code style={{ color: '#64748b' }}>MESH_TO_ROOM</code>
            </div>
          )}
        </div>
      )}

      {/* Reset camera button — bottom left */}
      <button
        onClick={() => resetFnRef.current?.()}
        title="Reset camera"
        onMouseEnter={() => setResetHovered(true)}
        onMouseLeave={() => setResetHovered(false)}
        style={{
          position: 'absolute',
          bottom: 12,
          left: 12,
          background: 'rgba(15,23,42,0.75)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '8px',
          color: resetHovered ? '#e2e8f0' : '#94a3b8',
          fontSize: '11px',
          padding: '5px 10px',
          cursor: 'pointer',
          backdropFilter: 'blur(6px)',
          transition: 'color 0.15s',
          zIndex: 10,
        }}
      >
        ⟳ Reset view
      </button>
    </div>
  );
}
