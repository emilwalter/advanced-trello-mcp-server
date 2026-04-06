import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TrelloCredentials } from '../../types/common.js';
import { registerChecklistsTools } from '../checklists.js';

vi.mock('../../utils/api.js', () => {
	const mockResponse = { content: [{ type: 'text', text: '{}' }] };
	return {
		trelloPost: vi.fn().mockResolvedValue(mockResponse),
		trelloPut: vi.fn().mockResolvedValue(mockResponse),
	};
});

import { trelloPost, trelloPut } from '../../utils/api.js';

const credentials: TrelloCredentials = { apiKey: 'test-key', apiToken: 'test-token' };

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

function captureTools(server: McpServer): Map<string, { schema: unknown; handler: ToolHandler }> {
	const tools = new Map<string, { schema: unknown; handler: ToolHandler }>();
	const origTool = server.tool.bind(server);
	server.tool = ((name: string, schema: unknown, handler: ToolHandler) => {
		tools.set(name, { schema, handler });
		return origTool(name, schema as Record<string, never>, handler);
	}) as typeof server.tool;
	return tools;
}

describe('checklists tools', () => {
	let server: McpServer;
	let tools: Map<string, { schema: unknown; handler: ToolHandler }>;

	beforeEach(() => {
		vi.clearAllMocks();
		server = new McpServer({ name: 'test', version: '0.0.1' });
		tools = captureTools(server);
		registerChecklistsTools(server, credentials);
	});

	describe('create-checklist', () => {
		it('should be registered', () => {
			expect(tools.has('create-checklist')).toBe(true);
		});

		it('calls trelloPost with card endpoint and name', async () => {
			const handler = tools.get('create-checklist')!.handler;
			await handler({ cardId: 'card1', name: 'My Checklist' });
			expect(trelloPost).toHaveBeenCalledWith(
				'/cards/card1/checklists',
				credentials,
				{ name: 'My Checklist' }
			);
		});
	});

	describe('add-checklist-item', () => {
		it('should be registered', () => {
			expect(tools.has('add-checklist-item')).toBe(true);
		});

		it('calls trelloPost with name only', async () => {
			const handler = tools.get('add-checklist-item')!.handler;
			await handler({ checklistId: 'cl1', name: 'Task A' });
			expect(trelloPost).toHaveBeenCalledWith(
				'/checklists/cl1/checkItems',
				credentials,
				{ name: 'Task A' }
			);
		});

		it('includes checked and pos when provided', async () => {
			const handler = tools.get('add-checklist-item')!.handler;
			await handler({ checklistId: 'cl1', name: 'Task B', checked: true, pos: 'top' });
			expect(trelloPost).toHaveBeenCalledWith(
				'/checklists/cl1/checkItems',
				credentials,
				{ name: 'Task B', checked: true, pos: 'top' }
			);
		});
	});

	describe('update-checklist-item', () => {
		it('should be registered', () => {
			expect(tools.has('update-checklist-item')).toBe(true);
		});

		it('calls trelloPut with state', async () => {
			const handler = tools.get('update-checklist-item')!.handler;
			await handler({ cardId: 'c1', checkItemId: 'ci1', state: 'complete' });
			expect(trelloPut).toHaveBeenCalledWith(
				'/cards/c1/checkItem/ci1',
				credentials,
				{ state: 'complete' }
			);
		});

		it('calls trelloPut with name', async () => {
			const handler = tools.get('update-checklist-item')!.handler;
			await handler({ cardId: 'c1', checkItemId: 'ci1', name: 'Renamed' });
			expect(trelloPut).toHaveBeenCalledWith(
				'/cards/c1/checkItem/ci1',
				credentials,
				{ name: 'Renamed' }
			);
		});

		it('returns error when no fields provided', async () => {
			const handler = tools.get('update-checklist-item')!.handler;
			const result = await handler({ cardId: 'c1', checkItemId: 'ci1' });
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('At least one of name or state');
			expect(trelloPut).not.toHaveBeenCalled();
		});
	});
});
