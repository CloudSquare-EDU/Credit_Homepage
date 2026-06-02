/**
 * 과정 관리 컨트롤러 — CRUD + 통계
 * 동기화: courseSyncController.ts
 * 정리:   courseCleanupController.ts
 * 비용:   courseCostController.ts
 */

import { Response, NextFunction } from 'express';
import { PrismaClient, CourseStatus } from '@prisma/client';
import { AuthRequest } from '../middlewares/auth';
import { createAuditLog, extractAuditInfo } from '../middlewares/audit';
import { AppError } from '../middlewares/errorHandler';
import { config } from '../config';
import logger from '../utils/logger';

const prisma = new PrismaClient();

/**
 * 날짜 기준으로 과정 상태를 자동 계산 (ARCHIVED는 수동 유지)
 */
export function computeEffectiveStatus(status: CourseStatus, startDate: Date, endDate: Date): CourseStatus {
  if (status === CourseStatus.ARCHIVED) return CourseStatus.ARCHIVED;
  const now = new Date();
  if (now < startDate) return CourseStatus.DRAFT;
  if (now > endDate) return CourseStatus.COMPLETED;
  return CourseStatus.ACTIVE;
}

/**
 * 과정 생성
 */
export const createCourse = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { name, description, startDate, endDate, billingPeriod, tags, budgetAmount, budgetRatio } = req.body;

    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      throw new AppError('종료일은 시작일보다 이후여야 합니다', 400);
    }
    if (budgetAmount !== undefined && budgetAmount !== null && Number(budgetAmount) < 0) {
      throw new AppError('예산 금액은 0 이상이어야 합니다', 400);
    }
    if (budgetRatio !== undefined && budgetRatio !== null) {
      const ratio = Number(budgetRatio);
      if (ratio < 0 || ratio > 100) throw new AppError('할당 비율은 0~100 사이여야 합니다', 400);
    }

    const course = await prisma.course.create({
      data: {
        name,
        description,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        billingPeriod,
        tags: tags || [],
        status: CourseStatus.DRAFT,
        budgetAmount: budgetAmount !== undefined ? Number(budgetAmount) : null,
        budgetRatio: budgetRatio !== undefined ? Number(budgetRatio) : null
      }
    });

    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'COURSE_CREATE',
      entityType: 'Course',
      entityId: course.id,
      newValue: { name, startDate, endDate }
    });

    res.status(201).json({ success: true, data: course });
  } catch (error) {
    next(error);
  }
};

/**
 * 과정 목록 조회
 */
export const listCourses = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { status, search, page = 1, limit = config.pagination.defaultLimit } = req.query;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where,
        include: {
          _count: { select: { accounts: true } },
          costSnapshots: { orderBy: { createdAt: 'desc' }, take: 1, select: { totalCost: true, createdAt: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit)
      }),
      prisma.course.count({ where })
    ]);

    // 날짜 기준 상태 보정 (non-blocking)
    const statusUpdates: { id: string; status: CourseStatus }[] = [];
    const coursesWithStatus = courses.map(course => {
      const effective = computeEffectiveStatus(course.status, course.startDate, course.endDate);
      if (effective !== course.status) {
        statusUpdates.push({ id: course.id, status: effective });
        return { ...course, status: effective };
      }
      return course;
    });

    if (statusUpdates.length > 0) {
      Promise.allSettled(
        statusUpdates.map(u => prisma.course.update({ where: { id: u.id }, data: { status: u.status } }))
      ).then(results => {
        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length > 0) logger.error('Status auto-update failed:', failed[0]);
      });
    }

    res.json({
      success: true,
      data: coursesWithStatus,
      pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 과정 상세 조회
 */
export const getCourse = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.params;

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        accounts: {
          select: {
            id: true,
            displayName: true,
            accessKeyHash: true,
            isActive: true,
            isMaster: true,
            ncpMemberNo: true,
            totalCumulativeCost: true,
            cumulativeCostUpdatedAt: true,
            lastSyncAt: true,
            createdAt: true,
            _count: { select: { resources: true, subAccounts: true } }
          }
        },
        _count: { select: { accounts: true, costSnapshots: true } }
      }
    });

    if (!course) throw new AppError('Course not found', 404);

    const effective = computeEffectiveStatus(course.status, course.startDate, course.endDate);
    if (effective !== course.status) {
      prisma.course.update({ where: { id: course.id }, data: { status: effective } })
        .catch(err => logger.error('Status auto-update failed:', err));
    }

    res.json({ success: true, data: { ...course, status: effective } });
  } catch (error) {
    next(error);
  }
};

