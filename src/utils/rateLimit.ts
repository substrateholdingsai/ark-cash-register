// Rate limiting soberano con KV (sliding window) + persistencia opcional D1.
// Clave: rl:<scope>:<key>

export interface RateLimitConfig {
  limit: number;
  windowSec: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number; // segundos
}

interface Bucket {
  count: number;
  windowStart: number;
}

export async function checkRateLimit(
  kv: KVNamespace,
  scope: string,
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const kvKey = `rl:${scope}:${key}`;
  const raw = await kv.get(kvKey, 'json');
  let bucket: Bucket = (raw as Bucket) || { count: 0, windowStart: now };

  // Ventana expirada -> reset
  if (now - bucket.windowStart >= config.windowSec) {
    bucket = { count: 0, windowStart: now };
  }

  if (bucket.count >= config.limit) {
    const retryAfter = config.windowSec - (now - bucket.windowStart);
    return { allowed: false, remaining: 0, retryAfter: Math.max(1, retryAfter) };
  }

  bucket.count += 1;
  const ttl = config.windowSec + 60;
  await kv.put(kvKey, JSON.stringify(bucket), { expirationTtl: ttl });

  return { allowed: true, remaining: config.limit - bucket.count, retryAfter: 0 };
}

export function clientIp(c: { req: { header: (n: string) => string | undefined } }): string {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('X-Real-IP') ||
    'unknown'
  );
}

export function rateLimitResponse(retryAfter: number): Response {
  return new Response(
    JSON.stringify({ error: { message: 'Demasiadas solicitudes. Intenta más tarde.', type: 'RATE_LIMITED' } }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter)
      }
    }
  );
}
