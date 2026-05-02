/**
 * King of App MCP Server — Streamable HTTP Transport (MCP spec 2025-03-26)
 *
 * Endpoints:
 *   POST /mcp      → Streamable HTTP (claude.ai, modern clients)
 *   GET  /mcp      → SSE stream for existing sessions
 *   DELETE /mcp    → terminate session
 *   GET  /sse      → legacy SSE (Claude Desktop older configs)
 *   POST /messages → legacy SSE messages
 *   GET  /health   → healthcheck
 */

import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { registerTools } from './tools.js';

const PORT       = process.env.PORT       || 3000;
const MCP_SECRET = process.env.MCP_SECRET || null;

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-mcp-secret', 'mcp-session-id'],
  exposedHeaders: ['mcp-session-id']
}));

app.use(express.json({ limit: '50mb' }));

function checkSecret(req, res, next) {
  if (!MCP_SECRET) return next();
  const provided = req.headers['x-mcp-secret'] || req.query.secret;
  if (provided !== MCP_SECRET) return res.status(401).json({ error: 'Invalid or missing x-mcp-secret header' });
  next();
}

function createMcpServer() {
  const server = new McpServer({ name: 'koapp-mcp', version: '1.0.1' });
  registerTools(server);
  return server;
}

// ── Streamable HTTP sessions (claude.ai / modern clients) ─────────────────────
const streamableSessions = new Map(); // sessionId → StreamableHTTPServerTransport

app.post('/mcp', checkSecret, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];

  const body = req.body;

  if (body?.method === 'tools/call' && body?.params?.name) {
    const args = body?.params?.arguments || {};
    const name = body.params.name;
    if (name === 'koapp_list_templates' || name === 'koapp_login') {
      console.log(`[raw-call] tool=${name} token_len=${args.token?.length ?? 'MISSING'} token_start=${args.token?.substring(0, 15) ?? 'N/A'}`);
    }
  }

  try {
    if (sessionId && streamableSessions.has(sessionId)) {
      const transport = streamableSessions.get(sessionId);
      await transport.handleRequest(req, res, body);
      return;
    }

    if (!sessionId && isInitializeRequest(body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) streamableSessions.delete(sid);
        console.log(`[${new Date().toISOString()}] 🔌 Streamable closed: ${sid} | active: ${streamableSessions.size}`);
      };

      await transport.handleRequest(req, res, body);

      if (transport.sessionId) {
        streamableSessions.set(transport.sessionId, transport);
        console.log(`[${new Date().toISOString()}] ✅ Streamable session: ${transport.sessionId} | active: ${streamableSessions.size}`);
      }
      return;
    }

    res.status(400).json({ error: 'Missing mcp-session-id or not an initialize request' });
  } catch (e) {
    console.error('[POST /mcp] error:', e.message, e.stack);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

app.get('/mcp', checkSecret, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !streamableSessions.has(sessionId))
    return res.status(404).json({ error: 'Session not found' });
  const transport = streamableSessions.get(sessionId);
  await transport.handleRequest(req, res);
});

app.delete('/mcp', checkSecret, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !streamableSessions.has(sessionId))
    return res.status(404).json({ error: 'Session not found' });
  const transport = streamableSessions.get(sessionId);
  await transport.close();
  streamableSessions.delete(sessionId);
  res.status(200).json({ message: 'Session terminated' });
});

// ── Legacy SSE (Claude Desktop / older clients) ───────────────────────────────
const sseSessions = new Map(); // sessionId → SSEServerTransport

app.get('/sse', checkSecret, async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  sseSessions.set(transport.sessionId, transport);

  console.log(`[${new Date().toISOString()}] ✅ SSE session: ${transport.sessionId} | active: ${sseSessions.size}`);

  req.on('close', () => {
    sseSessions.delete(transport.sessionId);
    console.log(`[${new Date().toISOString()}] 🔌 SSE closed: ${transport.sessionId} | active: ${sseSessions.size}`);
  });

  const mcpServer = createMcpServer();
  await mcpServer.connect(transport);
});

app.post('/messages', checkSecret, async (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: 'Missing ?sessionId' });
  const transport = sseSessions.get(sessionId);
  if (!transport) return res.status(404).json({ error: `Session "${sessionId}" not found` });
  await transport.handlePostMessage(req, res, req.body);
});

// ── Health & info ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({
  status: 'ok', service: 'koapp-mcp', version: '1.0.1',
  activeSessions: streamableSessions.size + sseSessions.size,
  timestamp: new Date().toISOString()
}));

app.get('/', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    name: 'King of App MCP Server',
    version: '1.0.1',
    endpoints: {
      streamable_http: `${base}/mcp`,
      legacy_sse: `${base}/sse`
    },
    tools: 15,
    auth: MCP_SECRET ? 'Required — header: x-mcp-secret' : 'Open (dev mode)'
  });
});

app.use((err, req, res, next) => {
  console.error('[Express error]', err.status, err.type, err.message);
  if (err.status === 400) return res.status(400).json({ error: err.message || 'Bad Request' });
  next(err);
});

app.listen(PORT, () => {
  console.log('');
  console.log('🚀 King of App MCP Server');
  console.log(`   Port:      ${PORT}`);
  console.log(`   Streamable HTTP: http://localhost:${PORT}/mcp`);
  console.log(`   Legacy SSE:      http://localhost:${PORT}/sse`);
  console.log(`   Health:          http://localhost:${PORT}/health`);
  console.log(`   API URL:   ${process.env.KOAPP_API_URL || '⚠️  KOAPP_API_URL not set'}`);
  console.log(`   Auth:      ${MCP_SECRET ? '🔒 MCP_SECRET active' : '⚠️  No MCP_SECRET (dev mode)'}`);
  console.log('');
});

export default app;
