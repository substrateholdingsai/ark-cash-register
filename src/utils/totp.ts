// TOTP (RFC 6238) soberano — HMAC-SHA1, sin dependencias.
// Secret en Base32 (alfabeto RFC 4648).

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  // padding
  while (out.length % 8 !== 0) out += '=';
  return out;
}

function base32Decode(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function generateTotpSecret(bytes = 20): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base32Encode(buf).replace(/=+$/, '');
}

async function hmacSha1(key: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msg);
  return new Uint8Array(sig);
}

function intToBytes(num: number): Uint8Array {
  const buf = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    buf[i] = num & 0xff;
    num = Math.floor(num / 256);
  }
  return buf;
}

export async function generateTotp(secret: string, time: number = Date.now(), step = 30, digits = 6): Promise<string> {
  const counter = Math.floor(time / 1000 / step);
  const key = base32Decode(secret);
  const msg = intToBytes(counter);
  const hmac = await hmacSha1(key, msg);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = code % Math.pow(10, digits);
  return otp.toString().padStart(digits, '0');
}

export async function verifyTotp(secret: string, code: string, window = 1): Promise<boolean> {
  const now = Date.now();
  for (let i = -window; i <= window; i++) {
    const t = now + i * 30000;
    const expected = await generateTotp(secret, t);
    // constant-time compare
    if (expected.length === code.length) {
      let diff = 0;
      for (let j = 0; j < expected.length; j++) diff |= expected.charCodeAt(j) ^ code.charCodeAt(j);
      if (diff === 0) return true;
    }
  }
  return false;
}

export function totpOtpauthUri(secret: string, account: string, issuer = 'Ark Cash Register'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}
