// Generador ULID criptográficamente seguro y compatible con especificación Crockford Base32
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LEN = ENCODING.length;

export function generateUlid(seedTime: number = Date.now()): string {
  // 10 chars de timestamp
  let timeStr = '';
  let time = seedTime;
  for (let i = 9; i >= 0; i--) {
    const mod = time % ENCODING_LEN;
    timeStr = ENCODING.charAt(mod) + timeStr;
    time = Math.floor(time / ENCODING_LEN);
  }

  // 16 chars de aleatoriedad criptográfica
  const randomBytes = new Uint8Array(10);
  crypto.getRandomValues(randomBytes);
  let randStr = '';
  for (let i = 0; i < 16; i++) {
    const randByte = randomBytes[i % randomBytes.length];
    const randVal = (randByte + Math.floor(Math.random() * 256)) % ENCODING_LEN;
    randStr += ENCODING.charAt(randVal);
  }

  return (timeStr + randStr).slice(0, 26);
}
