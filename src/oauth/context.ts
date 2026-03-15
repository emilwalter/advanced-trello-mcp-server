/**
 * Request-scoped credentials for MCP.
 * Uses AsyncLocalStorage so the server factory can resolve credentials per-request.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { TrelloCredentials } from '../types/common.js';

export const mcpContext = new AsyncLocalStorage<{ credentials: TrelloCredentials }>();

export function getMcpCredentials(): TrelloCredentials | null {
	const ctx = mcpContext.getStore();
	return ctx?.credentials ?? null;
}

export async function resolveCredentialsFromRequest(
	authHeader: string | undefined,
	oauthTokenLookup: (token: string) => Promise<string | null>,
	staticCredentials: TrelloCredentials,
	mcpAccessToken: string | undefined
): Promise<TrelloCredentials | null> {
	if (!authHeader?.startsWith('Bearer ')) {
		return mcpAccessToken ? null : staticCredentials;
	}
	const token = authHeader.slice(7);

	// 1. OAuth access token - look up Trello token for this user
	const trelloToken = await oauthTokenLookup(token);
	if (trelloToken) {
		return {
			apiKey: process.env.TRELLO_API_KEY || '',
			apiToken: trelloToken,
		};
	}

	// 2. Legacy MCP_ACCESS_TOKEN - use static credentials
	if (mcpAccessToken && token === mcpAccessToken) {
		return staticCredentials;
	}

	return null;
}
