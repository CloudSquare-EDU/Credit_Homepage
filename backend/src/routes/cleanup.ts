/**
 * 자동 정리 라우트
 */

import { Router } from 'express';
import { body } from 'express-validator';
import { Role } from '@prisma/client';
import * as cleanupController from '../controllers/cleanupController';
import { authenticate, authorize } from '../middlewares/auth';

const router = Router();

// 모든 라우트는 인증 필요
router.use(authenticate);

// 정리 작업 목록
router.get('/jobs', cleanupController.listCleanupJobs);

// 정리 작업 상세
router.get('/jobs/:jobId', cleanupController.getCleanupJob);

// 정리 미리보기 (Dry-run)
router.get(
  '/courses/:courseId/preview',
  authorize(Role.SUPER_ADMIN, Role.ADMIN),
  cleanupController.previewCleanup
);

// 정리 작업 생성
router.post(
  '/courses/:courseId/jobs',
  authorize(Role.SUPER_ADMIN, Role.ADMIN),
  [
    body('isDryRun').optional().isBoolean(),
    body('scheduledAt').optional().isISO8601()
  ],
  cleanupController.createCleanupJob
);

// 정리 작업 실행 (슈퍼관리자만)
router.post(
  '/jobs/:jobId/execute',
  authorize(Role.SUPER_ADMIN),
  [body('confirm').equals('DELETE_ALL_RESOURCES').withMessage('Confirmation required')],
  cleanupController.executeCleanup
);

// 정리 작업 취소
router.post(
  '/jobs/:jobId/cancel',
  authorize(Role.SUPER_ADMIN, Role.ADMIN),
  cleanupController.cancelCleanupJob
);

export default router;
