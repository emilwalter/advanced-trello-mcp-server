/**
 * HTTP server for Cloud Run deployment.
 * Exposes MCP over HTTP at POST /mcp for remote clients (e.g. Claude).
 * Supports OAuth 2.0 for Claude.ai Settings > Connectors.
 */
import express from 'express';
import { statelessHandler, sseHandlers } from 'express-mcp-handler';
import dotenv from 'dotenv';
import { createTrelloMcpServer } from './server-factory.js';
import { createOAuthRouter } from './oauth/index.js';
import {
	mcpContext,
	getMcpCredentials,
	resolveCredentialsFromRequest,
} from './oauth/context.js';
import { getTrelloTokenForAccessToken } from './oauth/store.js';

dotenv.config();

const staticCredentials = {
	apiKey: process.env.TRELLO_API_KEY || '',
	apiToken: process.env.TRELLO_API_TOKEN || '',
};

const mcpAccessToken = process.env.MCP_ACCESS_TOKEN;
const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || '8080'}`;
const redirectUri = process.env.OAUTH_REDIRECT_URI || `${baseUrl.replace(/\/$/, '')}/auth/trello/callback`;

const app = express();
app.use(express.json({ limit: '10mb' }));

// OAuth 2.0 routes (must be before MCP endpoints)
const oauthRouter = createOAuthRouter({
	trelloApiKey: staticCredentials.apiKey,
	redirectUri,
	baseUrl,
});
app.use(oauthRouter);

// Middleware: resolve credentials per-request and store in AsyncLocalStorage
app.use(async (req, res, next): Promise<void> => {
	const auth = req.headers.authorization;
	const credentials = await resolveCredentialsFromRequest(
		auth,
		(token) => getTrelloTokenForAccessToken(token),
		staticCredentials,
		mcpAccessToken
	);
	mcpContext.run({ credentials: credentials || staticCredentials }, () => next());
});

// MCP auth: require valid credentials (OAuth token or MCP_ACCESS_TOKEN)
const requireMcpAuth = async (req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> => {
	const auth = req.headers.authorization;
	const credentials = await resolveCredentialsFromRequest(
		auth,
		(token) => getTrelloTokenForAccessToken(token),
		staticCredentials,
		mcpAccessToken
	);
	if (!credentials) {
		res.set('WWW-Authenticate', 'Bearer');
		res.status(401).json({
			error: 'Unauthorized',
			error_description: 'Provide Authorization: Bearer <token>. Use OAuth flow or MCP_ACCESS_TOKEN.',
		});
		return;
	}
	mcpContext.run({ credentials }, () => next());
};

// Server factory: uses credentials from request context
const serverFactory = () => {
	const creds = getMcpCredentials();
	return createTrelloMcpServer(creds || staticCredentials);
};

// Cloud Run health check
app.get('/_ah/health', (_req, res) => {
	res.status(200).send('OK');
});

// MCP endpoints
app.post('/mcp', requireMcpAuth, statelessHandler(serverFactory));

// SSE endpoint - Cursor expects /sse for remote MCP
const sse = sseHandlers(serverFactory, {});
app.get('/sse', requireMcpAuth, sse.getHandler);
app.post('/messages', requireMcpAuth, sse.postHandler);

app.get('/', (_req, res) => {
	res.json({
		name: 'Advanced Trello MCP Server',
		version: '2.0.0',
		status: 'running',
		endpoints: { mcp: '/mcp', sse: '/sse' },
		oauth: {
			metadata: '/.well-known/oauth-authorization-server',
			authorize: '/authorize',
			token: '/token',
			register: '/register',
		},
		note: 'Claude: Add via Settings > Connectors with server URL. Cursor: url to /sse with Bearer token.',
	});
});

const PORT = parseInt(process.env.PORT || '8080', 10);
app.listen(PORT, '0.0.0.0', () => {
	console.log(`MCP server on port ${PORT} (POST /mcp, GET /sse, OAuth enabled)`);
});
