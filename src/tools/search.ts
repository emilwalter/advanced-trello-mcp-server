import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TrelloCredentials } from '../types/common.js';
import { trelloGet } from '../utils/api.js';

/**
 * Trello search API (cross-board).
 */
export function registerSearchTools(server: McpServer, credentials: TrelloCredentials) {
	server.tool(
		'search',
		{
			query: z.string().min(1).describe('Search query'),
			modelTypes: z
				.string()
				.optional()
				.describe('Comma-separated: cards, boards, organizations (default: cards)'),
			cardsLimit: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe('Max cards to return (default: 10)'),
			cardFields: z
				.string()
				.optional()
				.describe('Comma-separated card fields (default: name,desc,idBoard,shortUrl)'),
		},
		async ({ query, modelTypes = 'cards', cardsLimit = 10, cardFields }) => {
			const fields = cardFields || 'name,desc,idBoard,shortUrl';
			return trelloGet('/search', credentials, {
				query,
				modelTypes,
				cards_limit: String(cardsLimit),
				card_fields: fields,
			});
		}
	);
}
