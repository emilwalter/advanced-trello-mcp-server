import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TrelloCredentials } from '../types/common.js';
import { trelloPost, trelloPut } from '../utils/api.js';

/**
 * Register Checklists API tools
 * Based on https://developer.atlassian.com/cloud/trello/rest/api-group-checklists/
 */
export function registerChecklistsTools(server: McpServer, credentials: TrelloCredentials) {
	// POST /cards/{cardId}/checklists - Create a checklist on a card
	server.tool(
		'create-checklist',
		{
			cardId: z.string().describe('ID of the card to add the checklist to'),
			name: z.string().describe('Name of the checklist'),
		},
		async ({ cardId, name }) => {
			return trelloPost(`/cards/${cardId}/checklists`, credentials, { name });
		}
	);

	// POST /checklists/{checklistId}/checkItems - Add an item to a checklist
	server.tool(
		'add-checklist-item',
		{
			checklistId: z.string().describe('ID of the checklist'),
			name: z.string().describe('Name/text of the checklist item'),
			checked: z.boolean().optional().describe('Whether the item starts checked (default: false)'),
			pos: z.string().optional().describe('Position: "top", "bottom", or a positive number'),
		},
		async ({ checklistId, name, checked, pos }) => {
			const body: Record<string, unknown> = { name };
			if (checked !== undefined) body.checked = checked;
			if (pos !== undefined) body.pos = pos;
			return trelloPost(`/checklists/${checklistId}/checkItems`, credentials, body);
		}
	);

	// PUT /cards/{cardId}/checkItem/{checkItemId} - Update a checklist item
	server.tool(
		'update-checklist-item',
		{
			cardId: z.string().describe('ID of the card containing the checklist item'),
			checkItemId: z.string().describe('ID of the checklist item to update'),
			name: z.string().optional().describe('New name/text for the item'),
			state: z.enum(['complete', 'incomplete']).optional().describe('State of the item'),
		},
		async ({ cardId, checkItemId, name, state }) => {
			const body: Record<string, unknown> = {};
			if (name !== undefined) body.name = name;
			if (state !== undefined) body.state = state;

			if (Object.keys(body).length === 0) {
				return {
					content: [{ type: 'text' as const, text: 'At least one of name or state must be provided' }],
					isError: true,
				};
			}

			return trelloPut(`/cards/${cardId}/checkItem/${checkItemId}`, credentials, body);
		}
	);
}
