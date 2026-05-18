/**
 * 인증 컨트롤러
 * 회원가입, 로그인, 사용자 관리
 */

import { Response, NextFunction } from 'express';
import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AuthRequest } from '../middlewares/auth';
import { createAuditLog, extractAuditInfo } from '../middlewares/audit';
import { AppError } from '../middlewares/errorHandler';

const prisma = new PrismaClient();

/**
 * 회원가입
 */
export const register = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password, name, role } = req.body;

    // 이메일 중복 체크
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new AppError('Email already exists', 400);
    }

    // 비밀번호 해시
    const hashedPassword = await bcrypt.hash(password, 12);

    // 첫 번째 사용자는 SUPER_ADMIN
    const userCount = await prisma.user.count();
    const assignedRole = userCount === 0 ? Role.SUPER_ADMIN : (role || Role.VIEWER);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: assignedRole
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true
      }
    });

    // 감사 로그
    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'USER_REGISTER',
      entityType: 'User',
      entityId: user.id,
      newValue: { email, name, role: assignedRole }
    });

    // JWT 토큰 생성
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.status(201).json({
      success: true,
      data: { user, token }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 로그인
 */
export const login = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.isActive) {
      throw new AppError('Invalid credentials', 401);
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new AppError('Invalid credentials', 401);
    }

    // 마지막 로그인 시간 업데이트
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    // 감사 로그
    await createAuditLog({
      ...extractAuditInfo(req),
      userId: user.id,
      action: 'USER_LOGIN',
      entityType: 'User',
      entityId: user.id
    });

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        },
        token
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 현재 사용자 정보
 */
export const me = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        lastLoginAt: true
      }
    });

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 비밀번호 변경
 */
export const changePassword = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new AppError('Current password is incorrect', 400);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword }
    });

    // 감사 로그
    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'USER_PASSWORD_CHANGE',
      entityType: 'User',
      entityId: user.id
    });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 사용자 목록 (관리자용)
 */
export const listUsers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        lastLoginAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 사용자 역할 변경 (관리자용)
 */
export const updateUserRole = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (userId === req.user!.id) {
      throw new AppError('Cannot change your own role', 400);
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const oldRole = user.role;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: {
        id: true,
        email: true,
        name: true,
        role: true
      }
    });

    // 감사 로그
    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'USER_ROLE_CHANGE',
      entityType: 'User',
      entityId: userId,
      oldValue: { role: oldRole },
      newValue: { role }
    });

    res.json({
      success: true,
      data: updatedUser
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 사용자 활성화/비활성화 (관리자용)
 */
export const toggleUserActive = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.params;

    if (userId === req.user!.id) {
      throw new AppError('Cannot deactivate yourself', 400);
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { isActive: !user.isActive },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true
      }
    });

    // 감사 로그
    await createAuditLog({
      ...extractAuditInfo(req),
      action: user.isActive ? 'USER_DEACTIVATE' : 'USER_ACTIVATE',
      entityType: 'User',
      entityId: userId
    });

    res.json({
      success: true,
      data: updatedUser
    });
  } catch (error) {
    next(error);
  }
};
