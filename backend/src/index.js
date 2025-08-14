export class WhiteboardRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Set();
    this.drawings = [];
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

    webSocket.send(JSON.stringify({
      type: 'load-drawings',
      data: this.drawings
    }));

    webSocket.addEventListener('message', async (event) => {
      try {
        const message = JSON.parse(event.data);
        
        switch (message.type) {
          case 'draw':
            this.drawings.push(message.data);
            this.broadcast(JSON.stringify({
              type: 'draw',
              data: message.data
            }));
            break;
            
          case 'clear':
            this.drawings = [];
            this.broadcast(JSON.stringify({
              type: 'clear'
            }));
            break;
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
