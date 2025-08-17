export class WhiteboardRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Set();
    // Stroke storage (in-memory for now)
    // strokes: Map<strokeId, Stroke>
    this.strokes = new Map();
    // draw order of strokeIds
    this.order = [];
    // per user history stacks of operations
    // Operation types:
    // { type: 'show', strokeId }
    // { type: 'hide', strokeId }
    // { type: 'clear', strokeIds: string[] }
    this.perUserHistory = new Map();
    this.seq = 0;
  }

  async fetch(request) {
    return await this.handleWebSocket(request);
  }

  async handleWebSocket(request) {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    this.handleSession(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async handleSession(webSocket) {
    webSocket.accept();
    this.sessions.add(webSocket);
    // userid, client can use this if needed
    const sessionId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    try {
      webSocket.send(JSON.stringify({ type: 'hello', sessionId }));
    } catch { }

    try {
      const snapshot = this.order
        .map((id) => this.strokes.get(id))
        .filter(Boolean);
      webSocket.send(JSON.stringify({
        type: 'load-strokes',
        data: snapshot
      }));
    } catch { }

    webSocket.addEventListener('message', async (event) => {
      try {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case 'draw': {
            // transient, just for in progress segments, these dont persist 
            this.broadcast(JSON.stringify({ type: 'draw', data: message.data }));
            break;
          }
          case 'stroke:commit': {
            // on mouse up, now it persists
            const stroke = this.normalizeStroke(message.data);
            if (!stroke) break;
            if (this.strokes.has(stroke.id)) {
              break;
            }
            this.strokes.set(stroke.id, stroke);
            this.order.push(stroke.id);
            this.pushUndoOp(stroke.userId, { type: 'show', strokeId: stroke.id });
            this.clearRedoOps(stroke.userId);
            this.seq++;
            this.broadcast(JSON.stringify({
              type: 'stroke:added',
              data: stroke,
              seq: this.seq
            }));
            break;
          }
          case 'history:undo': {
            const userId = this.safeUserId(message.userId, sessionId);
            const op = this.popUndo(userId);
            if (!op) break;
            this.applyInverseOp(userId, op);
            this.pushRedoOp(userId, op);
            break;
          }
          case 'history:redo': {
            const userId = this.safeUserId(message.userId, sessionId);
            const op = this.popRedoOp(userId);
            if (!op) break;
            this.applyOp(userId, op);
            this.pushUndoOp(userId, op);
            break;
          }
          case 'stroke:delete': {
            const userId = this.safeUserId(message.userId, sessionId);
            const strokeId = String(message.strokeId || '');
            if (!strokeId) break;
            const stroke = this.strokes.get(strokeId);
            if (!stroke || !stroke.isVisible) break;
            stroke.isVisible = false;
            this.clearRedoOps(userId);
            this.pushUndoOp(userId, { type: 'hide', strokeId });
            this.seq++;
            this.broadcast(JSON.stringify({ type: 'stroke:hidden', strokeId, seq: this.seq }));
            break;
          }

          case 'clear': {
            const userId = this.safeUserId(message.userId, sessionId);
            const toHide = [];
            for (const id of this.order) {
              const s = this.strokes.get(id);
              if (s && s.isVisible) {
                s.isVisible = false;
                toHide.push(id);
              }
            }
            this.clearRedoOps(userId);
            if (toHide.length > 0) {
              this.pushUndoOp(userId, { type: 'clear', strokeIds: toHide });
            }
            this.broadcast(JSON.stringify({ type: 'clear' }));
            break;
          }
        }
      } catch (err) {
        console.error('Error parsing message:', err);
      }
    });

    webSocket.addEventListener('close', () => {
      this.sessions.delete(webSocket);
    });

    webSocket.addEventListener('error', (err) => {
      console.error('WebSocket error:', err);
      this.sessions.delete(webSocket);
    });
  }

  broadcast(message) {
    this.sessions.forEach(session => {
      try {
        session.send(message);
      } catch (err) {
        console.error('Error broadcasting:', err);
        this.sessions.delete(session);
      }
    });
  }

  normalizeStroke(data) {
    if (!data || !data.id || !data.userId || !Array.isArray(data.points)) return null;
    const color = typeof data.color === 'string' ? data.color : '#000000';
    const size = Number.isFinite(data.size) ? data.size : 5;
    const createdAt = Number.isFinite(data.createdAt) ? data.createdAt : Date.now();
    const points = data.points
      .map(p => ({ x: Number(p.x), y: Number(p.y) }))
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (points.length === 0) return null;
    return {
      id: String(data.id),
      userId: String(data.userId),
      color,
      size,
      points,
      createdAt,
      isVisible: true
    };
  }

  ensureUserHistory(userId) {
    if (!this.perUserHistory.has(userId)) {
      this.perUserHistory.set(userId, { undo: [], redo: [] });
    }
    return this.perUserHistory.get(userId);
  }

  pushUndoOp(userId, op) {
    const h = this.ensureUserHistory(userId);
    h.undo.push(op);
  }

  pushRedoOp(userId, op) {
    const h = this.ensureUserHistory(userId);
    h.redo.push(op);
  }

  popUndo(userId) {
    const h = this.ensureUserHistory(userId);
    return h.undo.pop() || null;
  }

  popRedoOp(userId) {
    const h = this.ensureUserHistory(userId);
    return h.redo.pop() || null;
  }

  clearRedoOps(userId) {
    const h = this.ensureUserHistory(userId);
    h.redo = [];
  }

  applyOp(userId, op) {
    if (!op) return;
    if (op.type === 'hide') {
      const s = this.strokes.get(op.strokeId);
      if (s && s.isVisible) {
        s.isVisible = false;
        this.seq++;
        this.broadcast(JSON.stringify({ type: 'stroke:hidden', strokeId: op.strokeId, seq: this.seq }));
      }
    } else if (op.type === 'show') {
      const s = this.strokes.get(op.strokeId);
      if (s && !s.isVisible) {
        s.isVisible = true;
        this.seq++;
        this.broadcast(JSON.stringify({ type: 'stroke:shown', strokeId: op.strokeId, seq: this.seq }));
      }
    } else if (op.type === 'clear') {
      const changed = [];
      for (const id of op.strokeIds || []) {
        const s = this.strokes.get(id);
        if (s && s.isVisible) {
          s.isVisible = false;
          changed.push(id);
        }
      }
      if (changed.length) {
        this.broadcast(JSON.stringify({ type: 'clear' }));
      }
    }
  }

  applyInverseOp(userId, op) {
    if (!op) return;
    if (op.type === 'hide') {
      const s = this.strokes.get(op.strokeId);
      if (s && !s.isVisible) {
        s.isVisible = true;
        this.seq++;
        this.broadcast(JSON.stringify({ type: 'stroke:shown', strokeId: op.strokeId, seq: this.seq }));
      }
    } else if (op.type === 'show') {
      const s = this.strokes.get(op.strokeId);
      if (s && s.isVisible) {
        s.isVisible = false;
        this.seq++;
        this.broadcast(JSON.stringify({ type: 'stroke:hidden', strokeId: op.strokeId, seq: this.seq }));
      }
    } else if (op.type === 'clear') {
      const changed = [];
      for (const id of op.strokeIds || []) {
        const s = this.strokes.get(id);
        if (s && !s.isVisible) {
          s.isVisible = true;
          changed.push(id);
        }
      }
      if (changed.length) {
        for (const id of changed) {
          this.seq++;
          this.broadcast(JSON.stringify({ type: 'stroke:shown', strokeId: id, seq: this.seq }));
        }
      }
    }
  }

  safeUserId(maybeUserId, fallback) {
    // if user provides a userid, then trust that one, otherwise use sessionid
    return (typeof maybeUserId === 'string' && maybeUserId) ? maybeUserId : fallback;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Credentials': 'true'
        }
      });
    }

    if (url.pathname === '/ping') {
      return new Response(JSON.stringify({ status: 'pong' }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    if (url.pathname === '/socket.io/' || url.pathname === '/ws') {
      const id = env.WHITEBOARD_ROOM.idFromName('main-room');
      const room = env.WHITEBOARD_ROOM.get(id);
      return room.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  }
};
