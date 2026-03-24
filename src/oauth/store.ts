/**
 * OAuth code and token store.
 * Uses Upstash Redis when REDIS_HOST is set, otherwise in-memory (single-instance only).
 */
import crypto from 'node:crypto';
import Redis from 'ioredis';

const CODE_TTL_SEC = 10 * 60; // 10 minutes
/** MCP access token lifetime (Redis / memory). Trello user token uses expiration=never. */
export const TOKEN_TTL_SEC = 30 * 24 * 60 * 60; // 30 days

const PREFIX_AUTH_CODE = 'mcp:oauth:code:';
const PREFIX_ACCESS_TOKEN = 'mcp:oauth:token:';

function sha256Base64Url(input: string): string {
	return crypto.createHash('sha256').update(input).digest('base64url');
}

// In-memory fallback when Redis is not configured
const authCodesMem = new Map<string, { trelloToken: string; codeChallenge: string; expiresAt: number }>();
const accessTokensMem = new Map<string, { trelloToken: string; expiresAt: number }>();

let redis: Redis | null = null;

function getRedis(): Redis | null {
	if (redis) return redis;
	const host = process.env.REDIS_HOST;
	if (!host) return null;
	try {
		redis = new Redis({
			host: process.env.REDIS_HOST,
			port: parseInt(process.env.REDIS_PORT || '6379', 10),
			password: process.env.REDIS_PASSWORD,
			maxRetriesPerRequest: 3,
			...(host.endsWith('.upstash.io') && { tls: {} }),
		});
		return redis;
	} catch {
		return null;
	}
}

export async function storeAuthCode(code: string, trelloToken: string, codeChallenge: string): Promise<void> {
	const r = getRedis();
	const payload = JSON.stringify({ trelloToken, codeChallenge });
	if (r) {
		await r.setex(PREFIX_AUTH_CODE + code, CODE_TTL_SEC, payload);
	} else {
		authCodesMem.set(code, {
			trelloToken,
			codeChallenge,
			expiresAt: Date.now() + CODE_TTL_SEC * 1000,
		});
	}
}

export async function consumeAuthCode(code: string, codeVerifier: string): Promise<string | null> {
	const r = getRedis();
	let entry: { trelloToken: string; codeChallenge: string } | null = null;

	if (r) {
		const raw = await r.get(PREFIX_AUTH_CODE + code);
		if (raw) {
			await r.del(PREFIX_AUTH_CODE + code);
			try {
				entry = JSON.parse(raw);
			} catch {
				return null;
			}
		}
	} else {
		const mem = authCodesMem.get(code);
		if (mem && mem.expiresAt >= Date.now()) {
			entry = { trelloToken: mem.trelloToken, codeChallenge: mem.codeChallenge };
			authCodesMem.delete(code);
		}
	}

	if (!entry) return null;

	const computed = sha256Base64Url(codeVerifier);
	if (computed !== entry.codeChallenge) return null;
	return entry.trelloToken;
}

export async function storeAccessToken(token: string, trelloToken: string): Promise<void> {
	const r = getRedis();
	const payload = JSON.stringify({ trelloToken });
	if (r) {
		await r.setex(PREFIX_ACCESS_TOKEN + token, TOKEN_TTL_SEC, payload);
	} else {
		accessTokensMem.set(token, {
			trelloToken,
			expiresAt: Date.now() + TOKEN_TTL_SEC * 1000,
		});
	}
}

export async function getTrelloTokenForAccessToken(accessToken: string): Promise<string | null> {
	const r = getRedis();

	if (r) {
		const raw = await r.get(PREFIX_ACCESS_TOKEN + accessToken);
		if (!raw) return null;
		try {
			const { trelloToken } = JSON.parse(raw);
			return trelloToken;
		} catch {
			return null;
		}
	}

	const mem = accessTokensMem.get(accessToken);
	if (!mem || mem.expiresAt < Date.now()) {
		accessTokensMem.delete(accessToken);
		return null;
	}
	return mem.trelloToken;
}