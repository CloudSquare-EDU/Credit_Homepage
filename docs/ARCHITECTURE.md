# NCP 교육계정 관리 시스템 - 아키텍처 설계

## 1. 시스템 개요

### 1.1 목적
네이버 클라우드 플랫폼(NCP) 교육 계정을 효율적으로 관리하기 위한 웹 기반 관리 시스템

### 1.2 주요 기능
- 과정 관리 (CRUD, 기간/태그 관리)
- NCP 계정 매핑 (암호화 저장)
- 사용량 모니터링 (NCP API 연동)
- 비용 집계 및 리포트
- 과정 종료 시 자동 정리

---

## 2. 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Frontend (React)                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │Dashboard │ │ Courses  │ │ Accounts │ │ Cleanup  │ │ Settings │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │ HTTP/REST
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Backend (Node.js/Express)                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                        API Gateway                              │ │
│  │  • JWT Authentication                                           │ │
│  │  • RBAC Authorization                                           │ │
│  │  • Request Validation                                           │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                  │                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │   Auth   │ │ Courses  │ │ Accounts │ │Monitoring│ │ Cleanup  │  │
│  │Controller│ │Controller│ │Controller│ │Controller│ │Controller│  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
│                                  │                                   │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                      Service Layer                              │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │ │
│  │  │  Encryption │ │  NCP Client │ │   Scheduler │               │ │
│  │  │   (AES-256) │ │  (API Wrap) │ │  (node-cron)│               │ │
│  │  └─────────────┘ └─────────────┘ └─────────────┘               │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│    PostgreSQL    │   │    NCP APIs      │   │   File System    │
│  ┌────────────┐  │   │  ┌────────────┐  │   │  ┌────────────┐  │
│  │   Users    │  │   │  │  Billing   │  │   │  │    Logs    │  │
│  │  Courses   │  │   │  │SubAccount  │  │   │  │   Export   │  │
│  │  Accounts  │  │   │  │  Server    │  │   │  └────────────┘  │
│  │  Resources │  │   │  │   VPC      │  │   └──────────────────┘
│  │   Usage    │  │   │  │  Storage   │  │
│  │ AuditLogs  │  │   │  │    LB      │  │
│  └────────────┘  │   │  └────────────┘  │
└──────────────────┘   └──────────────────┘
```

---

## 3. 컴포넌트 상세

### 3.1 Frontend (React + TypeScript)
```
frontend/
├── src/
│   ├── components/      # 재사용 가능한 UI 컴포넌트
│   ├── pages/           # 페이지 컴포넌트
│   ├── services/        # API 호출 서비스
│   ├── hooks/           # 커스텀 React 훅
│   ├── types/           # TypeScript 타입 정의
│   └── styles/          # Tailwind CSS 스타일
```

### 3.2 Backend (Node.js + Express + TypeScript)
```
backend/
├── src/
│   ├── config/          # 환경설정
│   ├── controllers/     # 라우트 핸들러
│   ├── middlewares/     # 인증, 감사로그 등
│   ├── routes/          # API 라우트 정의
│   ├── services/        # 비즈니스 로직
│   │   └── ncp/         # NCP API 통합
│   ├── utils/           # 유틸리티 (암호화, 로깅)
│   └── jobs/            # 스케줄러 작업
├── prisma/
│   └── schema.prisma    # 데이터베이스 스키마
```

---

## 4. 데이터 흐름

### 4.1 인증 흐름
```
User → Login Request → Backend → bcrypt verify → JWT Token → Frontend
                                                      ↓
                                              localStorage
                                                      ↓
                                        Subsequent requests with
                                        Authorization: Bearer <token>
```

### 4.2 계정 등록 흐름
```
Admin → Input Keys → Frontend → API Request → Backend
                                                  ↓
                                          Encrypt (AES-256-GCM)
                                                  ↓
                                          Store in PostgreSQL
                                                  ↓
                                          Audit Log
```

### 4.3 리소스 동기화 흐름
```
User → Sync Request → Backend → Decrypt Keys → NCP API
                                                   ↓
                                          Server/VPC/Storage APIs
                                                   ↓
                                          Parse Response
                                                   ↓
                                          Update DB Resources
                                                   ↓
                                          Return to Frontend
```

### 4.4 자동 정리 흐름
```
Scheduler (03:00) → Check Ended Courses → Mark as COMPLETED
                                              ↓
                                    Create Cleanup Job (Dry-run)
                                              ↓
Admin → Review Preview → Confirm → Execute Cleanup
                                              ↓
                          For each account:
                          1. Delete Servers
                          2. Delete Load Balancers
                          3. Delete NAT Gateways
                          4. Delete Sub-accounts
                                              ↓
                                    Log all actions
