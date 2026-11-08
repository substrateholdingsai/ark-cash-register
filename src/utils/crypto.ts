// Criptografía soberana para Auth — solo Web Crypto API (crypto.subtle)
// PBKDF2 para passwords, HS256 para JWT, tokens opacos, comparación constante.

const ENC = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ea = ENC.encode(a);
  const eb = ENC.encode(b);
  if (ea.length !== eb.length) return false;
  return timingSafeEqual(ea, eb);
}

export function generateToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64urlEncode(buf);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', ENC.encode(input));
  const arr = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0');
  return hex;
}

export async function sha256Bytes(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', ENC.encode(input));
  return new Uint8Array(digest);
}

// ---------- Password hashing (PBKDF2) ----------

const PBKDF2_ITERATIONS = 100000;

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    ENC.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hash = new Uint8Array(bits);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = b64urlDecode(parts[2]);
    expected = b64urlDecode(parts[3]);
  } catch {
    return false;
  }
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    ENC.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    expected.length * 8
  );
  return timingSafeEqual(new Uint8Array(bits), expected);
}

// ---------- JWT HS256 ----------

export interface JwtPayload {
  sub: string;
  role?: string;
  iat: number;
  exp: number;
  jti?: string;
  [key: string]: unknown;
}

async function hmacSha256(key: string, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    ENC.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, ENC.encode(data));
  return new Uint8Array(sig);
}

export async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = b64urlEncode(ENC.encode(JSON.stringify(header)));
  const p = b64urlEncode(ENC.encode(JSON.stringify(payload)));
  const signingInput = `${h}.${p}`;
  const sig = await hmacSha256(secret, signingInput);
  return `${signingInput}.${b64urlEncode(sig)}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  let sigBytes: Uint8Array;
  try {
    sigBytes = b64urlDecode(s);
  } catch {
    return null;
  }
  const expected = await hmacSha256(secret, `${h}.${p}`);
  if (!timingSafeEqual(sigBytes, expected)) return null;
  let payload: JwtPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p))) as JwtPayload;
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  if (typeof payload.iat !== 'number') return null;
  if (typeof payload.sub !== 'string') return null;
  return payload;
}

// Verifica con secreto actual y, si falla, con el anterior (rotación)
export async function verifyJwtWithRotation(
  token: string,
  current: string,
  previous?: string
): Promise<JwtPayload | null> {
  const r = await verifyJwt(token, current);
  if (r) return r;
  if (previous) return verifyJwt(token, previous);
  return null;
}
