import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TrelloCredentials } from '../types/common.js';
import { fetchWithRetry, trelloGet, trelloPost, trelloPut, trelloDelete } from '../utils/api.js';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Register all Cards API tools
 * Based on https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
 */
export function registerCardsTools(server: McpServer, credentials: TrelloCredentials) {
	// POST /cards - Create a new card
	server.tool(
		'create-card',
		{
			name: z.string().describe('Name of the card'),
			description: z.string().optional().describe('Description of the card'),
			listId: z.string().describe('ID of the list to create the card in'),
			due: z
				.string()
				.optional()
				.describe(
					'Due date in ISO 8601 format (e.g. 2025-03-12 or 2025-03-12T18:30:00.000Z). Per Trello API docs. Optional.'
				),
			start: z.string().optional().describe('Start date in ISO 8601 format. Optional.'),
		},
		async ({ name, description, listId, due, start }) => {
			try {
				const body: Record<string, unknown> = {
					name,
					desc: description || '',
					idList: listId,
					pos: 'bottom',
				};
				if (due) body.due = due;
				if (start) body.start = start;

				const response = await fetchWithRetry(
					`https://api.trello.com/1/cards?key=${credentials.apiKey}&token=${credentials.apiToken}`,
					{
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify(body),
					}
				);
				const data = await response.json();
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(data),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text',
							text: `Error creating card: ${error}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	// POST /cards - Create multiple cards
	server.tool(
		'create-cards',
		{
			cards: z.array(
				z.object({
					name: z.string().describe('Name of the card'),
					description: z.string().optional().describe('Description of the card'),
					listId: z.string().describe('ID of the list to create the card in'),
					due: z.string().optional().describe('Due date in ISO 8601. Optional.'),
					start: z.string().optional().describe('Start date in ISO 8601. Optional.'),
				})
			),
		},
		async ({ cards }) => {
			try {
				const results = await Promise.all(
					cards.map(async (card) => {
						const body: Record<string, unknown> = {
							name: card.name,
							desc: card.description || '',
							idList: card.listId,
							pos: 'bottom',
						};
						if (card.due) body.due = card.due;
						if (card.start) body.start = card.start;

						const response = await fetchWithRetry(
							`https://api.trello.com/1/cards?key=${credentials.apiKey}&token=${credentials.apiToken}`,
							{
								method: 'POST',
								headers: {
									'Content-Type': 'application/json',
								},
								body: JSON.stringify(body),
							}
						);
						return await response.json();
					})
				);
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(results),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text',
							text: `Error creating cards: ${error}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	// PUT /cards/{id} - Update a card
	server.tool(
		'update-card',
		{
			cardId: z.string().describe('ID of the card to update'),
			description: z.string().optional().describe('New description for the card (replaces existing). Use empty string to clear.'),
			name: z.string().optional().describe('New name/title for the card'),
			due: z.string().nullable().optional().describe('Due date ISO 8601 (e.g. "2025-06-15T10:00:00.000Z"). Pass null to remove.'),
			dueComplete: z.boolean().optional().describe('Whether the due date is complete'),
			idMembers: z.array(z.string()).optional().describe('Member IDs to assign. Replaces current members.'),
		},
		async ({ cardId, description, name, due, dueComplete, idMembers }) => {
			const body: Record<string, unknown> = {};
			if (description !== undefined) body.desc = description;
			if (name !== undefined) body.name = name;
			if (due !== undefined) body.due = due;
			if (dueComplete !== undefined) body.dueComplete = dueComplete;
			if (idMembers !== undefined) body.idMembers = idMembers;

			if (Object.keys(body).length === 0) {
				return {
					content: [
						{
							type: 'text',
							text: 'At least one field must be provided (name, description, due, dueComplete, idMembers)',
						},
					],
					isError: true,
				};
			}

			return trelloPut(`/cards/${cardId}`, credentials, body);
		}
	);

	// PUT /cards/{id} - Move card to another list (optionally cross-board)
	server.tool(
		'move-card',
		{
			cardId: z.string().describe('ID of the card to move'),
			listId: z.string().describe('ID of the destination list'),
			boardId: z.string().optional().describe('ID of the destination board (for cross-board moves). listId must belong to this board.'),
			position: z.string().optional().describe('Position in the list (e.g. "top", "bottom")'),
		},
		async ({ cardId, listId, boardId, position = 'bottom' }) => {
			const body: Record<string, unknown> = { idList: listId, pos: position };
			if (boardId) body.idBoard = boardId;
			return trelloPut(`/cards/${cardId}`, credentials, body);
		}
	);

	// PUT /cards - Move multiple cards (optionally cross-board)
	server.tool(
		'move-cards',
		{
			cards: z.array(
				z.object({
					cardId: z.string().describe('ID of the card to move'),
					listId: z.string().describe('ID of the destination list'),
					boardId: z.string().optional().describe('ID of the destination board (for cross-board moves)'),
					position: z.string().optional().describe('Position in the list (e.g. "top", "bottom")'),
				})
			),
		},
		async ({ cards }) => {
			try {
				if (!credentials.apiKey || !credentials.apiToken) {
					return {
						content: [
							{
								type: 'text',
								text: 'Trello API credentials are not configured',
							},
						],
						isError: true,
					};
				}

				const results = await Promise.all(
					cards.map(async (card) => {
						const body: Record<string, unknown> = {
							idList: card.listId,
							pos: card.position || 'bottom',
						};
						if (card.boardId) body.idBoard = card.boardId;
						return trelloPut(`/cards/${card.cardId}`, credentials, body);
					})
				);
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(results),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text',
							text: `Error moving cards: ${error}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	// POST /cards/{id}/actions/comments - Add comment to card
	server.tool(
		'add-comment',
		{
			cardId: z.string().describe('ID of the card to comment on'),
			text: z.string().describe('Comment text'),
		},
		async ({ cardId, text }) => {
			try {
				if (!credentials.apiKey || !credentials.apiToken) {
					return {
						content: [
							{
								type: 'text',
								text: 'Trello API credentials are not configured',
							},
						],
						isError: true,
					};
				}

				const response = await fetchWithRetry(
					`https://api.trello.com/1/cards/${cardId}/actions/comments?key=${credentials.apiKey}&token=${credentials.apiToken}`,
					{
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({
							text,
						}),
					}
				);
				const data = await response.json();
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(data),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text',
							text: `Error adding comment: ${error}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	// POST /cards/{id}/actions/comments - Add multiple comments
	server.tool(
		'add-comments',
		{
			comments: z.array(
				z.object({
					cardId: z.string().describe('ID of the card to comment on'),
					text: z.string().describe('Comment text'),
				})
			),
		},
		async ({ comments }) => {
			try {
				if (!credentials.apiKey || !credentials.apiToken) {
					return {
						content: [
							{
								type: 'text',
								text: 'Trello API credentials are not configured',
							},
						],
						isError: true,
					};
				}

				const results = await Promise.all(
					comments.map(async (comment) => {
						const response = await fetchWithRetry(
							`https://api.trello.com/1/cards/${comment.cardId}/actions/comments?key=${credentials.apiKey}&token=${credentials.apiToken}`,
							{
								method: 'POST',
								headers: {
									'Content-Type': 'application/json',
								},
								body: JSON.stringify({
									text: comment.text,
								}),
							}
						);
						return await response.json();
					})
				);
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(results),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text',
							text: `Error adding comments: ${error}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	// GET /lists/{id}/cards - Get tickets by list (alias for get-list-cards)
	server.tool(
		'get-tickets-by-list',
		{
			listId: z.string().describe('ID of the list to get tickets from'),
			limit: z.number().optional().describe('Maximum number of cards to return'),
		},
		async ({ listId, limit }) => {
			try {
				if (!credentials.apiKey || !credentials.apiToken) {
					return {
						content: [
							{
								type: 'text',
								text: 'Trello API credentials are not configured',
							},
						],
						isError: true,
					};
				}

				const url = new URL(`https://api.trello.com/1/lists/${listId}/cards`);
				url.searchParams.append('key', credentials.apiKey);
				url.searchParams.append('token', credentials.apiToken);
				if (limit) url.searchParams.append('limit', limit.toString());

				const response = await fetchWithRetry(url.toString());
				const data = await response.json();
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(data),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text',
							text: `Error getting tickets by list: ${error}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	// PUT /cards/{id}/closed - Archive a card
	server.tool(
		'archive-card',
		{
			cardId: z.string().describe('ID of the card to archive'),
		},
		async ({ cardId }) => {
			try {
				if (!credentials.apiKey || !credentials.apiToken) {
					return {
						content: [
							{
								type: 'text',
								text: 'Trello API credentials are not configured',
							},
						],
						isError: true,
					};
				}

				const response = await fetchWithRetry(
					`https://api.trello.com/1/cards/${cardId}?key=${credentials.apiKey}&token=${credentials.apiToken}`,
					{
						method: 'PUT',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({
							closed: true,
						}),
					}
				);
				const data = await response.json();
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(data),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text',
							text: `Error archiving card: ${error}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	// PUT /cards - Archive multiple cards
	server.tool(
		'archive-cards',
		{
			cardIds: z.array(z.string()).describe('IDs of the cards to archive'),
		},
		async ({ cardIds }) => {
			try {
				if (!credentials.apiKey || !credentials.apiToken) {
					return {
						content: [
							{
								type: 'text',
								text: 'Trello API credentials are not configured',
							},
						],
						isError: true,
					};
				}

				const results = await Promise.all(
					cardIds.map(async (cardId) => {
						const response = await fetchWithRetry(
							`https://api.trello.com/1/cards/${cardId}?key=${credentials.apiKey}&token=${credentials.apiToken}`,
							{
								method: 'PUT',
								headers: {
									'Content-Type': 'application/json',
								},
								body: JSON.stringify({
									closed: true,
								}),
							}
						);
						return await response.json();
					})
				);
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(results),
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text',
							text: `Error archiving cards: ${error}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	// GET /cards/{id}/attachments - List card attachments
	server.tool(
		'get-card-attachments',
		{
			cardId: z.string().describe('ID of the card to get attachments from'),
		},
		async ({ cardId }) => {
			try {
				if (!credentials.apiKey || !credentials.apiToken) {
					return { content: [{ type: 'text' as const, text: 'Trello API credentials are not configured' }], isError: true };
				}

				const url = new URL(`https://api.trello.com/1/cards/${cardId}/attachments`);
				url.searchParams.append('key', credentials.apiKey);
				url.searchParams.append('token', credentials.apiToken);

				const response = await fetchWithRetry(url.toString());
				const attachments = await response.json();

				// Also fetch comments to map attachments to comments
				const actionsUrl = new URL(`https://api.trello.com/1/cards/${cardId}/actions`);
				actionsUrl.searchParams.append('key', credentials.apiKey);
				actionsUrl.searchParams.append('token', credentials.apiToken);
				actionsUrl.searchParams.append('filter', 'commentCard');

				const actionsResponse = await fetchWithRetry(actionsUrl.toString());
				const comments = await actionsResponse.json();

				// Map attachment URLs mentioned in comments
				const attachmentCommentMap: Record<string, string> = {};
				for (const comment of comments) {
					const text: string = comment.data?.text || '';
					for (const att of attachments) {
						if (text.includes(att.name) || text.includes(att.id)) {
							attachmentCommentMap[att.id] = text;
						}
					}
				}

				const summary = attachments.map((att: any) => ({
					id: att.id,
					name: att.name,
					mimeType: att.mimeType,
					bytes: att.bytes,
					date: att.date,
					isUpload: att.isUpload,
					url: att.url,
					commentContext: attachmentCommentMap[att.id] || null,
				}));

				return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
			} catch (error) {
				return { content: [{ type: 'text' as const, text: `Error getting attachments: ${error}` }], isError: true };
			}
		}
	);

	// Download all image attachments from a card to a local folder
	server.tool(
		'download-card-attachments',
		{
			cardId: z.string().describe('ID of the card to download attachments from'),
			savePath: z.string().describe('Local directory path to save attachments to'),
			imagesOnly: z.boolean().optional().describe('Only download image files (default: true)'),
		},
		async ({ cardId, savePath, imagesOnly = true }) => {
			try {
				if (!credentials.apiKey || !credentials.apiToken) {
					return { content: [{ type: 'text' as const, text: 'Trello API credentials are not configured' }], isError: true };
				}

				// Fetch card info
				const cardUrl = new URL(`https://api.trello.com/1/cards/${cardId}`);
				cardUrl.searchParams.append('key', credentials.apiKey);
				cardUrl.searchParams.append('token', credentials.apiToken);
				cardUrl.searchParams.append('fields', 'name,desc,shortUrl');
				const cardResponse = await fetchWithRetry(cardUrl.toString());
				const card = await cardResponse.json();

				// Fetch attachments
				const attUrl = new URL(`https://api.trello.com/1/cards/${cardId}/attachments`);
				attUrl.searchParams.append('key', credentials.apiKey);
				attUrl.searchParams.append('token', credentials.apiToken);
				const attResponse = await fetchWithRetry(attUrl.toString());
				const attachments = await attResponse.json();

				// Fetch comments for context
				const actionsUrl = new URL(`https://api.trello.com/1/cards/${cardId}/actions`);
				actionsUrl.searchParams.append('key', credentials.apiKey);
				actionsUrl.searchParams.append('token', credentials.apiToken);
				actionsUrl.searchParams.append('filter', 'commentCard');
				const actionsResponse = await fetchWithRetry(actionsUrl.toString());
				const comments = await actionsResponse.json();

				// Filter to images if needed
				const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp'];
				const filtered = imagesOnly
					? attachments.filter((a: any) => a.mimeType && IMAGE_MIMES.includes(a.mimeType))
					: attachments;

				if (filtered.length === 0) {
					return { content: [{ type: 'text' as const, text: `No ${imagesOnly ? 'image ' : ''}attachments found on card "${card.name}"` }] };
				}

				// Ensure output directory
				await fs.mkdir(savePath, { recursive: true });

				// Download each attachment
				const manifest: Array<{
					file: string;
					originalName: string;
					mimeType: string;
					bytes: number;
					date: string;
					commentContext: string | null;
				}> = [];

				// OAuth header for Trello file downloads (query params return 401)
				const authHeader = `OAuth oauth_consumer_key="${credentials.apiKey}", oauth_token="${credentials.apiToken}"`;

				for (let i = 0; i < filtered.length; i++) {
					const att = filtered[i];

					const fileResponse = await fetchWithRetry(att.url, {
						headers: { 'Authorization': authHeader },
					});
					const buffer = Buffer.from(await fileResponse.arrayBuffer());

					// Sanitize filename: {index}-{original_name}
					const baseName = att.name.replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]/g, '_');
					const fileName = `${String(i + 1).padStart(2, '0')}-${baseName}`;
					const filePath = path.join(savePath, fileName);

					await fs.writeFile(filePath, buffer);

					// Find comment context
					let commentContext: string | null = null;
					for (const comment of comments) {
						const text: string = comment.data?.text || '';
						if (text.includes(att.name) || text.includes(att.id)) {
							commentContext = text;
							break;
						}
					}

					manifest.push({
						file: fileName,
						originalName: att.name,
						mimeType: att.mimeType,
						bytes: buffer.length,
						date: att.date,
						commentContext,
					});
				}

				// Write manifest
				const manifestData = {
					card: { id: cardId, name: card.name, description: card.desc, url: card.shortUrl },
					downloadedAt: new Date().toISOString(),
					files: manifest,
				};
				await fs.writeFile(
					path.join(savePath, '_manifest.json'),
					JSON.stringify(manifestData, null, 2),
					'utf-8'
				);

				return {
					content: [{
						type: 'text' as const,
						text: JSON.stringify({
							savedTo: savePath,
							card: card.name,
							filesDownloaded: manifest.length,
							files: manifest.map(m => ({ file: m.file, mimeType: m.mimeType, bytes: m.bytes, commentContext: m.commentContext })),
						}, null, 2),
					}],
				};
			} catch (error) {
				return { content: [{ type: 'text' as const, text: `Error downloading attachments: ${error}` }], isError: true };
			}
		}
	);

	// GET /cards/{id} - Full card with custom fields, checklists, attachments; optional comments
	server.tool(
		'get-card',
		{
			cardId: z.string().describe('Card ID or short link'),
			includeComments: z
				.boolean()
				.optional()
				.describe('Include comment actions (default: false)'),
		},
		async ({ cardId, includeComments = false }) => {
			const params: Record<string, string> = {
				customFieldItems: 'true',
				checklists: 'all',
				attachments: 'true',
				fields: 'name,desc,idList,idBoard,labels,due,dueComplete,shortUrl,closed,pos',
			};
			if (includeComments) {
				params.actions = 'commentCard';
				params.actions_limit = '50';
			}
			return trelloGet(`/cards/${cardId}`, credentials, params);
		}
	);

	// POST /cards/{id}/attachments - Add URL attachment (e.g. linked Trello card)
	server.tool(
		'add-attachment',
		{
			cardId: z.string().describe('ID of the card'),
			url: z.string().min(1).describe('URL to attach (e.g. https://trello.com/c/...)'),
			name: z.string().optional().describe('Optional display name for the attachment'),
		},
		async ({ cardId, url, name }) => {
			const body: Record<string, string> = { url };
			if (name !== undefined) body.name = name;
			return trelloPost(`/cards/${cardId}/attachments`, credentials, body);
		}
	);

	// DELETE /cards/{id}/attachments/{idAttachment} - Remove an attachment from a card
	server.tool(
		'delete-attachment',
		{
			cardId: z.string().describe('ID of the card'),
			attachmentId: z.string().describe('ID of the attachment to delete'),
		},
		async ({ cardId, attachmentId }) => {
			return trelloDelete(`/cards/${cardId}/attachments/${attachmentId}`, credentials);
		}
	);

	// PUT /cards/{id} closed:false - Reopen an archived card
	server.tool(
		'unarchive-card',
		{
			cardId: z.string().describe('ID of the card to unarchive/reopen'),
		},
		async ({ cardId }) => {
			return trelloPut(`/cards/${cardId}`, credentials, { closed: false });
		}
	);

	// PUT /cards - Unarchive multiple cards
	server.tool(
		'unarchive-cards',
		{
			cardIds: z.array(z.string()).describe('IDs of the cards to unarchive/reopen'),
		},
		async ({ cardIds }) => {
			try {
				if (!credentials.apiKey || !credentials.apiToken) {
					return {
						content: [{ type: 'text', text: 'Trello API credentials are not configured' }],
						isError: true,
					};
				}

				const results = await Promise.all(
					cardIds.map(cardId => trelloPut(`/cards/${cardId}`, credentials, { closed: false }))
				);
				return {
					content: [{ type: 'text', text: JSON.stringify(results) }],
				};
			} catch (error) {
				return {
					content: [{ type: 'text', text: `Error unarchiving cards: ${error}` }],
					isError: true,
				};
			}
		}
	);
}

 