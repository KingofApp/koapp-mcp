/**
 * King of App MCP Server — HTTP + SSE Transport
 *
 * Una sola instancia pública en AWS sirve a todas las agencias.
 * Cada conexión SSE obtiene su propio contexto MCP independiente.
 *
 * Endpoints:
 *   GET  /         → info y guía de conexión
 *   GET  /sse      → abre el stream SSE (la IA se conecta aquí)
 *   POST /messages → la IA envía llamadas a herramientas
 *   GET  /health   → healthcheck para AWS ALB
 */

import express from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { registerTools } from './tools.js';

const PORT       = process.env.PORT       || 3000;
const MCP_SECRET = process.env.MCP_SECRET || null;

const app = express();
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','x-mcp-secret'] }));
app.use(express.json({ limit: '10mb' }));

// ── Auth ──────────────────────────────────────────────────────────────────────
// Las agencias añaden la cabecera:  x-mcp-secret: <MCP_SECRET>
// En desarrollo (sin MCP_SECRET) se omite la verificación.

function checkSecret(req, res, next) {
  if (!MCP_SECRET) return next();
  const provided = req.headers['x-mcp-secret'] || req.query.secret;
  if (provided !== MCP_SECRET) return res.status(401).json({ error: 'Invalid or missing x-mcp-secret header' });
  next();
}

// ── Sesiones activas ──────────────────────────────────────────────────────────
// sessionId → SSEServerTransport
// Cada agencia conectada tiene su propia entrada en este Map.

const sessions = new Map();

// ── GET /health ───────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({
  status: 'ok', service: 'koapp-mcp', version: '1.0.0',
  apiUrl: process.env.KOAPP_API_URL || 'NOT SET',
  activeSessions: sessions.size,
  timestamp: new Date().toISOString()
}));

// ── GET / — guía de conexión ──────────────────────────────────────────────────

app.get('/', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    name: 'King of App MCP Server',
    version: '1.0.0',
    connect: {
      claude_desktop: {
        config: {
          mcpServers: {
            koapp: {
              url: `${base}/sse`,
              headers: MCP_SECRET ? { 'x-mcp-secret': '<your-secret>' } : {}
            }
          }
        }
      },
      openai_gpt: {
        url: `${base}/sse`,
        type: 'sse',
        headers: MCP_SECRET ? { 'x-mcp-secret': '<your-secret>' } : {}
      },
      generic: `Connect any MCP client to ${base}/sse`
    },
    tools: 15,
    auth: MCP_SECRET ? 'Required — header: x-mcp-secret' : 'Open (dev mode — set MCP_SECRET in production)'
  });
});

// ── GET /sse — abre la conexión SSE ──────────────────────────────────────────
// La IA llama a este endpoint primero. Se crea una instancia MCP por conexión.

app.get('/sse', checkSecret, async (req, res) => {
  const mcpServer = new McpServer({
    name: 'koapp-mcp',
    version: '1.0.0',
    description: 'King of App MCP Server — create mobile apps automatically with AI'
  });

  registerTools(mcpServer);

  const transport = new SSEServerTransport('/messages', res);
  sessions.set(transport.sessionId, transport);

  console.log(`[${new Date().toISOString()}] ✅ New session: ${transport.sessionId} | active: ${sessions.size}`);

  req.on('close', () => {
    sessions.delete(transport.sessionId);
    console.log(`[${new Date().toISOString()}] 🔌 Session closed: ${transport.sessionId} | active: ${sessions.size}`);
  });

  await mcpServer.connect(transport);
});

// ── POST /messages — recibe llamadas a herramientas ──────────────────────────
// La IA envía aquí sus tool calls con ?sessionId=<id> en la query.

app.post('/messages', checkSecret, async (req, res) => {
  const { sessionId } = req.query;

  if (!sessionId)
    return res.status(400).json({ error: 'Missing ?sessionId query parameter' });

  const transport = sessions.get(sessionId);
  if (!transport)
    return res.status(404).json({ error: `Session "${sessionId}" not found or expired. Open /sse first.` });

  await transport.handlePostMessage(req, res, req.body);
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('');
  console.log('🚀 King of App MCP Server');
  console.log(`   Port:      ${PORT}`);
  console.log(`   SSE:       http://localhost:${PORT}/sse`);
  console.log(`   Health:    http://localhost:${PORT}/health`);
  console.log(`   API URL:   ${process.env.KOAPP_API_URL || '⚠️  KOAPP_API_URL not set'}`);
  console.log(`   Auth:      ${MCP_SECRET ? '🔒 MCP_SECRET active' : '⚠️  No MCP_SECRET (dev mode)'}`);
  console.log('');
});

export default app;