/**
 * 과정 수정
 */
export const updateCourse = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.params;
    const { name, description, startDate, endDate, billingPeriod, tags, status, budgetAmount, budgetRatio } = req.body;

    const existingCourse = await prisma.course.findUnique({ where: { id: courseId } });
    if (!existingCourse) throw new AppError('Course not found', 404);

    const resolvedStart = startDate ? new Date(startDate) : existingCourse.startDate;
    const resolvedEnd = endDate ? new Date(endDate) : existingCourse.endDate;
    if (resolvedEnd < resolvedStart) throw new AppError('종료일은 시작일보다 이후여야 합니다', 400);

    if (budgetAmount !== undefined && budgetAmount !== null && Number(budgetAmount) < 0) {
      throw new AppError('예산 금액은 0 이상이어야 합니다', 400);
    }
    if (budgetRatio !== undefined && budgetRatio !== null) {
      const ratio = Number(budgetRatio);
      if (ratio < 0 || ratio > 100) throw new AppError('할당 비율은 0~100 사이여야 합니다', 400);
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined)          updateData.name          = name;
    if (description !== undefined)   updateData.description   = description;
    if (startDate !== undefined)     updateData.startDate     = new Date(startDate);
    if (endDate !== undefined)       updateData.endDate       = new Date(endDate);
    if (billingPeriod !== undefined) updateData.billingPeriod = billingPeriod;
    if (tags !== undefined)          updateData.tags          = tags;
    if (status !== undefined)        updateData.status        = status;
    if (budgetAmount !== undefined)  updateData.budgetAmount  = budgetAmount === null ? null : Number(budgetAmount);
    if (budgetRatio !== undefined)   updateData.budgetRatio   = budgetRatio  === null ? null : Number(budgetRatio);

    const course = await prisma.course.update({ where: { id: courseId }, data: updateData });

    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'COURSE_UPDATE',
      entityType: 'Course',
      entityId: courseId,
      oldValue: existingCourse,
      newValue: updateData
    });

    res.json({ success: true, data: course });
  } catch (error) {
    next(error);
  }
};

/**
 * 과정 삭제
 */
export const deleteCourse = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.params;

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new AppError('Course not found', 404);

    await prisma.course.delete({ where: { id: courseId } });

    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'COURSE_DELETE',
      entityType: 'Course',
      entityId: courseId,
      oldValue: { name: course.name }
    });

    res.json({ success: true, message: 'Course deleted successfully' });
  } catch (error) {
    next(error);
  }
};

/**
 * 과정 상태 변경
 */
export const updateCourseStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.params;
    const { status } = req.body;

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new AppError('Course not found', 404);

    const updatedCourse = await prisma.course.update({ where: { id: courseId }, data: { status } });

    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'COURSE_STATUS_CHANGE',
      entityType: 'Course',
      entityId: courseId,
      oldValue: { status: course.status },
      newValue: { status }
    });

    res.json({ success: true, data: updatedCourse });
  } catch (error) {
    next(error);
  }
};

/**
 * 과정 통계
 */
export const getCourseStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const [total, byStatus, upcoming, active] = await Promise.all([
      prisma.course.count(),
      prisma.course.groupBy({ by: ['status'], _count: true }),
      prisma.course.count({ where: { startDate: { gt: new Date() } } }),
      prisma.course.count({ where: { status: CourseStatus.ACTIVE, startDate: { lte: new Date() }, endDate: { gte: new Date() } } })
    ]);

    const statusMap = byStatus.reduce((acc, item) => {
      acc[item.status] = item._count;
      return acc;
    }, {} as Record<string, number>);

    res.json({ success: true, data: { total, byStatus: statusMap, upcoming, active } });
  } catch (error) {
    next(error);
  }
};
