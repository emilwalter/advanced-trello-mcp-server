/**
 * HTTP server for Cloud Run deployment.
 * Exposes MCP over HTTP at POST /mcp for remote clients (e.g. Claude).
 */
import express from 'express';
import { statelessHandler, sseHandlers } from 'express-mcp-handler';
import dotenv from 'dotenv';
import { createTrelloMcpServer } from './server-factory.js';

dotenv.config();

const credentials = {
	apiKey: process.env.TRELLO_API_KEY || '',
	apiToken: process.env.TRELLO_API_TOKEN || '',
};

const app = express();
app.use(express.json({ limit: '10mb' }));

// Cloud Run health check
app.get('/_ah/health', (_req, res) => {
	res.status(200).send('OK');
});

// MCP endpoints - remote clients connect here
app.post('/mcp', statelessHandler(() => createTrelloMcpServer(credentials)));

// SSE endpoint - Cursor expects /sse for remote MCP
const sse = sseHandlers(() => createTrelloMcpServer(credentials), {});
app.get('/sse', sse.getHandler);
app.post('/messages', sse.postHandler);

app.get('/', (_req, res) => {
	res.json({
		name: 'Advanced Trello MCP Server',
		version: '2.0.0',
		status: 'running',
		endpoints: { mcp: '/mcp', sse: '/sse' },
		note: 'Cursor: url to /sse. Claude: claude mcp add --transport http trello <url>/mcp',
	});
});

const PORT = parseInt(process.env.PORT || '8080', 10);
app.listen(PORT, '0.0.0.0', () => {
	console.log(`MCP server on port ${PORT} (POST /mcp, GET /sse)`);
});
