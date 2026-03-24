/**
 * Shared factory for creating a configured Trello MCP server.
 * Used by both stdio (index.ts) and HTTP (server.ts) entry points.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerBoardsTools } from './tools/boards.js';
import { registerListsTools } from './tools/lists.js';
import { registerCardsTools } from './tools/cards.js';
import { registerLabelsTools } from './tools/labels.js';
import { registerActionsTools } from './tools/actions.js';
import { TrelloCredentials } from './types/common.js';
import { fetchWithRetry } from './utils/api.js';

export function createTrelloMcpServer(credentials: TrelloCredentials): McpServer {
	const server = new McpServer({
		name: 'Advanced Trello MCP Server',
		version: '2.0.0',
	});

	const { apiKey: trelloApiKey, apiToken: trelloApiToken } = credentials;

	// Resources
	server.resource('boards', 'trello://boards', async (uri) => {
		const response = await fetchWithRetry(
			`https://api.trello.com/1/members/me/boards?key=${trelloApiKey}&token=${trelloApiToken}`
		);
		const data = await response.json();
		return {
			contents: [{ uri: uri.href, text: JSON.stringify(data) }],
		};
	});

	server.resource(
		'lists',
		new ResourceTemplate('trello://boards/{boardId}/lists', { list: undefined }),
		async (uri, { boardId }) => {
			const response = await fetchWithRetry(
				`https://api.trello.com/1/boards/${boardId}/lists?key=${trelloApiKey}&token=${trelloApiToken}`
			);
			const data = await response.json();
			return {
				contents: [{ uri: uri.href, text: JSON.stringify(data) }],
			};
		}
	);

	server.resource(
		'cards',
		new ResourceTemplate('trello://lists/{listId}/cards', { list: undefined }),
		async (uri, { listId }) => {
			const response = await fetchWithRetry(
				`https://api.trello.com/1/lists/${listId}/cards?key=${trelloApiKey}&token=${trelloApiToken}`
			);
			const data = await response.json();
			return {
				contents: [{ uri: uri.href, text: JSON.stringify(data) }],
			};
		}
	);

	// Tools
	registerBoardsTools(server, credentials);
	registerListsTools(server, credentials);
	registerCardsTools(server, credentials);
	registerLabelsTools(server, credentials);
	registerActionsTools(server, credentials);

	return server;
}
