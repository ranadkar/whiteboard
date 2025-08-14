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
  // this is connection status

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

      // circle at ends for smooth corners
      ctx.beginPath();
      ctx.arc(data.to.x, data.to.y, data.size / 2, 0, Math.PI * 2);
      ctx.fillStyle = data.color;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(data.to.x, data.to.y);
    } else {
      // single pt
      ctx.beginPath();
      ctx.lineWidth = data.size;
      ctx.strokeStyle = data.color;
      ctx.lineTo(data.x, data.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(data.x, data.y, data.size / 2, 0, Math.PI * 2);
      ctx.fillStyle = data.color;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(data.x, data.y);
    }
  }, [ctx]);

  const clearCanvasLocal = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [ctx]);

  useEffect(() => {
    const connectWebSocket = () => {
      const socket = new WebSocket('wss://whiteboard-backend.mr-raj-nadkarni.workers.dev/ws');
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

            case 'clear':
              clearCanvasLocal();
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
  }, [ctx, drawFromData, clearCanvasLocal]);

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
    setIsDrawing(true);

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineWidth = size;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'draw',
        data: { x, y, color, size }
      }));
    }
  };

  const prevPoint = useRef<{ x: number, y: number } | null>(null);

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !ctx) return;

    const coords = getCoordinates(e);
    if (!coords) return;

    const { x, y } = coords;

    // draw it locally
    ctx.lineTo(x, y);
    ctx.stroke();

    // check for previous point, draw a line between
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      if (prevPoint.current) {
        socketRef.current.send(JSON.stringify({
          type: 'draw',
          data: {
            from: { x: prevPoint.current.x, y: prevPoint.current.y },
            to: { x, y },
            color,
            size
          }
        }));
      } else {
        socketRef.current.send(JSON.stringify({
          type: 'draw',
          data: { x, y, color, size }
        }));
      }
    }

    prevPoint.current = { x, y };
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    prevPoint.current = null;
    if (ctx) {
      ctx.beginPath();
    }
  };

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'clear'
        }));
      }
    }
  }, [ctx]);

  const connectionStatusClass = isConnected ? 'connected' : 'disconnected';

  return (
    <div className="whiteboard-container">
      <div className="toolbar">
        <div className={`connection-status ${connectionStatusClass}`} />
        <span className="connection-text">
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
        <div className="toolbar-spacer" />
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
