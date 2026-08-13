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

import { fetchWithRetry, trelloPut, trelloDelete } from '../../utils/api.js';

/** Minimal stand-in for a fetch Response, enough for the attachment code paths */
function mockJsonResponse(body: unknown, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
		headers: new Headers(),
	};
}

function mockBinaryResponse(buffer: Buffer, contentType: string, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		arrayBuffer: () => Promise.resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
		headers: new Headers({ 'content-type': contentType }),
	};
}

function mockRedirectResponse(location: string, status = 302) {
	return {
		ok: false,
		status,
		headers: new Headers({ location }),
	};
}

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

	describe('read-card-attachment', () => {
		const readAttachment = async (args: Record<string, unknown>) =>
			(await tools.get('read-card-attachment')!.handler(args)) as unknown as {
				content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
				isError?: boolean;
			};

		it('should be registered', () => {
			expect(tools.has('read-card-attachment')).toBe(true);
		});

		it('returns text attachments decoded as UTF-8', async () => {
			vi.mocked(fetchWithRetry)
				.mockResolvedValueOnce(mockJsonResponse({
					id: 'att1', name: 'kontrollplan.txt', mimeType: 'text/plain', bytes: 11,
					url: 'https://api.trello.com/1/cards/c1/attachments/att1/download/kontrollplan.txt',
				}) as never)
				.mockResolvedValueOnce(mockBinaryResponse(Buffer.from('Hej Emil ÅÄ'), 'text/plain') as never);

			const result = await readAttachment({ cardId: 'c1', attachmentId: 'att1' });

			expect(result.isError).toBeUndefined();
			expect(JSON.parse(result.content[0].text!)).toMatchObject({ name: 'kontrollplan.txt', encoding: 'utf-8' });
			expect(result.content[1].text).toBe('Hej Emil ÅÄ');
		});

		it('returns images as an image content block', async () => {
			const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
			vi.mocked(fetchWithRetry)
				.mockResolvedValueOnce(mockJsonResponse({
					id: 'att2', name: 'ritning.png', mimeType: 'image/png', bytes: png.length,
					url: 'https://api.trello.com/1/cards/c1/attachments/att2/download/ritning.png',
				}) as never)
				.mockResolvedValueOnce(mockBinaryResponse(png, 'image/png') as never);

			const result = await readAttachment({ cardId: 'c1', attachmentId: 'att2' });

			expect(result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png', data: png.toString('base64') });
		});

		it('returns other binary types as base64', async () => {
			const pdf = Buffer.from('%PDF-1.7 fake');
			vi.mocked(fetchWithRetry)
				.mockResolvedValueOnce(mockJsonResponse({
					id: 'att3', name: 'beslut.pdf', mimeType: 'application/pdf', bytes: pdf.length,
					url: 'https://api.trello.com/1/cards/c1/attachments/att3/download/beslut.pdf',
				}) as never)
				.mockResolvedValueOnce(mockBinaryResponse(pdf, 'application/pdf') as never);

			const result = await readAttachment({ cardId: 'c1', attachmentId: 'att3' });
			const payload = JSON.parse(result.content[0].text!);

			expect(payload).toMatchObject({ mimeType: 'application/pdf', encoding: 'base64', bytes: pdf.length });
			expect(Buffer.from(payload.data, 'base64').toString()).toBe('%PDF-1.7 fake');
		});

		it('refuses oversized attachments without downloading them', async () => {
			vi.mocked(fetchWithRetry).mockResolvedValueOnce(mockJsonResponse({
				id: 'att4', name: 'stor-ritning.pdf', mimeType: 'application/pdf', bytes: 9_000_000,
				url: 'https://api.trello.com/1/cards/c1/attachments/att4/download/stor-ritning.pdf',
			}) as never);

			const result = await readAttachment({ cardId: 'c1', attachmentId: 'att4' });

			expect(result.isError).toBe(true);
			expect(JSON.parse(result.content[0].text!)).toMatchObject({ error: 'attachment-too-large' });
			expect(fetchWithRetry).toHaveBeenCalledTimes(1);
		});

		it('caps maxBytes at the hard limit', async () => {
			vi.mocked(fetchWithRetry).mockResolvedValueOnce(mockJsonResponse({
				id: 'att5', name: 'enorm.pdf', mimeType: 'application/pdf', bytes: 6 * 1024 * 1024,
				url: 'https://api.trello.com/1/cards/c1/attachments/att5/download/enorm.pdf',
			}) as never);

			const result = await readAttachment({ cardId: 'c1', attachmentId: 'att5', maxBytes: 50_000_000 });

			expect(result.isError).toBe(true);
			expect(JSON.parse(result.content[0].text!).limit).toBe(5 * 1024 * 1024);
		});

		it('follows redirects and drops the auth header off Trello hosts', async () => {
			const bytes = Buffer.from('signed-storage-body');
			vi.mocked(fetchWithRetry)
				.mockResolvedValueOnce(mockJsonResponse({
					id: 'att6', name: 'detaljplan.dwg', mimeType: '', bytes: bytes.length,
					url: 'https://api.trello.com/1/cards/c1/attachments/att6/download/detaljplan.dwg',
				}) as never)
				.mockResolvedValueOnce(mockRedirectResponse('https://trello-attachments.s3.amazonaws.com/signed') as never)
				.mockResolvedValueOnce(mockBinaryResponse(bytes, 'application/octet-stream') as never);

			const result = await readAttachment({ cardId: 'c1', attachmentId: 'att6' });

			const firstCallOptions = vi.mocked(fetchWithRetry).mock.calls[1][1] as RequestInit;
			const redirectCallOptions = vi.mocked(fetchWithRetry).mock.calls[2][1];
			expect((firstCallOptions.headers as Record<string, string>).Authorization).toContain('oauth_consumer_key');
			expect(redirectCallOptions).toBeUndefined();
			expect(JSON.parse(result.content[0].text!).encoding).toBe('base64');
		});

		it('reports metadata errors', async () => {
			vi.mocked(fetchWithRetry).mockResolvedValueOnce(mockJsonResponse({}, 404) as never);

			const result = await readAttachment({ cardId: 'c1', attachmentId: 'nope' });

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('HTTP 404');
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
