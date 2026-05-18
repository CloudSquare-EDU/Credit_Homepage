/**
 * NCP 계정 관리 라우트
 */

import { Router } from 'express';
import { body } from 'express-validator';
import { Role } from '@prisma/client';
import * as accountController from '../controllers/accountController';
import { authenticate, authorize } from '../middlewares/auth';

const router = Router();

// 모든 라우트는 인증 필요
router.use(authenticate);

// 과정의 계정 목록
router.get('/course/:courseId', accountController.listAccounts);

// 계정 추가 (관리자)
router.post(
  '/course/:courseId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN),
  [
    body('accessKey').notEmpty().withMessage('Access key required'),
    body('secretKey').notEmpty().withMessage('Secret key required')
  ],
  accountController.addAccount
);

// 계정 일괄 추가 (관리자)
router.post(
  '/course/:courseId/bulk',
  authorize(Role.SUPER_ADMIN, Role.ADMIN),
  [
    body('accounts').isArray({ min: 1 }).withMessage('Accounts array required'),
    body('accounts.*.accessKey').notEmpty().withMessage('Access key required'),
    body('accounts.*.secretKey').notEmpty().withMessage('Secret key required')
  ],
  accountController.addAccountsBulk
);

// 회원번호 일괄 설정 (관리자)
router.post(
  '/course/:courseId/member-numbers',
  authorize(Role.SUPER_ADMIN, Role.ADMIN),
  [body('assignments').isArray({ min: 1 }).withMessage('assignments array required')],
  accountController.bulkSetMemberNumbers
);

// 과정 내 전체 계정 이름 일괄 변경 (관리자)
router.put(
  '/course/:courseId/bulk-rename',
  authorize(Role.SUPER_ADMIN, Role.ADMIN),
  [
    body('prefix').notEmpty().withMessage('prefix required'),
    body('startNumber').isInt({ min: 0 }).withMessage('startNumber must be a non-negative integer')
  ],
  accountController.bulkRenameAccounts
);

// 계정 상세
router.get('/:accountId', accountController.getAccount);

// 계정 수정 (관리자)
router.put(
  '/:accountId',
  authorize(Role.SUPER_ADMIN, Role.ADMIN),
  accountController.updateAccount
);

// 계정 삭제 (슈퍼관리자)
router.delete(
  '/:accountId',
  authorize(Role.SUPER_ADMIN),
  accountController.deleteAccount
);

// Organization 마스터 계정 지정 (관리자)
router.put(
  '/:accountId/set-master',
  authorize(Role.SUPER_ADMIN, Role.ADMIN),
  accountController.setMasterAccount
);

// Organization 마스터 계정 해제 (관리자)
router.put(
  '/:accountId/unset-master',
  authorize(Role.SUPER_ADMIN, Role.ADMIN),
  accountController.unsetMasterAccount
);

// 계정 서비스 조회 (비용 포함)
router.get('/:accountId/services', accountController.getAccountServices);

// 계정 비용만 조회
router.get('/:accountId/costs', accountController.getAccountCosts);

// 계정 리소스 동기화
router.post('/:accountId/sync', accountController.syncAccountResources);

// 계정 서브계정 조회
router.get('/:accountId/sub-accounts', accountController.getAccountSubAccounts);

// 서브계정 비밀번호 초기화 (관리자)
router.post(
  '/:accountId/sub-accounts/:subAccountId/reset-password',
  authorize(Role.SUPER_ADMIN, Role.ADMIN),
  [body('newPassword').notEmpty().withMessage('새 비밀번호를 입력해주세요')],
  accountController.resetSubAccountPassword
);

// 서브계정 개별 삭제 (슈퍼관리자)
router.delete(
  '/:accountId/sub-accounts/:subAccountId',
  authorize(Role.SUPER_ADMIN),
  accountController.deleteSubAccount
);

export default router;
