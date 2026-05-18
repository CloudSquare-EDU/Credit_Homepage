# NCP 교육계정 관리 시스템

네이버 클라우드 플랫폼(NCP) 교육 계정을 효율적으로 관리하기 위한 웹 기반 관리 시스템입니다.

## 주요 기능

- **과정 관리**: 교육 과정 생성/수정/삭제, 기간 및 태그 관리
- **계정 매핑**: NCP API 키 암호화 저장, 과정별 계정 관리
- **사용량 모니터링**: NCP API를 통한 실시간 리소스 조회
- **비용 집계**: 과정별/기간별 비용 집계 및 CSV 내보내기
- **자동 정리**: 과정 종료 시 리소스 자동 삭제 (Dry-run 지원)
- **감사 로그**: 모든 작업 이력 추적

## 기술 스택

### Backend
- Node.js + TypeScript
- Express.js
- Prisma ORM
- PostgreSQL
- JWT 인증
- AES-256-GCM 암호화

### Frontend
- React 18 + TypeScript
- Vite
- Tailwind CSS
- React Router
- Zustand (상태관리)

## 빠른 시작

### 사전 요구사항
- Node.js 18+
- PostgreSQL 14+
- npm 또는 yarn

### 1. 저장소 클론
```bash
cd Account
```

### 2. Backend 설정
```bash
cd backend

# 의존성 설치
npm install

# 환경변수 설정
cp .env.example .env
# .env 파일을 열어 데이터베이스 URL 등 수정

# 데이터베이스 마이그레이션
npx prisma migrate dev

# 초기 관리자 생성
npm run seed

# 개발 서버 시작
npm run dev
```

### 3. Frontend 설정
```bash
cd frontend

# 의존성 설치
npm install

# 개발 서버 시작
npm run dev
```

### 4. 접속
- Frontend: http://localhost:3000
- Backend API: http://localhost:4000/api

### 5. 초기 로그인
- Email: admin@example.com
- Password: admin1234!

> ⚠️ 첫 로그인 후 반드시 비밀번호를 변경하세요!

## 환경 변수

### Backend (.env)
```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/ncp_edu_manager?schema=public"

# JWT
JWT_SECRET="your-super-secret-jwt-key-change-in-production"
JWT_EXPIRES_IN="24h"

# Encryption (32 bytes for AES-256)
ENCRYPTION_KEY="your-32-byte-encryption-key-here"

# Server
PORT=4000
NODE_ENV=development

# CORS
FRONTEND_URL="http://localhost:3000"
```

## API 엔드포인트

### 인증
| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | /api/auth/register | 회원가입 |
| POST | /api/auth/login | 로그인 |
| GET | /api/auth/me | 현재 사용자 |
| PUT | /api/auth/password | 비밀번호 변경 |

### 과정 관리
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | /api/courses | 과정 목록 |
| POST | /api/courses | 과정 생성 |
| GET | /api/courses/:id | 과정 상세 |
| PUT | /api/courses/:id | 과정 수정 |
| DELETE | /api/courses/:id | 과정 삭제 |

### 계정 관리
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | /api/accounts/course/:courseId | 계정 목록 |
| POST | /api/accounts/course/:courseId | 계정 추가 |
| POST | /api/accounts/course/:courseId/bulk | 계정 일괄 추가 |
| GET | /api/accounts/:id | 계정 상세 |
| GET | /api/accounts/:id/services | 서비스 조회 |
| POST | /api/accounts/:id/sync | 리소스 동기화 |

### 모니터링
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | /api/monitoring/dashboard | 대시보드 |
| GET | /api/monitoring/courses/:id/resources | 리소스 현황 |
| GET | /api/monitoring/courses/:id/costs | 비용 현황 |

### 정리 작업
| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | /api/cleanup/courses/:id/preview | 정리 미리보기 |
| POST | /api/cleanup/courses/:id/jobs | 정리 작업 생성 |
| POST | /api/cleanup/jobs/:id/execute | 정리 실행 |

## 프로젝트 구조

```
Account/
├── backend/
│   ├── src/
│   │   ├── config/          # 환경설정
│   │   ├── controllers/     # API 컨트롤러
│   │   ├── middlewares/     # 인증, 에러처리
│   │   ├── routes/          # 라우트 정의
│   │   ├── services/
│   │   │   └── ncp/         # NCP API 통합
│   │   ├── utils/           # 암호화, 로깅
│   │   └── jobs/            # 스케줄러
│   └── prisma/
│       └── schema.prisma    # DB 스키마
│
├── frontend/
│   └── src/
│       ├── components/      # UI 컴포넌트
│       ├── pages/           # 페이지
│       ├── services/        # API 서비스
│       ├── hooks/           # React 훅
│       └── types/           # TypeScript 타입
│
└── docs/
    └── ARCHITECTURE.md      # 아키텍처 문서
```

## 역할 및 권한

| 역할 | 권한 |
|------|------|
| SUPER_ADMIN | 모든 권한 (사용자 관리, 실제 삭제 실행) |
| ADMIN | 과정/계정 관리, Dry-run 실행 |
| VIEWER | 읽기 전용 |

## 제한사항

### NCP API 제한
- 일부 서비스는 API를 통한 삭제 미지원
  - Object Storage (Console에서 수동 삭제)
  - Cloud DB (Console에서 수동 삭제)
  - Kubernetes Service (Console에서 수동 삭제)
- 서비스 구독 자체 해지는 API 미제공 (Console 필요)

### 보안
- API 키는 AES-256-GCM으로 암호화 저장
- ENCRYPTION_KEY 유출 시 모든 키 재등록 필요
- 프로덕션 환경에서는 반드시 강력한 시크릿 사용

## 프로덕션 배포

### 무료 클라우드 배포 (권장)

완전 무료로 24시간 운영되는 서비스를 배포하는 방법:

**배포 가이드**: [DEPLOYMENT.md](./DEPLOYMENT.md) 참조

배포 구성:
- **데이터베이스**: Neon (500MB 무료)
- **백엔드**: Render (무료, 15분 비활성 시 sleep)
- **프론트엔드**: Vercel (무료, 무제한)

총 소요시간: **약 30분**

### Docker 배포
```bash
# Backend
docker build -t ncp-edu-backend ./backend
docker run -d -p 4000:4000 --env-file .env ncp-edu-backend

# Frontend
docker build -t ncp-edu-frontend ./frontend
docker run -d -p 3000:80 ncp-edu-frontend
```

### 일반 배포
```bash
# Backend
cd backend
npm run build
npm start

# Frontend
cd frontend
npm run build
# dist 폴더를 nginx 등으로 서빙
```

## 라이선스

MIT License
