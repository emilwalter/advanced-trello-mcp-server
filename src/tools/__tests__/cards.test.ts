import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TrelloCredentials } from '../../types/common.js';
import { registerCardsTools } from '../cards.js';

vi.mock('../../utils/api.js', () => {
	const mockResponse = { content: [{ type: 'text', text: '{}' }] };
	return {
		fetchWithRetry: vi.fn().mockResolvedValue({ json: () => Promise.resolve({}) }),
		trelloGet: vi.fn().mockResolvedValue(mockResponse),
		trelloPost: vi.fn().mockResolvedValue(mockResponse),
		trelloPut: vi.fn().mockResolvedValue(mockResponse),
		trelloDelete: vi.fn().mockResolvedValue(mockResponse),
	};
});

import { trelloPut, trelloDelete } from '../../utils/api.js';

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

describe('cards tools', () => {
	let server: McpServer;
	let tools: Map<string, { schema: unknown; handler: ToolHandler }>;

	beforeEach(() => {
		vi.clearAllMocks();
		server = new McpServer({ name: 'test', version: '0.0.1' });
		tools = captureTools(server);
		registerCardsTools(server, credentials);
	});

	describe('update-card', () => {
		it('should be registered', () => {
			expect(tools.has('update-card')).toBe(true);
		});

		it('calls trelloPut with name and description', async () => {
			const handler = tools.get('update-card')!.handler;
			await handler({ cardId: 'card123', name: 'New Name', description: 'New Desc' });
			expect(trelloPut).toHaveBeenCalledWith(
				'/cards/card123',
				credentials,
				{ name: 'New Name', desc: 'New Desc' }
			);
		});

		it('calls trelloPut with due set to null (clear)', async () => {
			const handler = tools.get('update-card')!.handler;
			await handler({ cardId: 'card123', due: null });
			expect(trelloPut).toHaveBeenCalledWith(
				'/cards/card123',
				credentials,
				{ due: null }
			);
		});

		it('calls trelloPut with due date string', async () => {
			const handler = tools.get('update-card')!.handler;
			await handler({ cardId: 'card123', due: '2025-06-15T10:00:00.000Z' });
			expect(trelloPut).toHaveBeenCalledWith(
				'/cards/card123',
				credentials,
				{ due: '2025-06-15T10:00:00.000Z' }
			);
		});

		it('calls trelloPut with dueComplete', async () => {
			const handler = tools.get('update-card')!.handler;
			await handler({ cardId: 'card123', dueComplete: true });
			expect(trelloPut).toHaveBeenCalledWith(
				'/cards/card123',
				credentials,
				{ dueComplete: true }
			);
		});

		it('calls trelloPut with idMembers', async () => {
			const handler = tools.get('update-card')!.handler;
			await handler({ cardId: 'card123', idMembers: ['m1', 'm2'] });
			expect(trelloPut).toHaveBeenCalledWith(
				'/cards/card123',
				credentials,
				{ idMembers: ['m1', 'm2'] }
			);
		});

		it('calls trelloPut with all fields combined', async () => {
			const handler = tools.get('update-card')!.handler;
			await handler({
				cardId: 'card123',
				name: 'N',
				description: 'D',
				due: '2025-01-01',
				dueComplete: false,
				idMembers: ['m1'],
			});
			expect(trelloPut).toHaveBeenCalledWith(
				'/cards/card123',
				credentials,
				{ name: 'N', desc: 'D', due: '2025-01-01', dueComplete: false, idMembers: ['m1'] }
			);
		});

		it('returns error when no fields provided', async () => {
			const handler = tools.get('update-card')!.handler;
			const result = await handler({ cardId: 'card123' });
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('At least one field');
			expect(trelloPut).not.toHaveBeenCalled();
		});
	});

	describe('move-card', () => {
		it('should be registered', () => {
			expect(tools.has('move-card')).toBe(true);
		});

		it('calls trelloPut with listId only', async () => {
			const handler = tools.get('move-card')!.handler;
			await handler({ cardId: 'c1', listId: 'l1' });
			expect(trelloPut).toHaveBeenCalledWith(
				'/cards/c1',
				credentials,
				{ idList: 'l1', pos: 'bottom' }
			);
		});

		it('calls trelloPut with boardId for cross-board move', async () => {
			const handler = tools.get('move-card')!.handler;
			await handler({ cardId: 'c1', listId: 'l1', boardId: 'b2' });
			expect(trelloPut).toHaveBeenCalledWith(
				'/cards/c1',
				credentials,
				{ idList: 'l1', pos: 'bottom', idBoard: 'b2' }
			);
		});

		it('respects custom position', async () => {
			const handler = tools.get('move-card')!.handler;
			await handler({ cardId: 'c1', listId: 'l1', position: 'top' });
			expect(trelloPut).toHaveBeenCalledWith(
				'/cards/c1',
				credentials,
				{ idList: 'l1', pos: 'top' }
			);
		});
	});

	describe('move-cards', () => {
		it('includes boardId per card when provided', async () => {
			const handler = tools.get('move-cards')!.handler;
			await handler({
				cards: [
					{ cardId: 'c1', listId: 'l1', boardId: 'b2' },
					{ cardId: 'c2', listId: 'l2' },
				],
			});
			expect(trelloPut).toHaveBeenCalledWith(
				'/cards/c1',
				credentials,
				{ idList: 'l1', pos: 'bottom', idBoard: 'b2' }
			);
			expect(trelloPut).toHaveBeenCalledWith(
				'/cards/c2',
				credentials,
				{ idList: 'l2', pos: 'bottom' }
			);
		});
	});

	describe('delete-attachment', () => {
		it('should be registered', () => {
			expect(tools.has('delete-attachment')).toBe(true);
		});

		it('calls trelloDelete with correct endpoint', async () => {
			const handler = tools.get('delete-attachment')!.handler;
			await handler({ cardId: 'c1', attachmentId: 'att1' });
			expect(trelloDelete).toHaveBeenCalledWith(
				'/cards/c1/attachments/att1',
				credentials
			);
		});
	});

	describe('unarchive-card', () => {
		it('should be registered', () => {
			expect(tools.has('unarchive-card')).toBe(true);
		});

		it('calls trelloPut with closed:false', async () => {
			const handler = tools.get('unarchive-card')!.handler;
			await handler({ cardId: 'c1' });
			expect(trelloPut).toHaveBeenCalledWith(
				'/cards/c1',
				credentials,
				{ closed: false }
			);
		});
	});

	describe('unarchive-cards', () => {
		it('should be registered', () => {
			expect(tools.has('unarchive-cards')).toBe(true);
		});

		it('calls trelloPut for each card', async () => {
			const handler = tools.get('unarchive-cards')!.handler;
			await handler({ cardIds: ['c1', 'c2'] });
			expect(trelloPut).toHaveBeenCalledWith('/cards/c1', credentials, { closed: false });
			expect(trelloPut).toHaveBeenCalledWith('/cards/c2', credentials, { closed: false });
		});
	});
});
