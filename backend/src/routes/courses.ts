/**
 * 과정 관리 라우트
 */

import { Router } from 'express';
import { body, query } from 'express-validator';
import { Role, CourseStatus } from '@prisma/client';
import * as courseController from '../controllers/courseController';
import { syncAllAccounts } from '../controllers/courseSyncController';
import { bulkCleanupResources } from '../controllers/courseCleanupController';
import { getCourseCumulativeCosts } from '../controllers/courseCostController';
import { authenticate, authorize } from '../middlewares/auth';

const router = Router();

router.use(authenticate);

// 과정 목록
router.get(
  '/',
  [
    query('status').optional().isIn(Object.values(CourseStatus)),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 })
  ],
  courseController.listCourses
);

// 과정 통계
router.get('/stats', courseController.getCourseStats);

// 과정 상세
router.get('/:courseId', courseController.getCourse);

// 과정 생성 (관리자)
router.post(
  '/',
  authorize(Role.SUPER_ADMIN, Role.ADMIN),
  [
    body('name').notEmpty().withMessage('Course name required'),
    body('startDate').isISO8601().withMessage('Valid start date required'),
    body('endDate').isISO8601().withMessage('Valid end date required'),
    body('tags').optional().isArray()
  ],
  courseController.createCourse
);

// 과정 수정 (관리자)
router.put(
  '/:courseId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN),
  [
    body('name').optional().notEmpty(),
    body('startDate').optional().isISO8601(),
    body('endDate').optional().isISO8601(),
    body('status').optional().isIn(Object.values(CourseStatus)),
    body('tags').optional().isArray()
  ],
  courseController.updateCourse
);

// 과정 상태 변경 (관리자)
router.put(
  '/:courseId/status',
  authorize(Role.SUPER_ADMIN, Role.ADMIN),
  [body('status').isIn(Object.values(CourseStatus)).withMessage('Valid status required')],
  courseController.updateCourseStatus
);

// 과정 삭제 (슈퍼관리자)
router.delete('/:courseId', authorize(Role.SUPER_ADMIN), courseController.deleteCourse);

// 과정 누적 전체 사용료 조회
router.get('/:courseId/cumulative-costs', getCourseCumulativeCosts);

// 과정 전체 동기화
router.post('/:courseId/sync-all', syncAllAccounts);

// 선택된 계정들의 리소스 일괄 삭제 (슈퍼관리자)
router.post(
  '/:courseId/cleanup-resources',
  authorize(Role.SUPER_ADMIN),
  [
    body('accountIds').isArray({ min: 1 }).withMessage('accountIds must be a non-empty array'),
    body('isDryRun').optional().isBoolean()
  ],
  bulkCleanupResources
);

export default router;
