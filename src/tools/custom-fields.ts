import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TrelloCredentials } from '../types/common.js';
import { trelloGet, trelloPut } from '../utils/api.js';

/**
 * Custom field value updates and dropdown options.
 */
export function registerCustomFieldsTools(server: McpServer, credentials: TrelloCredentials) {
	server.tool(
		'set-custom-field',
		{
			cardId: z.string().describe('Card ID'),
			fieldId: z.string().describe('Custom field definition ID'),
			value: z
				.record(z.unknown())
				.describe(
					'Trello payload: text/number/date as { value: { text|number|date: "..." } }; list as { idValue: "option_id" }; checkbox as { value: { checked: "true" } }'
				),
		},
		async ({ cardId, fieldId, value }) => {
			return trelloPut(`/cards/${cardId}/customField/${fieldId}/item`, credentials, value);
		}
	);

	server.tool(
		'get-custom-field-options',
		{
			fieldId: z.string().describe('Custom field definition ID (dropdown/list type)'),
		},
		async ({ fieldId }) => {
			return trelloGet(`/customFields/${fieldId}/options`, credentials);
		}
	);
}
