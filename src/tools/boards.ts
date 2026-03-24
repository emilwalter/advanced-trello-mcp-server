import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TrelloCredentials } from '../types/common.js';
import { fetchWithRetry, trelloGet } from '../utils/api.js';

/**
 * Register all Boards API tools
 */
export function registerBoardsTools(server: McpServer, credentials: TrelloCredentials) {
	// GET /members/me/boards - Get all boards with optimized parameters
	server.tool(
		'get-boards',
		{
			fields: z.string().optional().describe('Comma-separated list of fields to include (e.g., "id,name,url"). Default: "id,name,url,closed,starred"'),
			filter: z.string().optional().describe('Filter boards by type: "open", "closed", "starred", "all". Default: "open"'),
			limit: z.number().min(1).max(100).optional().describe('Maximum number of boards to return (1-100). Default: 50'),
			organization: z.boolean().optional().describe('Include organization boards. Default: true'),
			lists: z.string().optional().describe('Include lists: "open", "closed", "all", "none". Default: "none"'),
		},
		async (params) => {
			try {
				// Default parameters to reduce response size
				const fields = params.fields || 'id,name,url,closed,starred';
				const filter = params.filter || 'open';
				const limit = params.limit || 50;
				const organization = params.organization !== false;
				const lists = params.lists || 'none';

				// Build query parameters
				const queryParams = new URLSearchParams({
					key: credentials.apiKey,
					token: credentials.apiToken,
					fields: fields,
					filter: filter,
					lists: lists,
				});

				// Add organization parameter if needed
				if (organization) {
					queryParams.append('organization', 'true');
				}

				const response = await fetchWithRetry(
					`https://api.trello.com/1/members/me/boards?${queryParams}`
				);
				const data = await response.json();

				// Apply client-side limit if needed
				const limitedData = Array.isArray(data) ? data.slice(0, limit) : data;

				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({
								boards: limitedData,
								count: Array.isArray(limitedData) ? limitedData.length : 0,
								parameters_used: {
									fields,
									filter,
									limit,
									organization,
									lists
								},
								note: 'Use fields parameter to customize response size. Available fields: id,name,desc,closed,starred,url,shortUrl,prefs,dateLastActivity,idOrganization'
							}, null, 2),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text',
							text: `Error getting boards: ${error}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	// GET /boards/{id} - Board with lists, custom field definitions; optional open cards
	server.tool(
		'get-board',
		{
			boardId: z.string().describe('Board ID'),
			includeCards: z
				.boolean()
				.optional()
				.describe('Include open cards with custom field values (default: false)'),
			cardFields: z
				.string()
				.optional()
				.describe(
					'Comma-separated card fields when includeCards is true (default: name,desc,idList,labels,due,shortUrl)'
				),
		},
		async ({ boardId, includeCards = false, cardFields }) => {
			const params: Record<string, string> = {
				fields: 'name,desc,url',
				lists: 'open',
				list_fields: 'name,pos',
				customFields: 'true',
			};
			if (includeCards) {
				const cf = cardFields || 'name,desc,idList,labels,due,shortUrl';
				params.cards = 'open';
				params.card_fields = cf;
				params.card_customFieldItems = 'true';
			}
			return trelloGet(`/boards/${boardId}`, credentials, params);
		}
	);

	// TODO: Add more boards tools
	// - update-board: Update board properties
	// - create-board: Create new board
	// - get-board-cards: Get cards from board
	// - get-board-members: Get board members
	// - get-board-labels: Get board labels
	// - add-member-to-board: Add member to board
	// - remove-member-from-board: Remove member from board
} 