/**
 * OAuth 2.0 Authorization Server for MCP.
 * Enables Claude.ai Settings > Connectors integration.
 *
 * Implements third-party flow: user authorizes with Trello,
 * we issue MCP access tokens bound to their Trello session.
 */
import express from 'express';
import crypto from 'node:crypto';
import {
	storeAuthCode,
	consumeAuthCode,
	storeAccessToken,
	getTrelloTokenForAccessToken,
} from './store.js';

const TRELLO_AUTH_URL = 'https://trello.com/1/authorize';
const CLAUDE_CALLBACK_URL = 'https://claude.ai/api/mcp/auth_callback';

export interface OAuthConfig {
	trelloApiKey: string;
	redirectUri: string; // Our callback, e.g. https://your-server.com/auth/trello/callback
	baseUrl: string; // e.g. https://your-server.com
}

export function createOAuthRouter(config: OAuthConfig): express.Router {
	const router = express.Router();

	// RFC 8414: Authorization Server Metadata
	router.get('/.well-known/oauth-authorization-server', (_req, res) => {
		const base = config.baseUrl.replace(/\/$/, '');
		res.json({
			issuer: base,
			authorization_endpoint: `${base}/authorize`,
			token_endpoint: `${base}/token`,
			registration_endpoint: `${base}/register`,
			response_types_supported: ['code'],
			code_challenge_methods_supported: ['S256'],
			grant_types_supported: ['authorization_code'],
			scopes_supported: ['mcp:read', 'mcp:write'],
		});
	});

	// Dynamic Client Registration (RFC 7591) - optional, Claude can use manual Client ID
	router.post('/register', express.json(), (req, res): void => {
		const { redirect_uris } = req.body || {};
		const redirectUri = Array.isArray(redirect_uris) ? redirect_uris[0] : redirect_uris;
		if (!redirectUri || typeof redirectUri !== 'string') {
			res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uris required' });
			return;
		}
		const allowed = [CLAUDE_CALLBACK_URL, 'https://claude.com/api/mcp/auth_callback'];
		if (!allowed.includes(redirectUri)) {
			res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'Redirect URI not allowed' });
			return;
		}
		const clientId = crypto.randomUUID();
		const clientSecret = crypto.randomBytes(32).toString('base64url');
		res.status(201).json({
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uris: [redirectUri],
			client_id_issued_at: Math.floor(Date.now() / 1000),
		});
	});

	// Authorization endpoint - redirect to Trello
	router.get('/authorize', (req, res): void => {
		const { client_id, redirect_uri, code_challenge, code_challenge_method, state } = req.query;
		if (!redirect_uri || typeof redirect_uri !== 'string') {
			res.status(400).send('Missing redirect_uri');
			return;
		}
		if (!code_challenge || typeof code_challenge !== 'string') {
			res.status(400).send('Missing code_challenge (PKCE required)');
			return;
		}
		// Store for callback - we need to redirect back to Claude's callback with our code
		const stateData = JSON.stringify({
			redirect_uri,
			code_challenge,
			code_challenge_method: code_challenge_method || 'S256',
			state: state || '',
		});
		const trelloAuthUrl = new URL(TRELLO_AUTH_URL);
		trelloAuthUrl.searchParams.set('key', config.trelloApiKey);
		trelloAuthUrl.searchParams.set('scope', 'read,write');
		trelloAuthUrl.searchParams.set('expiration', 'never');
		trelloAuthUrl.searchParams.set('response_type', 'token');
		trelloAuthUrl.searchParams.set('return_url', config.redirectUri);
		trelloAuthUrl.searchParams.set('callback_method', 'fragment');
		trelloAuthUrl.searchParams.set('state', stateData);
		res.redirect(trelloAuthUrl.toString());
	});

	// Trello callback - receives token in fragment, redirects to Claude with our auth code
	router.get('/auth/trello/callback', (req, res): void => {
		// Trello uses fragment - we need a small HTML page to capture it
		// When using callback_method=fragment, Trello redirects to return_url#token=xxx
		// Our return_url is this endpoint - but Express can't read fragment from server
		// Trello docs: "fragment should be used for redirects. When fragment is passed,
		// Trello redirects the user to the specified return_url with the token in the URL's hash."
		// So the client (browser) gets the redirect with hash. We need to serve a page
		// that reads the hash and POSTs to a server endpoint, or we use a different approach.
		//
		// Alternative: use Trello's response_type=token with return_url - the token comes
		// in the fragment. We must serve an HTML page that:
		// 1. Parses window.location.hash for token
		// 2. Sends token to our backend
		// 3. Backend creates auth code, redirects to Claude callback
		const stateData = req.query.state;
		if (!stateData || typeof stateData !== 'string') {
			res.status(400).send('Missing state');
			return;
		}
		let state: { redirect_uri: string; code_challenge: string; code_challenge_method: string; state: string };
		try {
			state = JSON.parse(stateData);
		} catch {
			res.status(400).send('Invalid state');
			return;
		}
		// Serve HTML that captures fragment and completes the flow
		res.send(`
<!DOCTYPE html>
<html>
<head><title>Connecting to Claude</title></head>
<body>
<p>Completing authorization...</p>
<script>
(function() {
  var hash = window.location.hash.slice(1);
  var params = new URLSearchParams(hash);
  var token = params.get('token');
  var error = params.get('error');
  if (error) {
    document.body.innerHTML = '<p>Authorization failed: ' + error + '</p>';
    return;
  }
  if (!token) {
    document.body.innerHTML = '<p>No token received from Trello. Please try again.</p>';
    return;
  }
  fetch('/auth/trello/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: token, state: ${JSON.stringify(stateData)} })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.redirect) {
      window.location.href = data.redirect;
    } else {
      document.body.innerHTML = '<p>Error: ' + (data.error || 'Unknown') + '</p>';
    }
  })
  .catch(function(e) {
    document.body.innerHTML = '<p>Error: ' + e.message + '</p>';
  });
})();
</script>
</body>
</html>
		`);
	});

	// Internal: receive Trello token from JS, create auth code, return redirect URL
	router.post('/auth/trello/complete', express.json(), async (req, res): Promise<void> => {
		const { token: trelloToken, state: stateData } = req.body || {};
		if (!trelloToken || !stateData) {
			res.status(400).json({ error: 'Missing token or state' });
			return;
		}
		let state: { redirect_uri: string; code_challenge: string; code_challenge_method: string; state: string };
		try {
			state = JSON.parse(stateData);
		} catch {
			res.status(400).json({ error: 'Invalid state' });
			return;
		}
		const authCode = crypto.randomBytes(32).toString('base64url');
		await storeAuthCode(authCode, trelloToken, state.code_challenge);
		const redirectUrl = new URL(state.redirect_uri);
		redirectUrl.searchParams.set('code', authCode);
		redirectUrl.searchParams.set('state', state.state);
		res.json({ redirect: redirectUrl.toString() });
	});

	// Token endpoint - exchange code for access token
	router.post('/token', express.urlencoded({ extended: true }), express.json(), async (req, res): Promise<void> => {
		const body = req.body || {};
		const grantType = body.grant_type;
		if (grantType !== 'authorization_code') {
			res.status(400).json({
				error: 'unsupported_grant_type',
				error_description: 'Only authorization_code is supported',
			});
			return;
		}
		const code = body.code;
		const codeVerifier = body.code_verifier;
		if (!code || !codeVerifier) {
			res.status(400).json({
				error: 'invalid_request',
				error_description: 'code and code_verifier required',
			});
			return;
		}
		const trelloToken = await consumeAuthCode(code, codeVerifier);
		if (!trelloToken) {
			res.status(401).json({
				error: 'invalid_grant',
				error_description: 'Invalid or expired authorization code',
			});
			return;
		}
		const accessToken = crypto.randomBytes(32).toString('base64url');
		await storeAccessToken(accessToken, trelloToken);
		res.json({
			access_token: accessToken,
			token_type: 'Bearer',
			expires_in: 86400, // 24 hours
		});
	});

	return router;
}

export async function getTrelloTokenFromRequest(req: express.Request): Promise<string | null> {
	const auth = req.headers.authorization;
	if (!auth?.startsWith('Bearer ')) return null;
	const token = auth.slice(7);
	return getTrelloTokenForAccessToken(token);
}