```

---

## 5. 보안 모델

### 5.1 인증 (Authentication)
- **방식**: JWT (JSON Web Token)
- **토큰 만료**: 24시간
- **저장**: localStorage (클라이언트)
- **전송**: Authorization 헤더

### 5.2 인가 (Authorization)
- **RBAC (Role-Based Access Control)**
  - `SUPER_ADMIN`: 모든 권한, 사용자 관리, 실제 삭제 실행
  - `ADMIN`: 과정/계정 관리, 읽기/쓰기
  - `VIEWER`: 읽기 전용

### 5.3 암호화
- **알고리즘**: AES-256-GCM
- **키 파생**: PBKDF2 (100,000 iterations)
- **저장 형식**: `salt:iv:authTag:ciphertext` (Base64)

### 5.4 감사 로그
모든 중요 작업 기록:
- 사용자 로그인/로그아웃
- 과정 생성/수정/삭제
- 계정 추가/수정/삭제
- 정리 작업 생성/실행

---

## 6. NCP API 연동

### 6.1 사용 API 목록
| API | 용도 | 엔드포인트 |
|-----|------|-----------|
| Billing API | 사용량/비용 조회 | billingapi.apigw.ntruss.com |
| Sub Account API | 서브계정 관리 | subaccount.apigw.ntruss.com |
| Server API | VPC 서버 관리 | ncloud.apigw.ntruss.com |
| VPC API | 네트워크 리소스 | ncloud.apigw.ntruss.com |
| Storage API | 스토리지 관리 | ncloud.apigw.ntruss.com |
| Load Balancer API | LB 관리 | ncloud.apigw.ntruss.com |

### 6.2 API 서명 방식
```
Signature = Base64(HMAC-SHA256(SecretKey, StringToSign))

StringToSign = Method + " " + URI + "\n" + Timestamp + "\n" + AccessKey
```

### 6.3 서비스 해지 제한 사항
**지원됨:**
- 서버 인스턴스 반납 (terminateServerInstances)
- 블록 스토리지 삭제 (deleteBlockStorageInstances)
- NAT Gateway 삭제 (deleteNatGatewayInstance)
- Load Balancer 삭제 (deleteLoadBalancerInstances)
- 서브계정 삭제 (DELETE /sub-accounts/{id})

**미지원 (수동 필요):**
- Object Storage 버킷 삭제 (Console에서 수동)
- Cloud DB 인스턴스 삭제 (Console에서 수동)
- Kubernetes 클러스터 삭제 (Console에서 수동)
- 서비스 구독 자체 해지 (API 미제공)

---

## 7. 데이터베이스 스키마

### 7.1 ERD
```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    users     │     │   courses    │     │ ncp_accounts │
├──────────────┤     ├──────────────┤     ├──────────────┤
│ id (PK)      │     │ id (PK)      │◄────│ id (PK)      │
│ email        │     │ name         │     │ courseId(FK) │
│ password     │     │ description  │     │ displayName  │
│ name         │     │ startDate    │     │ accessKey*   │
│ role         │     │ endDate      │     │ secretKey*   │
│ isActive     │     │ billingPeriod│     │ isActive     │
│ createdAt    │     │ tags[]       │     │ lastSyncAt   │
│ updatedAt    │     │ status       │     └──────────────┘
└──────────────┘     │ createdAt    │            │
       │             │ updatedAt    │            │
       │             └──────────────┘            │
       │                    │                    │
       ▼                    ▼                    ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  audit_logs  │     │cost_snapshots│     │  resources   │
├──────────────┤     ├──────────────┤     ├──────────────┤
│ id (PK)      │     │ id (PK)      │     │ id (PK)      │
│ userId (FK)  │     │ courseId(FK) │     │ncpAccountId  │
│ action       │     │ periodStart  │     │ resourceType │
│ entityType   │     │ periodEnd    │     │ resourceId   │
│ entityId     │     │ totalCost    │     │ resourceName │
│ oldValue     │     │ currency     │     │ status       │
│ newValue     │     │ breakdown    │     │ spec (JSON)  │
│ ipAddress    │     └──────────────┘     └──────────────┘
│ createdAt    │
└──────────────┘
```

* 암호화된 값 저장

### 7.2 인덱스
- `users`: email (unique)
- `courses`: status, startDate/endDate
- `ncp_accounts`: courseId, accessKeyHash (composite unique)
- `usage_records`: ncpAccountId, usageDate, serviceCode
- `audit_logs`: userId, entityType/entityId, createdAt

---

## 8. 성능 고려사항

### 8.1 API Rate Limiting
- NCP API: 요청 간 100-500ms 딜레이
- 일괄 작업 시 큐 사용 권장

### 8.2 캐싱
- 현재 미구현
- 향후 Redis 도입 고려
  - 세션 캐싱
  - API 응답 캐싱 (1분)

### 8.3 백그라운드 작업
- node-cron 기반 스케줄러
- 일일 비용 스냅샷: 02:00
- 종료 과정 체크: 03:00
- 예약 정리 실행: 매시간
- 리소스 동기화: 6시간 간격

---

## 9. 확장성

### 9.1 수평 확장
- Stateless 백엔드 설계
- 세션을 JWT로 처리하여 서버 무상태 유지
- 로드밸런서 뒤에 여러 인스턴스 배치 가능

### 9.2 데이터베이스 확장
- PostgreSQL Read Replica
- Connection Pooling (Prisma 기본 지원)

### 9.3 향후 개선 방향
- Kubernetes 배포
- 메시지 큐 (Bull/Redis) 도입
- 실시간 알림 (WebSocket)
- 다중 클라우드 지원 (AWS, Azure 등)
