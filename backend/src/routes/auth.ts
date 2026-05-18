/**
 * 인증 라우트
 */

import { Router } from 'express';
import { body } from 'express-validator';
import { Role } from '@prisma/client';
import * as authController from '../controllers/authController';
import { authenticate, authorize } from '../middlewares/auth';

const router = Router();

// 회원가입
router.post(
  '/register',
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('name').notEmpty().withMessage('Name required')
  ],
  authController.register
);

// 로그인
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required')
  ],
  authController.login
);

// 현재 사용자 정보
router.get('/me', authenticate, authController.me);

// 비밀번호 변경
router.put(
  '/password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Current password required'),
    body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
  ],
  authController.changePassword
);

// 사용자 목록 (관리자용)
router.get(
  '/users',
  authenticate,
  authorize(Role.SUPER_ADMIN, Role.ADMIN),
  authController.listUsers
);

// 사용자 역할 변경 (슈퍼관리자용)
router.put(
  '/users/:userId/role',
  authenticate,
  authorize(Role.SUPER_ADMIN),
  [body('role').isIn(Object.values(Role)).withMessage('Valid role required')],
  authController.updateUserRole
);

// 사용자 활성화/비활성화 (관리자용)
router.put(
  '/users/:userId/toggle-active',
  authenticate,
  authorize(Role.SUPER_ADMIN, Role.ADMIN),
  authController.toggleUserActive
);

export default router;
