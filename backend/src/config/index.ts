/**
 * 애플리케이션 설정
 */

import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h'
  },

  // Encryption
  encryptionKey: process.env.ENCRYPTION_KEY || 'default-32-byte-encryption-key!!',

  // CORS
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  // Pagination defaults
  pagination: {
    defaultLimit: 20,
    maxLimit: 100
  }
};
