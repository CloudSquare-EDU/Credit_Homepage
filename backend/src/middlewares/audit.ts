/**
 * 감사 로그 미들웨어 및 유틸리티
 */

import { PrismaClient } from '@prisma/client';
import { AuthRequest } from './auth';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export interface AuditLogParams {
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * 감사 로그 생성
 */
export async function createAuditLog(params: AuditLogParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        oldValue: params.oldValue ? JSON.parse(JSON.stringify(params.oldValue)) : null,
        newValue: params.newValue ? JSON.parse(JSON.stringify(params.newValue)) : null,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent
      }
    });

    logger.info('Audit log created', {
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      userId: params.userId
    });
  } catch (error) {
    logger.error('Failed to create audit log', { error, params });
  }
}

/**
 * 요청에서 감사 로그 정보 추출
 */
export function extractAuditInfo(req: AuthRequest): {
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
} {
  return {
    userId: req.user?.id,
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent']
  };
}

/**
 * API 키 마스킹 (로그용)
 */
export function maskApiKey(key: string): string {
  if (!key || key.length < 10) return '***';
  return key.substring(0, 10) + '...' + key.substring(key.length - 4);
}
