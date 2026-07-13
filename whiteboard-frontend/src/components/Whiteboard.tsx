import React, { useEffect, useRef, useState, useCallback } from 'react';
import './Whiteboard.css';

const Whiteboard: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#000000');
  const [size, setSize] = useState(5);
  const socketRef = useRef<WebSocket | null>(null);
  const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const erasedThisDragRef = useRef<Set<string>>(new Set());

  const [userId] = useState<string>(() => {
    const existing = localStorage.getItem('wb_userId');
    if (existing) return existing;
    const id = (window.crypto && 'randomUUID' in window.crypto) ? (window.crypto as any).randomUUID() : Math.random().toString(36).slice(2);
    localStorage.setItem('wb_userId', id);
    return id;
  });

  type Pt = { x: number; y: number };
  type Stroke = { id: string; userId: string; color: string; size: number; points: Pt[]; createdAt: number; isVisible: boolean };
  const strokesRef = useRef<Map<string, Stroke>>(new Map());
  const orderRef = useRef<string[]>([]);

  const drawFromData = useCallback((data: any) => {
    if (!ctx) return;

    if (data.from && data.to) {
      // line between 2 pts
      ctx.beginPath();
      ctx.lineWidth = data.size;
      ctx.strokeStyle = data.color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(data.from.x, data.from.y);
      ctx.lineTo(data.to.x, data.to.y);
      ctx.stroke();
    } else {
      // single pt
      ctx.beginPath();
      ctx.arc(data.x, data.y, data.size / 2, 0, Math.PI * 2);
      ctx.fillStyle = data.color;
      ctx.fill();
    }
  }, [ctx]);

  const hitTestStroke = (p: { x: number; y: number }): string | null => {
    const threshold = Math.max(8, size);
    const distPt = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
    const distToSeg = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
      const A = px - x1, B = py - y1, C = x2 - x1, D = y2 - y1;
      const dot = A * C + B * D;
      const len_sq = C * C + D * D;
      let t = len_sq ? dot / len_sq : -1;
      t = Math.max(0, Math.min(1, t));
      const xx = x1 + t * C;
      const yy = y1 + t * D;
      return Math.hypot(px - xx, py - yy);
    };
    for (let i = orderRef.current.length - 1; i >= 0; i--) {
      const id = orderRef.current[i];
      const s = strokesRef.current.get(id);
      if (!s || !s.isVisible) continue;
      const pts = s.points;
      if (pts.length === 1) {
        if (distPt(p, pts[0]) <= threshold + s.size / 2) return id;
      } else {
        for (let j = 1; j < pts.length; j++) {
          const d = distToSeg(p.x, p.y, pts[j - 1].x, pts[j - 1].y, pts[j].x, pts[j].y);
          if (d <= threshold + s.size / 2) return id;
        }
      }
    }
    return null;
  };

  const renderAllVisibleStrokes = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const id of orderRef.current) {
      const s = strokesRef.current.get(id);
      if (!s || !s.isVisible) continue;
      if (s.points.length === 1) {
        const p = s.points[0];
        ctx.beginPath();
        ctx.arc(p.x, p.y, s.size / 2, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.lineWidth = s.size;
        ctx.strokeStyle = s.color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i++) {
          ctx.lineTo(s.points[i].x, s.points[i].y);
        }
        ctx.stroke();
      }
    }
  }, [ctx]);

  useEffect(() => {
    const connectWebSocket = () => {
      const WS_URL = (process.env.REACT_APP_WS_URL as string)
      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      socket.onopen = () => {
        console.log('connected to ws');
        setIsConnected(true);
      };

      socket.onclose = () => {
        setIsConnected(false);
        console.log('disconnected from ws');
        setTimeout(connectWebSocket, 3000);
      };

      socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          switch (message.type) {
            case 'hello':
              // user id, todo add user stuff
              break;

            case 'load-strokes': {
              strokesRef.current.clear();
              orderRef.current = [];
              const arr = (message.data || []) as any[];
              for (const s of arr) {
                strokesRef.current.set(s.id, s);
                orderRef.current.push(s.id);
              }
              renderAllVisibleStrokes();
              break;
            }
            case 'load-drawings':
              if (ctx && message.data) {
                message.data.forEach((drawing: any) => {
                  drawFromData(drawing);
                });
              }
              break;

            case 'draw':
              if (ctx) {
                drawFromData(message.data);
              }
              break;

            case 'stroke:added': {
              const s = message.data as any;
              strokesRef.current.set(s.id, s);
              orderRef.current.push(s.id);
              if (s.isVisible) {
                if (s.points.length === 1) {
                  const p = s.points[0];
                  ctx?.beginPath();
                  if (ctx) {
                    ctx.arc(p.x, p.y, s.size / 2, 0, Math.PI * 2);
                    ctx.fillStyle = s.color;
                    ctx.fill();
                  }
                } else if (ctx) {
                  ctx.beginPath();
                  ctx.lineWidth = s.size;
                  ctx.strokeStyle = s.color;
                  ctx.lineCap = 'round';
                  ctx.lineJoin = 'round';
                  ctx.moveTo(s.points[0].x, s.points[0].y);
                  for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
                  ctx.stroke();
                }
              }
              break;
            }

            case 'stroke:hidden': {
              const id = message.strokeId as string;
              const s = strokesRef.current.get(id);
              if (s) s.isVisible = false;
              renderAllVisibleStrokes();
              break;
            }

            case 'stroke:shown': {
              const id = message.strokeId as string;
              const s = strokesRef.current.get(id);
              if (s) s.isVisible = true;
              renderAllVisibleStrokes();
              break;
            }

            case 'clear':
              for (const id of orderRef.current) {
                const s = strokesRef.current.get(id);
                if (s) s.isVisible = false;
              }
              renderAllVisibleStrokes();
              break;
          }
        } catch (err) {
          console.error('error parsing ws msg: ', err);
        }
      };
    };

    connectWebSocket();

    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [ctx, drawFromData, renderAllVisibleStrokes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const container = canvas.parentElement;
      if (container) {
        const rect = container.getBoundingClientRect();

        const context = canvas.getContext('2d');
        const imageData = context?.getImageData(0, 0, canvas.width, canvas.height);

        canvas.width = rect.width;
        canvas.height = rect.height;

        if (context) {
          context.lineCap = 'round';
          context.lineJoin = 'round';
          context.strokeStyle = color;
          context.lineWidth = size;
        }

        if (imageData && context) {
          context.putImageData(imageData, 0, 0);
        }
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const context = canvas.getContext('2d');
    if (!context) return;

    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = color;
    context.lineWidth = size;
    setCtx(context);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [ctx, color, size]);

  useEffect(() => {
    if (ctx) {
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.fillStyle = color;
    }
  }, [ctx, color, size]);


  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const coords = getCoordinates(e);
    if (!coords || !ctx) return;

    const { x, y } = coords;
    if (tool === 'eraser') {
      setIsDrawing(true);
      const hitId = hitTestStroke({ x, y });
      if (hitId && !erasedThisDragRef.current.has(hitId) && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        erasedThisDragRef.current.add(hitId);
        socketRef.current.send(JSON.stringify({ type: 'stroke:delete', userId, strokeId: hitId }));
      }
    } else {
      setIsDrawing(true);
    }

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineWidth = size;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    //local shenanigans
    if (tool === 'pen') {
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN && tool === 'pen') {
      socketRef.current.send(JSON.stringify({
        type: 'draw',
        data: { x, y, color, size }
      }));
    }

    prevPoint.current = { x, y };

    currentStrokeRef.current = tool === 'pen' ? {
      id: (window.crypto && 'randomUUID' in window.crypto) ? (window.crypto as any).randomUUID() : Math.random().toString(36).slice(2),
      userId,
      color,
      size,
      points: [{ x, y }],
      createdAt: Date.now(),
      isVisible: true
    } : null;
  };

  const prevPoint = useRef<{ x: number, y: number } | null>(null);
  const currentStrokeRef = useRef<any>(null);

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !ctx || !prevPoint.current) return;

    if (tool === 'eraser') {
      const coords = getCoordinates(e);
      if (!coords) return;
      const { x, y } = coords;
      const from = prevPoint.current;
      const dx = x - from.x;
      const dy = y - from.y;
      const dist = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.floor(dist / 5));
      for (let i = 1; i <= steps; i++) {
        const sx = from.x + (dx * i) / steps;
        const sy = from.y + (dy * i) / steps;
        const hitId = hitTestStroke({ x: sx, y: sy });
        if (hitId && !erasedThisDragRef.current.has(hitId) && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          erasedThisDragRef.current.add(hitId);
          socketRef.current.send(JSON.stringify({ type: 'stroke:delete', userId, strokeId: hitId }));
        }
      }
      prevPoint.current = { x, y };
      return;
    }

    const coords = getCoordinates(e);
    if (!coords) return;

    const { x, y } = coords;

    ctx.beginPath();
    ctx.lineWidth = size;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(prevPoint.current.x, prevPoint.current.y);
    ctx.lineTo(x, y);
    ctx.stroke();

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN && tool === 'pen') {
      socketRef.current.send(JSON.stringify({
        type: 'draw',
        data: {
          from: { x: prevPoint.current.x, y: prevPoint.current.y },
          to: { x, y },
          color,
          size
        }
      }));
    }

    prevPoint.current = { x, y };
    if (currentStrokeRef.current) {
      currentStrokeRef.current.points.push({ x, y });
    }
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    prevPoint.current = null;
    if (tool === 'pen' && currentStrokeRef.current && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const stroke = currentStrokeRef.current;
      // optimistic local caching
      strokesRef.current.set(stroke.id, stroke);
      orderRef.current.push(stroke.id);
      socketRef.current.send(JSON.stringify({ type: 'stroke:commit', data: stroke }));
    }
    currentStrokeRef.current = null;
    if (tool === 'eraser') {
      erasedThisDragRef.current.clear();
    }
  };

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'clear',
          userId
        }));
      }
    }
  }, [ctx, userId]);

  const sendUndo = useCallback(() => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    if (isDrawing) {
      setIsDrawing(false);
      prevPoint.current = null;
      currentStrokeRef.current = null;
      renderAllVisibleStrokes();
    }
    socketRef.current.send(JSON.stringify({ type: 'history:undo', userId }));
  }, [isDrawing, renderAllVisibleStrokes, userId]);

  const sendRedo = useCallback(() => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: 'history:redo', userId }));
  }, [userId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey && isMac) {
          sendRedo();
        } else {
          sendUndo();
        }
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        sendRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sendRedo, sendUndo]);

  const connectionStatusClass = isConnected ? 'connected' : 'disconnected';

  return (
    <div className="whiteboard-container">
      <div className="toolbar">
        <div className={`connection-status ${connectionStatusClass}`} />
        <span className="connection-text">
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
        <div className="toolbar-spacer" />
        <select value={tool} onChange={(e) => setTool(e.target.value as any)}>
          <option value="pen">Draw</option>
          <option value="eraser">Erase</option>
        </select>
        <button onClick={sendUndo}>Undo</button>
        <button onClick={sendRedo}>Redo</button>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="color-picker"
        />
        <input
          type="range"
          min="1"
          max="20"
          value={size}
          onChange={(e) => setSize(parseInt(e.target.value))}
          className="size-slider"
        />
        <button onClick={clearCanvas}>Clear</button>
      </div>
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseOut={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
        className="whiteboard-canvas"
      />
    </div>
  );
};

export default Whiteboard;
