/**
 * 모니터링 및 비용 라우트
 */

import { Router } from 'express';
import * as monitoringController from '../controllers/monitoringController';
import { authenticate } from '../middlewares/auth';

const router = Router();

// 모든 라우트는 인증 필요
router.use(authenticate);

// 대시보드
router.get('/dashboard', monitoringController.getDashboard);

// 과정별 리소스 현황
router.get('/courses/:courseId/resources', monitoringController.getCourseResources);

// 과정별 비용 현황
router.get('/courses/:courseId/costs', monitoringController.getCourseCosts);

// 비용 CSV 내보내기
router.get('/courses/:courseId/costs/export/csv', monitoringController.exportCostsCsv);

// 계정/서브계정 CSV 내보내기
router.get('/courses/:courseId/accounts/export/csv', monitoringController.exportAccountsCsv);

export default router;
