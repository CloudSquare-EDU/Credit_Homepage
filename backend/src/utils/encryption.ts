/**
 * AES-256-GCM 암호화 유틸리티
 * NCP API 키를 안전하게 저장/복호화
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

/**
 * 환경변수에서 암호화 키 가져오기
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  // 32바이트 키 생성 (SHA-256 해시)
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * 문자열 암호화
 * @param plaintext 암호화할 평문
 * @returns Base64 인코딩된 암호문 (salt:iv:authTag:ciphertext)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);

  // 솔트를 사용하여 파생 키 생성
  const derivedKey = crypto.pbkdf2Sync(key, salt, 100000, 32, 'sha256');

  const cipher = crypto.createCipheriv(ALGORITHM, derivedKey, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  // salt:iv:authTag:ciphertext 형식으로 결합
  return [
    salt.toString('base64'),
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted
  ].join(':');
}

/**
 * 암호문 복호화
 * @param ciphertext Base64 인코딩된 암호문
 * @returns 복호화된 평문
 */
export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const parts = ciphertext.split(':');

  if (parts.length !== 4) {
    throw new Error('Invalid ciphertext format');
  }

  const [saltB64, ivB64, authTagB64, encryptedB64] = parts;

  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');

  // 솔트를 사용하여 파생 키 생성
  const derivedKey = crypto.pbkdf2Sync(key, salt, 100000, 32, 'sha256');

  const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString('utf8');
}

/**
 * 문자열 해시 생성 (검색/식별용)
 * @param value 해시할 문자열
 * @returns SHA-256 해시 (hex)
 */
export function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * 랜덤 토큰 생성
 * @param length 바이트 길이
 * @returns hex 인코딩된 랜덤 문자열
 */
export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}
