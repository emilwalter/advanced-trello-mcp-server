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

// Optional shared-secret auth: if MCP_ACCESS_TOKEN is set, require it on MCP endpoints
const mcpAccessToken = process.env.MCP_ACCESS_TOKEN;
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
	if (!mcpAccessToken) return next();
	const auth = req.headers.authorization;
	const token = auth?.startsWith('Bearer ') ? auth.slice(7) : req.headers['x-mcp-token'];
	if (token === mcpAccessToken) return next();
	res.status(401).json({ error: 'Unauthorized. Provide Authorization: Bearer <token> or X-MCP-Token header.' });
};

// Cloud Run health check
app.get('/_ah/health', (_req, res) => {
	res.status(200).send('OK');
});

// MCP endpoints - remote clients connect here (protected when MCP_ACCESS_TOKEN is set)
app.post('/mcp', requireAuth, statelessHandler(() => createTrelloMcpServer(credentials)));

// SSE endpoint - Cursor expects /sse for remote MCP (protected when MCP_ACCESS_TOKEN is set)
const sse = sseHandlers(() => createTrelloMcpServer(credentials), {});
app.get('/sse', requireAuth, sse.getHandler);
app.post('/messages', requireAuth, sse.postHandler);

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
