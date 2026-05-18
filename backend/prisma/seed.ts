/**
 * 데이터베이스 시드 스크립트
 * 초기 관리자 계정 생성
 */

import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  // 기존 관리자 확인
  const existingAdmin = await prisma.user.findFirst({
    where: { role: Role.SUPER_ADMIN }
  });

  if (existingAdmin) {
    console.log('Super admin already exists:', existingAdmin.email);
    return;
  }

  // 초기 관리자 생성
  const hashedPassword = await bcrypt.hash('admin1234!', 12);

  const admin = await prisma.user.create({
    data: {
      email: 'admin@example.com',
      password: hashedPassword,
      name: 'System Admin',
      role: Role.SUPER_ADMIN
    }
  });

  console.log('Created super admin:', admin.email);

  // 샘플 과정 생성
  const sampleCourse = await prisma.course.create({
    data: {
      name: '클라우드 기초 교육 (샘플)',
      description: '네이버 클라우드 플랫폼 기초 교육 과정',
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30일 후
      billingPeriod: new Date().toISOString().slice(0, 7), // 현재 월
      tags: ['교육', '기초', 'NCP'],
      status: 'DRAFT'
    }
  });

  console.log('Created sample course:', sampleCourse.name);

  console.log('Database seed completed!');
  console.log('');
  console.log('Initial admin credentials:');
  console.log('  Email: admin@example.com');
  console.log('  Password: admin1234!');
  console.log('');
  console.log('Please change the password after first login!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
