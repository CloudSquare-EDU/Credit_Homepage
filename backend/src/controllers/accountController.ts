/**
 * NCP 계정 관리 컨트롤러
 */

import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middlewares/auth';
import { createAuditLog, extractAuditInfo, maskApiKey } from '../middlewares/audit';
import { AppError } from '../middlewares/errorHandler';
import { encrypt, decrypt, hashValue } from '../utils/encryption';
import { NcpClient } from '../services/ncp';

const prisma = new PrismaClient();

/**
 * 계정 추가 (단일)
 */
export const addAccount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.params;
    const { accessKey, secretKey, displayName, isMaster } = req.body;

    // 과정 존재 확인
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) {
      throw new AppError('Course not found', 404);
    }

    // 키 해시 생성 (중복 체크용)
    const accessKeyHash = hashValue(accessKey);

    // 중복 체크
    const existing = await prisma.ncpAccount.findFirst({
      where: { accessKeyHash }
    });

    if (existing) {
      throw new AppError('This access key is already registered', 400);
    }

    // 마스터로 지정하는 경우 기존 마스터 해제
    if (isMaster) {
      await prisma.ncpAccount.updateMany({
        where: { courseId, isMaster: true },
        data: { isMaster: false }
      });
    }

    // 암호화
    const accessKeyEncrypted = encrypt(accessKey);
    const secretKeyEncrypted = encrypt(secretKey);

    const account = await prisma.ncpAccount.create({
      data: {
        courseId,
        displayName,
        accessKeyEncrypted,
        secretKeyEncrypted,
        accessKeyHash,
        isMaster: isMaster === true
      },
      select: {
        id: true,
        displayName: true,
        accessKeyHash: true,
        isActive: true,
        isMaster: true,
        createdAt: true
      }
    });

    // 감사 로그
    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'ACCOUNT_ADD',
      entityType: 'NcpAccount',
      entityId: account.id,
      newValue: { displayName, accessKey: maskApiKey(accessKey), isMaster: isMaster === true }
    });

    res.status(201).json({
      success: true,
      data: account
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 계정 일괄 추가
 */
export const addAccountsBulk = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.params;
    const { accounts, startNumber } = req.body;
    // accounts: [{ accessKey, secretKey, displayName? }]

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) {
      throw new AppError('Course not found', 404);
    }

    const results: Array<{ success: boolean; accessKey: string; error?: string; id?: string }> = [];

    for (let i = 0; i < accounts.length; i++) {
      const { accessKey, secretKey, displayName } = accounts[i];

      try {
        const accessKeyHash = hashValue(accessKey);

        const existing = await prisma.ncpAccount.findFirst({
          where: { accessKeyHash }
        });

        if (existing) {
          results.push({
            success: false,
            accessKey: maskApiKey(accessKey),
            error: 'Already registered'
          });
          continue;
        }

        const autoName = startNumber
          ? `교육계정_cs${String(startNumber + i).padStart(3, '0')}`
          : displayName || '';

        const account = await prisma.ncpAccount.create({
          data: {
            courseId,
            displayName: autoName,
            accessKeyEncrypted: encrypt(accessKey),
            secretKeyEncrypted: encrypt(secretKey),
            accessKeyHash
          }
        });

        results.push({
          success: true,
          accessKey: maskApiKey(accessKey),
          id: account.id
        });
      } catch (err) {
        results.push({
          success: false,
          accessKey: maskApiKey(accessKey),
          error: err instanceof Error ? err.message : 'Unknown error'
        });
      }
    }

    const successCount = results.filter(r => r.success).length;

    // 감사 로그
    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'ACCOUNT_BULK_ADD',
      entityType: 'NcpAccount',
      newValue: { courseId, total: accounts.length, success: successCount }
    });

    res.status(201).json({
      success: true,
      data: {
        total: accounts.length,
        success: successCount,
        failed: accounts.length - successCount,
        results
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 계정 목록 조회
 */
export const listAccounts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.params;

    const accounts = await prisma.ncpAccount.findMany({
      where: { courseId },
      select: {
        id: true,
        displayName: true,
        accessKeyHash: true,
        isActive: true,
        isMaster: true,
        ncpMemberNo: true,
        lastSyncAt: true,
        createdAt: true,
        _count: {
          select: { resources: true, subAccounts: true, usageRecords: true }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    res.json({
      success: true,
      data: accounts
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 계정 상세 조회
 */
export const getAccount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { accountId } = req.params;

    const account = await prisma.ncpAccount.findUnique({
      where: { id: accountId },
      include: {
        course: {
          select: { id: true, name: true }
        },
        resources: {
          where: { deletedAt: null },
          orderBy: { resourceType: 'asc' }
        },
        subAccounts: true,
        _count: {
          select: { usageRecords: true }
        }
      }
    });

    if (!account) {
      throw new AppError('Account not found', 404);
    }

    // Access Key 일부만 노출
    const accessKey = decrypt(account.accessKeyEncrypted);

    res.json({
      success: true,
      data: {
        ...account,
        accessKeyEncrypted: undefined,
        secretKeyEncrypted: undefined,
        accessKeyPreview: maskApiKey(accessKey)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 계정 수정
 */
export const updateAccount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { accountId } = req.params;
    const { displayName, accessKey, secretKey, isActive } = req.body;

    const account = await prisma.ncpAccount.findUnique({
      where: { id: accountId }
    });

    if (!account) {
      throw new AppError('Account not found', 404);
    }

    const updateData: Record<string, unknown> = {};

    if (displayName !== undefined) {
      const trimmed = String(displayName).trim();
      if (!trimmed) {
        throw new AppError('계정 이름은 빈 문자열일 수 없습니다', 400);
      }
      updateData.displayName = trimmed;
    }

    if (isActive !== undefined) {
      updateData.isActive = isActive;
    }

    // API 키 변경
    if (accessKey && secretKey) {
      const newHash = hashValue(accessKey);

      // 다른 계정과 중복 체크
      const existing = await prisma.ncpAccount.findFirst({
        where: {
          accessKeyHash: newHash,
          id: { not: accountId }
        }
      });

      if (existing) {
        throw new AppError('This access key is already registered', 400);
      }

      updateData.accessKeyEncrypted = encrypt(accessKey);
      updateData.secretKeyEncrypted = encrypt(secretKey);
      updateData.accessKeyHash = newHash;
    }

    const updatedAccount = await prisma.ncpAccount.update({
      where: { id: accountId },
      data: updateData,
      select: {
        id: true,
        displayName: true,
        accessKeyHash: true,
        isActive: true,
        updatedAt: true
      }
    });

    // 감사 로그
    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'ACCOUNT_UPDATE',
      entityType: 'NcpAccount',
      entityId: accountId,
      newValue: { displayName, isActive, keyChanged: !!(accessKey && secretKey) }
    });

    res.json({
      success: true,
      data: updatedAccount
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 계정 삭제
 */
export const deleteAccount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { accountId } = req.params;

    const account = await prisma.ncpAccount.findUnique({
      where: { id: accountId }
    });

    if (!account) {
      throw new AppError('Account not found', 404);
    }

    await prisma.ncpAccount.delete({
      where: { id: accountId }
    });

    // 감사 로그
    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'ACCOUNT_DELETE',
      entityType: 'NcpAccount',
      entityId: accountId,
      oldValue: { displayName: account.displayName }
    });

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 계정 서비스 조회 (NCP API 호출) - 비용 데이터 포함
 */
export const getAccountServices = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { accountId } = req.params;

    const account = await prisma.ncpAccount.findUnique({
      where: { id: accountId }
    });

    if (!account) {
      throw new AppError('Account not found', 404);
    }

    const accessKey = decrypt(account.accessKeyEncrypted);
    const secretKey = decrypt(account.secretKeyEncrypted);

    const ncpClient = new NcpClient({ accessKey, secretKey });
    // 사용량과 비용을 함께 조회
    const result = await ncpClient.billing.getActiveServicesWithCost();

    // 마지막 동기화 시간 업데이트
    await prisma.ncpAccount.update({
      where: { id: accountId },
      data: { lastSyncAt: new Date() }
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 계정 비용만 조회 (월별 청구 비용)
 * @query month - 조회할 월 (YYYYMM 형식, 예: 202501). 미지정 시 이번 달
 */
export const getAccountCosts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { accountId } = req.params;
    const { month } = req.query;

    const account = await prisma.ncpAccount.findUnique({
      where: { id: accountId }
    });

    if (!account) {
      throw new AppError('Account not found', 404);
    }

    const accessKey = decrypt(account.accessKeyEncrypted);
    const secretKey = decrypt(account.secretKeyEncrypted);

    const ncpClient = new NcpClient({ accessKey, secretKey });

    const isOrganization = account.isMaster ? true : undefined;

    let result;
    if (month && typeof month === 'string' && /^\d{6}$/.test(month)) {
      result = await ncpClient.billing.getMonthlyCostByMonth(month, isOrganization);
    } else {
      result = await ncpClient.billing.getCurrentMonthCost(isOrganization);
    }

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 계정 리소스 동기화
 */
export const syncAccountResources = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { accountId } = req.params;

    const account = await prisma.ncpAccount.findUnique({
      where: { id: accountId }
    });

    if (!account) {
      throw new AppError('Account not found', 404);
    }

    const accessKey = decrypt(account.accessKeyEncrypted);
    const secretKey = decrypt(account.secretKeyEncrypted);

    const ncpClient = new NcpClient({ accessKey, secretKey });
    const resources = await ncpClient.getAllResources();

    // TODO: 리소스를 DB에 저장하는 로직 추가

    // 마지막 동기화 시간 업데이트
    await prisma.ncpAccount.update({
      where: { id: accountId },
      data: { lastSyncAt: new Date() }
    });

    res.json({
      success: true,
      data: resources
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 계정 서브계정 조회
 */
export const getAccountSubAccounts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { accountId } = req.params;

    const account = await prisma.ncpAccount.findUnique({
      where: { id: accountId }
    });

    if (!account) {
      throw new AppError('Account not found', 404);
    }

    const accessKey = decrypt(account.accessKeyEncrypted);
    const secretKey = decrypt(account.secretKeyEncrypted);

    const ncpClient = new NcpClient({ accessKey, secretKey });
    const result = await ncpClient.subAccount.getSubAccounts();

    // DB에 서브계정 정보 동기화
    if (result.success) {
      // NCP에 현재 존재하는 서브계정 ID 목록
      const ncpSubAccountIds = new Set(result.accounts.map(sub => sub.subAccountId));

      // NCP에 있는 서브계정들을 DB에 upsert
      for (const sub of result.accounts) {
        // subAccountName이 없으면 subAccountLoginId를 사용
        const displayName = sub.subAccountName || sub.subAccountLoginId || sub.subAccountId;
        await prisma.subAccount.upsert({
          where: {
            ncpAccountId_subAccountId: {
              ncpAccountId: accountId,
              subAccountId: sub.subAccountId
            }
          },
          update: {
            name: displayName,
            email: sub.email
          },
          create: {
            ncpAccountId: accountId,
            subAccountId: sub.subAccountId,
            name: displayName,
            email: sub.email
          }
        });
      }

      // DB에는 있지만 NCP에는 없는 서브계정 삭제 (수동으로 삭제된 경우)
      await prisma.subAccount.deleteMany({
        where: {
          ncpAccountId: accountId,
          subAccountId: {
            notIn: Array.from(ncpSubAccountIds)
          }
        }
      });
    }

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 과정 내 전체 계정 이름 일괄 변경
 */
export const bulkRenameAccounts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.params;
    const { prefix, startNumber } = req.body;

    if (!prefix || startNumber === undefined) {
      throw new AppError('prefix and startNumber are required', 400);
    }

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) {
      throw new AppError('Course not found', 404);
    }

    const accounts = await prisma.ncpAccount.findMany({
      where: { courseId },
      orderBy: { createdAt: 'asc' },
      select: { id: true }
    });

    await prisma.$transaction(
      accounts.map((account, i) =>
        prisma.ncpAccount.update({
          where: { id: account.id },
          data: { displayName: `${prefix}${String(Number(startNumber) + i).padStart(3, '0')}` }
        })
      )
    );

    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'ACCOUNT_BULK_RENAME',
      entityType: 'NcpAccount',
      newValue: { courseId, prefix, startNumber, renamed: accounts.length }
    });

    res.json({
      success: true,
      data: { renamed: accounts.length }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 회원번호 일괄 설정 (엑셀 데이터 기반)
 * assignments: [{ displayName: "교육계정_cs091", memberNo: "3697296" }, ...]
 */
export const bulkSetMemberNumbers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.params;
    const { assignments } = req.body as {
      assignments: Array<{ displayName: string; memberNo: string }>;
    };

    if (!Array.isArray(assignments) || assignments.length === 0) {
      throw new AppError('assignments array required', 400);
    }

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new AppError('Course not found', 404);

    const accounts = await prisma.ncpAccount.findMany({
      where: { courseId },
      select: { id: true, displayName: true }
    });

    const results: Array<{ displayName: string; memberNo: string; status: 'updated' | 'not_found' }> = [];
    let updatedCount = 0;

    for (const { displayName, memberNo } of assignments) {
      const account = accounts.find(a => a.displayName === displayName);
      if (!account) {
        results.push({ displayName, memberNo, status: 'not_found' });
        continue;
      }
      await prisma.ncpAccount.update({
        where: { id: account.id },
        data: { ncpMemberNo: memberNo }
      });
      results.push({ displayName, memberNo, status: 'updated' });
      updatedCount++;
    }

    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'ACCOUNT_BULK_SET_MEMBER_NO',
      entityType: 'NcpAccount',
      newValue: { courseId, total: assignments.length, updated: updatedCount }
    });

    res.json({
      success: true,
      data: { total: assignments.length, updated: updatedCount, results }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Organization 마스터 계정 지정 (과정당 하나)
 * 기존 마스터 계정 해제 후 지정된 계정을 마스터로 설정
 */
export const setMasterAccount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { accountId } = req.params;

    const account = await prisma.ncpAccount.findUnique({
      where: { id: accountId }
    });

    if (!account) {
      throw new AppError('Account not found', 404);
    }

    // 같은 과정의 기존 마스터 계정 해제
    await prisma.ncpAccount.updateMany({
      where: { courseId: account.courseId, isMaster: true, id: { not: accountId } },
      data: { isMaster: false }
    });

    // 이 계정을 마스터로 지정
    const updated = await prisma.ncpAccount.update({
      where: { id: accountId },
      data: { isMaster: true },
      select: { id: true, displayName: true, isMaster: true }
    });

    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'ACCOUNT_SET_MASTER',
      entityType: 'NcpAccount',
      entityId: accountId,
      newValue: { courseId: account.courseId, isMaster: true }
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

/**
 * Organization 마스터 계정 해제
 */
export const unsetMasterAccount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { accountId } = req.params;

    const account = await prisma.ncpAccount.findUnique({
      where: { id: accountId }
    });

    if (!account) {
      throw new AppError('Account not found', 404);
    }

    const updated = await prisma.ncpAccount.update({
      where: { id: accountId },
      data: { isMaster: false },
      select: { id: true, displayName: true, isMaster: true }
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

/**
 * 서브계정 비밀번호 초기화
 * NCP Sub Account API를 통해 새 비밀번호를 설정합니다.
 */
export const resetSubAccountPassword = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { accountId, subAccountId } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: '비밀번호는 8자 이상이어야 합니다'
      });
    }

    const account = await prisma.ncpAccount.findUnique({
      where: { id: accountId }
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        error: '계정을 찾을 수 없습니다'
      });
    }

    const accessKey = decrypt(account.accessKeyEncrypted);
    const secretKey = decrypt(account.secretKeyEncrypted);

    const ncpClient = new NcpClient({ accessKey, secretKey });
    const result = await ncpClient.subAccount.resetSubAccountPassword(subAccountId, newPassword);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || '비밀번호 초기화에 실패했습니다'
      });
    }

    await createAuditLog({
      ...extractAuditInfo(req),
      action: 'SUBACCOUNT_PASSWORD_RESET',
      entityType: 'SubAccount',
      entityId: subAccountId,
      newValue: { ncpAccountId: accountId, subAccountId }
    });

    res.json({
      success: true,
      message: '비밀번호가 초기화되었습니다'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 서브계정 개별 삭제
 */
export const deleteSubAccount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { accountId, subAccountId } = req.params;

    const account = await prisma.ncpAccount.findUnique({
      where: { id: accountId }
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        error: '계정을 찾을 수 없습니다'
      });
    }

    const accessKey = decrypt(account.accessKeyEncrypted);
    const secretKey = decrypt(account.secretKeyEncrypted);

    const ncpClient = new NcpClient({ accessKey, secretKey });

    // NCP API를 통해 서브계정 삭제
    const result = await ncpClient.subAccount.deleteSubAccount(subAccountId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || '서브계정 삭제에 실패했습니다'
      });
    }

    // DB에서도 서브계정 정보 삭제
    await prisma.subAccount.deleteMany({
      where: {
        ncpAccountId: accountId,
        subAccountId: subAccountId
      }
    });

    res.json({
      success: true,
      message: '서브계정이 삭제되었습니다',
      data: { subAccountId }
    });
  } catch (error) {
    next(error);
  }
};
