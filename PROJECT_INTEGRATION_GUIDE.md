# NCP 교육계정 관리 프로젝트 통합 가이드

> **작성일**: 2026-01-16
> **목적**: 기존 비용 조회 프로젝트와 이 프로젝트를 통합하기 위한 상세 가이드

---

## 📋 목차

1. [프로젝트 개요](#프로젝트-개요)
2. [핵심 기능 요약](#핵심-기능-요약)
3. [가져가야 할 코드](#가져가야-할-코드)
4. [NCP API 사용법](#ncp-api-사용법)
5. [데이터베이스 스키마](#데이터베이스-스키마)
6. [통합 시 주의사항](#통합-시-주의사항)

---

## 🎯 프로젝트 개요

### 기존 프로젝트 (팀원)
- **기능**: 과정별 전체 금액 조회 + 개별 계정의 일별 누적 금액
- **상태**: 이미 배포됨 (서버 운영 중)

### 현재 프로젝트 (본인)
- **기능**: NCP 계정 및 리소스 자동 관리 + 월별 비용 조회
- **특징**:
  - 서브계정 동기화 (5개씩 배치 처리)
  - 리소스 자동 조회 (3개씩 배치 처리)
  - **월별 과거 데이터 조회 가능** (최근 12개월)
  - 전체 동기화 단일 버튼 (백엔드에서 10개씩 처리)

---

## ⭐ 핵심 기능 요약

### 1. 서브계정 자동 동기화
- NCP SubAccount API 호출
- 5개씩 병렬 처리 (Promise.allSettled)
- DB 자동 저장/업데이트

### 2. 리소스 실시간 조회
- VPC, Server, LoadBalancer 등 8가지 리소스
- 3개씩 병렬 처리
- **서브계정은 리소스 카운트에서 제외**

### 3. **월별 비용 조회 (신규 기능 - 핵심)**
- **과거 12개월 비용 조회** 가능
- 드롭다운으로 월 선택
- NCP Billing API: `getProductDemandCostList`
- 제품별 비용 분류 (사용금액/청구금액)

### 4. 전체 동기화 (최적화)
- 백엔드에서 10개 계정씩 일괄 처리
- 프론트엔드 단일 버튼
- 진행상황 + 소요시간 표시

---

## 📦 가져가야 할 코드

### Backend 핵심 파일

#### 1. NCP API 클라이언트

**가장 중요한 파일들**:
```
backend/src/services/ncp/
├── ncpApiClient.ts          # NCP API 기본 클라이언트 (Signature 생성) ⭐
├── billingService.ts        # 비용 조회 API (핵심) ⭐⭐⭐
├── subAccountService.ts     # 서브계정 API ⭐
├── serverService.ts         # 서버 리소스 API
├── vpcService.ts            # VPC 리소스 API
├── loadBalancerService.ts   # Load Balancer API
├── blockStorageService.ts   # Block Storage API
├── natGatewayService.ts     # NAT Gateway API
├── nasVolumeService.ts      # NAS Volume API
└── targetGroupService.ts    # Target Group API
```

**중요도**:
- ⭐⭐⭐ 필수: `ncpApiClient.ts`, `billingService.ts`
- ⭐ 선택: 리소스 API는 필요에 따라

#### 2. Controller (API 엔드포인트)

```
backend/src/controllers/
├── accountController.ts     # 월별 비용 조회 포함 ⭐⭐
└── courseController.ts      # 전체 동기화 포함 ⭐
```

**핵심 함수**:
- `accountController.ts`: `getAccountCosts()` - 월별 비용 조회
- `courseController.ts`: `syncAllAccounts()` - 전체 동기화

#### 3. Utilities

```
backend/src/utils/
└── encryption.ts            # NCP API Key 암호화 (AES-256-GCM) ⭐⭐
```

### Frontend 핵심 파일

#### 1. API 서비스

```
frontend/src/services/
└── api.ts                   # axios 클라이언트 + API 함수들 ⭐
```

**핵심 함수**:
- `accountApi.getCosts(id, month)` - 월별 비용 조회
- `courseApi.syncAll(courseId)` - 전체 동기화

#### 2. 페이지 컴포넌트

```
frontend/src/pages/
├── CourseDetailPage.tsx     # 전체 동기화 UI
└── AccountDetailPage.tsx    # 월별 비용 선택 UI (핵심) ⭐⭐⭐
```

**AccountDetailPage의 핵심 부분**:
- `generateMonthOptions()` - 최근 12개월 옵션 생성
- `handleMonthChange()` - 월 선택 시 비용 조회
- 월 선택 드롭다운 UI

#### 3. 타입 정의

```
frontend/src/types/
└── index.ts                 # TypeScript 타입 정의 ⭐
```

---

## 🔌 NCP API 사용법 상세

### 1. NCP API 인증 (Signature 생성)

**위치**: `backend/src/services/ncp/ncpApiClient.ts`

**핵심 개념**: NCP API는 모든 요청에 HMAC SHA256 서명이 필요합니다.

**Signature 생성 로직**:
```typescript
/**
 * NCP API Signature V2 생성
 *
 * 메시지 형식:
 * {HTTP METHOD} {URI}\n
 * {TIMESTAMP}\n
 * {ACCESS_KEY}
 */
private createSignature(method: string, uri: string, timestamp: string): string {
  const space = ' ';
  const newLine = '\n';

  // 1. 서명할 메시지 생성
  const message = method + space + uri + newLine + timestamp + newLine + this.credentials.accessKey;

  // 2. Secret Key로 HMAC SHA256 해시
  const hmac = crypto.createHmac('sha256', this.credentials.secretKey);

  // 3. Base64 인코딩
  return hmac.update(message).digest('base64');
}

/**
 * 요청 헤더 생성
 */
private getHeaders(method: string, uri: string): Record<string, string> {
  const timestamp = Date.now().toString();
  const signature = this.createSignature(method, uri, timestamp);

  return {
    'x-ncp-apigw-timestamp': timestamp,
    'x-ncp-iam-access-key': this.credentials.accessKey,
    'x-ncp-apigw-signature-v2': signature,
    'Content-Type': 'application/json'
  };
}
```

**사용 예시**:
```typescript
// NCP API 호출 기본 패턴
protected async request<T>(
  baseUrl: string,
  method: 'GET' | 'POST' | 'DELETE',
  uri: string,
  body?: unknown
): Promise<NcpApiResponse<T>> {
  try {
    const headers = this.getHeaders(method, uri);
    const url = baseUrl + uri;

    const response = await axios({
      method,
      url,
      headers,
      data: body
    });

    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}
```

---

### 2. 서브계정 API

**API 문서**: NCP Sub Account API v2
**Base URL**: `https://cw.apigw.ntruss.com`

**위치**: `backend/src/services/ncp/subAccountService.ts`

#### 2.1 서브계정 목록 조회

```typescript
async listSubAccounts(): Promise<NcpApiResponse<SubAccountListResponse>> {
  const uri = '/cw_fea/sa/api/v2/users';
  return this.request<SubAccountListResponse>(
    'https://cw.apigw.ntruss.com',
    'GET',
    uri
  );
}
```

**응답 예시**:
```json
{
  "getUserListResponse": {
    "requestId": "req-123456",
    "returnCode": "0",
    "returnMessage": "success",
    "totalRows": 3,
    "userList": [
      {
        "userId": "sub-12345",
        "loginId": "student01",
        "userName": "홍길동",
        "email": "student01@example.com",
        "userStatus": {
          "code": "USE",
          "codeName": "사용중"
        }
      }
    ]
  }
}
```

#### 2.2 서브계정 삭제

```typescript
async deleteSubAccount(subAccountId: string): Promise<NcpApiResponse<unknown>> {
  const uri = `/cw_fea/sa/api/v2/users/${subAccountId}`;
  return this.request<unknown>(
    'https://cw.apigw.ntruss.com',
    'DELETE',
    uri
  );
}
```

**주의사항**:
- 삭제된 서브계정은 복구 불가
- SUPER_ADMIN 권한 필요

---

### 3. **비용 조회 API (핵심)**

**API 문서**: NCP Billing API - getProductDemandCostList
**Base URL**: `https://billingapi.apigw.ntruss.com`

**위치**: `backend/src/services/ncp/billingService.ts`

#### 3.1 제품별 청구 비용 조회 (원본 API)

```typescript
/**
 * 제품별 청구 비용 조회
 *
 * @param startMonth - 시작 월 (YYYYMM 형식, 예: "202501")
 * @param endMonth - 종료 월 (YYYYMM 형식, 예: "202501")
 * @returns 제품별 비용 목록
 */
async getProductDemandCost(
  startMonth: string,
  endMonth: string
): Promise<NcpApiResponse<ProductDemandCostResponse>> {
  const uri = `/billing/v1/cost/getProductDemandCostList?startMonth=${startMonth}&endMonth=${endMonth}&responseFormatType=json`;

  return this.request<ProductDemandCostResponse>(
    'https://billingapi.apigw.ntruss.com',
    'GET',
    uri
  );
}
```

**API 응답 구조**:
```json
{
  "getProductDemandCostListResponse": {
    "requestId": "req-billing-123",
    "returnCode": "0",
    "returnMessage": "success",
    "totalRows": 5,
    "productDemandCostList": [
      {
        "productDemandType": {
          "code": "VSVR",
          "codeName": "Server"
        },
        "demandAmount": 50000,
        "useAmount": 48000,
        "promiseDiscountAmount": 2000,
        "promotionDiscountAmount": 0
      },
      {
        "productDemandType": {
          "code": "LSTOR",
          "codeName": "Block Storage"
        },
        "demandAmount": 10000,
        "useAmount": 10000
      }
    ]
  }
}
```

**필드 설명**:
- `productDemandType.code`: 제품 코드 (VSVR, LSTOR 등)
- `productDemandType.codeName`: 제품명 (Server, Block Storage 등)
- `demandAmount`: 청구 금액 (할인 후)
- `useAmount`: 사용 금액 (할인 전)
- `promiseDiscountAmount`: 약정 할인 금액
- `promotionDiscountAmount`: 프로모션 할인 금액

#### 3.2 **월별 비용 조회 (신규 구현 - 핵심)**

```typescript
/**
 * 특정 월 비용 조회 (신규 추가 함수)
 *
 * @param yearMonth - YYYYMM 형식 (예: "202501")
 * @returns 제품별로 집계된 비용 정보
 */
async getMonthlyCostByMonth(yearMonth: string): Promise<MonthlyCostResult> {
  // 1. 입력 검증
  if (!/^\d{6}$/.test(yearMonth)) {
    return {
      success: false,
      costs: [],
      totalDemandAmount: 0,
      totalUseAmount: 0,
      month: yearMonth,
      error: 'Invalid month format. Use YYYYMM (e.g., 202501)'
    };
  }

  // 2. NCP API 호출 (startMonth와 endMonth를 동일하게)
  const response = await this.getProductDemandCost(yearMonth, yearMonth);

  if (!response.success || !response.data) {
    return {
      success: false,
      costs: [],
      totalDemandAmount: 0,
      totalUseAmount: 0,
      month: yearMonth,
      error: response.error
    };
  }

  const costList = response.data.getProductDemandCostListResponse?.productDemandCostList || [];

  // 3. 제품별로 비용 집계 (같은 제품 코드 합산)
  const costMap = new Map<string, {
    productCode: string;
    productName: string;
    demandAmount: number;
    useAmount: number;
  }>();

  for (const item of costList) {
    const productCode = item.productCode || item.productDemandType?.code || 'unknown';
    const productName = item.productName || item.productDemandType?.codeName || '알 수 없음';
    const key = productCode;

    const existing = costMap.get(key);
    if (existing) {
      existing.demandAmount += item.demandAmount || 0;
      existing.useAmount += item.useAmount || 0;
    } else {
      costMap.set(key, {
        productCode,
        productName,
        demandAmount: item.demandAmount || 0,
        useAmount: item.useAmount || 0
      });
    }
  }

  // 4. Map을 배열로 변환
  const costs = Array.from(costMap.values());

  // 5. 총합 계산
  const totalDemandAmount = costs.reduce((sum, c) => sum + c.demandAmount, 0);
  const totalUseAmount = costs.reduce((sum, c) => sum + c.useAmount, 0);

  return {
    success: true,
    costs,
    totalDemandAmount,
    totalUseAmount,
    month: yearMonth
  };
}
```

**이번 달 비용 조회 (편의 함수)**:
```typescript
async getCurrentMonthCost(): Promise<MonthlyCostResult> {
  const now = new Date();
  const yearMonth = now.toISOString().slice(0, 7).replace('-', ''); // "202501"
  return this.getMonthlyCostByMonth(yearMonth);
}
```

#### 3.3 Controller에서 사용

**위치**: `backend/src/controllers/accountController.ts`

```typescript
export const getAccountCosts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { accountId } = req.params;
    const { month } = req.query; // 선택적 파라미터

    // 1. 계정 조회
    const account = await prisma.ncpAccount.findUnique({
      where: { id: accountId }
    });

    if (!account) {
      res.status(404).json({
        success: false,
        message: 'Account not found'
      });
      return;
    }

    // 2. API Key 복호화
    const credentials = {
      accessKey: decrypt(account.accessKey),
      secretKey: decrypt(account.secretKey)
    };

    // 3. NCP Client 생성
    const ncpClient = {
      billing: new NcpBillingService(credentials)
    };

    // 4. 비용 조회 (month 파라미터에 따라)
    let result;
    if (month && typeof month === 'string' && /^\d{6}$/.test(month)) {
      // 특정 월 조회
      result = await ncpClient.billing.getMonthlyCostByMonth(month);
    } else {
      // 이번 달 조회
      result = await ncpClient.billing.getCurrentMonthCost();
    }

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};
```

**API 엔드포인트**:
```
GET /api/accounts/:accountId/costs              # 이번 달
GET /api/accounts/:accountId/costs?month=202501 # 2025년 1월
GET /api/accounts/:accountId/costs?month=202412 # 2024년 12월
```

#### 3.4 프론트엔드에서 사용

**API 함수 (frontend/src/services/api.ts)**:
```typescript
export const accountApi = {
  // 월별 비용 조회 (month 선택적)
  getCosts: async (id: string, month?: string) => {
    const params = month ? { month } : {};
    const { data } = await api.get<ApiResponse<MonthlyCostResult>>(
      `/accounts/${id}/costs`,
      { params }
    );
    return data;
  }
};
```

**UI 컴포넌트 (frontend/src/pages/AccountDetailPage.tsx)**:

```typescript
// 1. 최근 12개월 옵션 생성
const generateMonthOptions = () => {
  const options: { value: string; label: string }[] = [];
  const now = new Date();

  for (let i = 0; i < 12; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const value = `${year}${month}`;        // "202501"
    const label = `${year}년 ${month}월`;    // "2025년 01월"
    options.push({ value, label });
  }

  return options;
};

const monthOptions = generateMonthOptions();

// 2. State 정의
const [selectedMonth, setSelectedMonth] = useState<string>(monthOptions[0].value);
const [monthlyCost, setMonthlyCost] = useState<MonthlyCostResult | null>(null);
const [isFetchingCost, setIsFetchingCost] = useState(false);

// 3. 월 변경 핸들러
const handleMonthChange = async (month: string) => {
  setSelectedMonth(month);
  setIsFetchingCost(true);

  try {
    const response = await accountApi.getCosts(accountId, month);
    if (response.success && response.data) {
      setMonthlyCost(response.data);
      setTotalCost(response.data.totalDemandAmount || 0);
      setTotalUseAmount(response.data.totalUseAmount || 0);
    }
  } catch (error) {
    console.error('Failed to fetch cost:', error);
    toast.error('비용 조회에 실패했습니다');
  } finally {
    setIsFetchingCost(false);
  }
};
```

**JSX (드롭다운 UI)**:
```tsx
<div className="flex items-center gap-2">
  <CalendarDaysIcon className="h-5 w-5 text-gray-400" />
  <select
    value={selectedMonth}
    onChange={(e) => handleMonthChange(e.target.value)}
    disabled={isFetchingCost || isSyncing}
    className="rounded-md border-gray-300 shadow-sm focus:border-ncp-primary focus:ring-ncp-primary text-sm"
  >
    {monthOptions.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))}
  </select>
  {isFetchingCost && (
    <svg className="animate-spin h-4 w-4 text-ncp-primary" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  )}
</div>
```

---

### 4. 리소스 조회 API

**Base URL**: `https://ncloud.apigw.ntruss.com`

#### 4.1 Server (VM) 조회

```typescript
// backend/src/services/ncp/serverService.ts
async listServers(): Promise<NcpApiResponse<ServerListResponse>> {
  const uri = '/vserver/v2/getServerInstanceList?responseFormatType=json';
  return this.request<ServerListResponse>(
    'https://ncloud.apigw.ntruss.com',
    'GET',
    uri
  );
}
```

**응답 예시**:
```json
{
  "getServerInstanceListResponse": {
    "totalRows": 2,
    "serverInstanceList": [
      {
        "serverInstanceNo": "1234567",
        "serverName": "web-server-01",
        "serverInstanceStatus": { "code": "RUN" }
      }
    ]
  }
}
```

#### 4.2 VPC 조회

```typescript
// backend/src/services/ncp/vpcService.ts
async listVpcs(): Promise<NcpApiResponse<VpcListResponse>> {
  const uri = '/vpc/v2/getVpcList?responseFormatType=json';
  return this.request<VpcListResponse>(
    'https://ncloud.apigw.ntruss.com',
    'GET',
    uri
  );
}
```

#### 4.3 Load Balancer 조회

```typescript
// backend/src/services/ncp/loadBalancerService.ts
async listLoadBalancers(): Promise<NcpApiResponse<LoadBalancerListResponse>> {
  const uri = '/vloadbalancer/v2/getLoadBalancerInstanceList?responseFormatType=json';
  return this.request<LoadBalancerListResponse>(
    'https://ncloud.apigw.ntruss.com',
    'GET',
    uri
  );
}
```

---

## 🗄️ 데이터베이스 스키마

**위치**: `backend/prisma/schema.prisma`

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// 사용자 (관리자)
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String   // bcrypt 해시
  name      String
  role      Role     @default(VIEWER)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

enum Role {
  SUPER_ADMIN  // 모든 권한
  ADMIN        // 과정/계정 관리
  VIEWER       // 읽기 전용
}

// 교육 과정
model Course {
  id            String       @id @default(uuid())
  name          String       // 과정명
  description   String?
  startDate     DateTime     // 시작일
  endDate       DateTime     // 종료일
  billingPeriod String       // YYYY-MM
  tags          String[]     // 태그 배열
  status        CourseStatus @default(DRAFT)
  accounts      NcpAccount[]
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt
}

enum CourseStatus {
  DRAFT       // 준비 중
  ACTIVE      // 진행 중
  COMPLETED   // 완료
  ARCHIVED    // 보관
}

// NCP 계정
model NcpAccount {
  id               String       @id @default(uuid())
  courseId         String
  course           Course       @relation(fields: [courseId], references: [id], onDelete: Cascade)

  displayName      String       // 표시 이름
  accessKey        String       // 암호화 저장
  secretKey        String       // 암호화 저장
  accessKeyPreview String       // 마지막 4자리만

  isActive         Boolean      @default(true)
  lastSyncAt       DateTime?    // 마지막 동기화 시간

  subAccounts      SubAccount[]

  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt
}

// 서브계정
model SubAccount {
  id             String     @id @default(uuid())
  accountId      String
  account        NcpAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  subAccountId   String     // NCP의 userId
  loginId        String     // 로그인 ID
  name           String?    // 이름
  email          String?    // 이메일

  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  @@unique([accountId, subAccountId])
}
```

**주요 관계**:
- User: 독립적 (관리자 계정)
- Course → NcpAccount: 1:N (한 과정에 여러 계정)
- NcpAccount → SubAccount: 1:N (한 계정에 여러 서브계정)

---

## 🔑 API Key 암호화

**위치**: `backend/src/utils/encryption.ts`

**알고리즘**: AES-256-GCM (Galois/Counter Mode)

```typescript
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Access Key/Secret Key 암호화
 *
 * @param text - 암호화할 텍스트
 * @returns IV:암호문:AuthTag 형식의 문자열
 */
export function encrypt(text: string): string {
  // 1. ENCRYPTION_KEY로부터 32바이트 키 생성
  const key = crypto.scryptSync(
    process.env.ENCRYPTION_KEY || '',
    'salt',
    KEY_LENGTH
  );

  // 2. 랜덤 IV 생성
  const iv = crypto.randomBytes(IV_LENGTH);

  // 3. Cipher 생성
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // 4. 암호화
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // 5. AuthTag 획득 (GCM 모드의 무결성 검증 태그)
  const tag = cipher.getAuthTag();

  // 6. IV:암호문:Tag 형식으로 반환
  return iv.toString('hex') + ':' + encrypted + ':' + tag.toString('hex');
}

/**
 * Access Key/Secret Key 복호화
 *
 * @param encrypted - IV:암호문:AuthTag 형식의 문자열
 * @returns 복호화된 텍스트
 */
export function decrypt(encrypted: string): string {
  // 1. IV, 암호문, Tag 분리
  const parts = encrypted.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedText = parts[1];
  const tag = Buffer.from(parts[2], 'hex');

  // 2. 키 생성 (암호화와 동일)
  const key = crypto.scryptSync(
    process.env.ENCRYPTION_KEY || '',
    'salt',
    KEY_LENGTH
  );

  // 3. Decipher 생성
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  // 4. 복호화
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
```

**사용 예시**:

```typescript
import { encrypt, decrypt } from '../utils/encryption';

// 저장 시
const account = await prisma.ncpAccount.create({
  data: {
    displayName: '과정A 메인 계정',
    accessKey: encrypt('YOUR_ACCESS_KEY'),
    secretKey: encrypt('YOUR_SECRET_KEY'),
    accessKeyPreview: 'YOUR_ACCESS_KEY'.slice(-4)
  }
});

// 조회 시
const account = await prisma.ncpAccount.findUnique({ where: { id } });
const credentials = {
  accessKey: decrypt(account.accessKey),
  secretKey: decrypt(account.secretKey)
};
```

**환경변수 설정 필수**:
```env
# 32자 이상의 랜덤 문자열
ENCRYPTION_KEY="your-encryption-key-32-chars-minimum"
```

---

## ⚡ 최적화: 전체 동기화

**위치**: `backend/src/controllers/courseController.ts`

### 개요
- **문제**: 프론트엔드에서 5개씩 서브계정, 3개씩 리소스 동기화 → 느림
- **해결**: 백엔드에서 10개 계정을 한 번에 처리 → 빠름

### 구현

```typescript
/**
 * 과정의 모든 계정 일괄 동기화
 */
export const syncAllAccounts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { courseId } = req.params;
    const BATCH_SIZE = 10; // 10개씩 처리

    const startTime = Date.now();

    // 1. 활성 계정 목록 조회
    const accounts = await prisma.ncpAccount.findMany({
      where: {
        courseId,
        isActive: true
      }
    });

    if (accounts.length === 0) {
      res.json({
        success: true,
        data: {
          total: 0,
          results: [],
          summary: { success: 0, failed: 0 }
        }
      });
      return;
    }

    const results: Array<{
      accountId: string;
      displayName: string;
      success: boolean;
      error?: string;
      resources?: Record<string, number>;
    }> = [];

    // 2. 10개씩 배치 처리
    for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
      const batch = accounts.slice(i, i + BATCH_SIZE);

      // 배치 내에서 병렬 처리
      const batchResults = await Promise.allSettled(
        batch.map(async (account) => {
          try {
            // 서브계정 동기화
            const credentials = {
              accessKey: decrypt(account.accessKey),
              secretKey: decrypt(account.secretKey)
            };

            const subAccountService = new NcpSubAccountService(credentials);
            const subAccountsResponse = await subAccountService.listSubAccounts();

            if (subAccountsResponse.success) {
              const subAccounts = subAccountsResponse.data?.getUserListResponse?.userList || [];

              // DB 업데이트
              for (const sub of subAccounts) {
                await prisma.subAccount.upsert({
                  where: {
                    accountId_subAccountId: {
                      accountId: account.id,
                      subAccountId: sub.userId
                    }
                  },
                  create: {
                    accountId: account.id,
                    subAccountId: sub.userId,
                    loginId: sub.loginId,
                    name: sub.userName,
                    email: sub.email
                  },
                  update: {
                    loginId: sub.loginId,
                    name: sub.userName,
                    email: sub.email
                  }
                });
              }
            }

            // 리소스 동기화
            const resourceCounts = await syncAccountResources(account, credentials);

            // lastSyncAt 업데이트
            await prisma.ncpAccount.update({
              where: { id: account.id },
              data: { lastSyncAt: new Date() }
            });

            return {
              accountId: account.id,
              displayName: account.displayName,
              success: true,
              resources: resourceCounts
            };
          } catch (error) {
            return {
              accountId: account.id,
              displayName: account.displayName,
              success: false,
              error: error.message
            };
          }
        })
      );

      // 결과 수집
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            accountId: '',
            displayName: 'Unknown',
            success: false,
            error: result.reason?.message || 'Unknown error'
          });
        }
      }
    }

    // 3. 요약 정보
    const summary = {
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    };

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);

    res.json({
      success: true,
      data: {
        total: accounts.length,
        results,
        summary,
        elapsedTime: `${elapsedTime}초`
      }
    });
  } catch (error) {
    next(error);
  }
};
```

**프론트엔드 호출**:

```typescript
// frontend/src/pages/CourseDetailPage.tsx
const handleSyncEverything = async () => {
  setIsSyncingAll(true);
  const startTime = Date.now();

  try {
    const response = await courseApi.syncAll(courseId);

    if (response.success && response.data) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      // 성공 알림
      toast.success(
        `전체 동기화 완료! (${elapsed}초)\n` +
        `성공: ${response.data.summary.success}개, ` +
        `실패: ${response.data.summary.failed}개`,
        { duration: 5000 }
      );

      // 화면 갱신
      await fetchCourseDetails();
    }
  } catch (error) {
    toast.error('동기화 중 오류가 발생했습니다');
  } finally {
    setIsSyncingAll(false);
  }
};
```

**UI 버튼**:
```tsx
<button
  onClick={handleSyncEverything}
  disabled={isSyncingAll}
  className="btn-primary"
>
  {isSyncingAll ? (
    <>
      <svg className="animate-spin h-5 w-5 mr-2" />
      동기화 중...
    </>
  ) : (
    '전체 동기화'
  )}
</button>
```

---

## 🚨 통합 시 주의사항

### 1. 환경변수 설정

**필수 환경변수** (`.env`):
```env
# Database
DATABASE_URL="postgresql://user:password@host:5432/dbname?schema=public"

# JWT (32자 이상)
JWT_SECRET="your-super-secret-jwt-key-32-chars-minimum"
JWT_EXPIRES_IN="24h"

# Encryption (32자 이상) - 매우 중요!
ENCRYPTION_KEY="your-encryption-key-32-chars-minimum"

# Server
PORT=4000
NODE_ENV=production

# CORS
FRONTEND_URL="https://your-frontend-url.com"
```

**중요**: `ENCRYPTION_KEY`는 절대 변경하면 안 됩니다. 변경 시 기존에 저장된 모든 API Key가 복호화 불가능해집니다.

---

### 2. NCP API 제한사항 및 주의점

#### 2.1 비용 조회 API

**데이터 반영 시간**:
- NCP Billing API는 **매일 오전 7시**에 전날 데이터를 반영합니다
- 예: 1월 15일 오전 7시에 1월 14일 데이터가 반영됨
- 실시간 데이터가 아님에 유의

**조회 가능 범위**:
- 최근 12개월까지만 조회 가능
- 13개월 이전 데이터는 API에서 제공하지 않음

**파라미터 주의**:
- `startMonth`와 `endMonth`를 동일하게 설정하면 해당 월만 조회
- 범위 조회 가능 (예: `202401` ~ `202412`)

**응답 구조 변경**:
- `productCode`와 `productDemandType.code`가 혼재
- `productName`과 `productDemandType.codeName`이 혼재
- 둘 다 확인하는 로직 필요:
```typescript
const productCode = item.productCode || item.productDemandType?.code || 'unknown';
const productName = item.productName || item.productDemandType?.codeName || '알 수 없음';
```

#### 2.2 서브계정 API

**동시 요청 제한**:
- 너무 많은 요청을 동시에 보내면 `429 Too Many Requests` 에러
- 배치 처리로 해결 (5개씩 권장)

**삭제 제한**:
- 삭제된 서브계정은 복구 불가
- SUPER_ADMIN 권한 필요
- 삭제 전 확인 UI 권장

#### 2.3 리소스 API

**응답 시간**:
- VPC, Server 조회 시 각각 1-3초 소요
- 병렬 처리 권장 (3개씩)

**권한 확인**:
- API Key에 해당 리소스 조회 권한이 있어야 함
- 권한 없으면 빈 배열 반환 (에러 X)

---

### 3. 데이터베이스 마이그레이션

**Prisma 마이그레이션 절차**:

```bash
# 1. 개발 환경에서 스키마 변경
cd backend
npx prisma migrate dev --name add_new_feature

# 2. 생성된 마이그레이션 파일 확인
ls prisma/migrations/

# 3. 프로덕션 적용 (주의: 데이터 백업 후)
npx prisma migrate deploy

# 4. Prisma Client 재생성
npx prisma generate
```

**주의사항**:
- 프로덕션 배포 전 반드시 로컬에서 테스트
- 데이터 백업 필수
- 롤백 계획 수립

---

### 4. API 엔드포인트 충돌 방지

**현재 프로젝트 엔드포인트**:

```
# 인증
POST   /api/auth/login
POST   /api/auth/register
GET    /api/auth/me
PUT    /api/auth/password

# 과정
GET    /api/courses
POST   /api/courses
GET    /api/courses/:id
PUT    /api/courses/:id
DELETE /api/courses/:id
POST   /api/courses/:id/sync-all          # 전체 동기화 (신규)

# 계정
GET    /api/accounts/course/:courseId
POST   /api/accounts/course/:courseId
GET    /api/accounts/:id
GET    /api/accounts/:id/costs?month=YYYYMM  # 월별 비용 (신규)
GET    /api/accounts/:id/subaccounts
POST   /api/accounts/:id/sync-resources
DELETE /api/accounts/:accountId/subaccounts/:subAccountId
```

**충돌 확인**:
- 팀원 프로젝트의 엔드포인트와 비교
- 겹치는 URL이 있으면 prefix 추가 권장:
  - `/api/v1/...`
  - `/api/management/...`

---

### 5. 보안 체크리스트

#### API Key 보안

- [ ] `ENCRYPTION_KEY` 환경변수 설정 (32자 이상)
- [ ] `.gitignore`에 `.env` 파일 추가
- [ ] API Key는 절대 로그에 출력하지 않음
- [ ] 복호화된 Key는 메모리에서만 사용, DB/파일에 저장 금지

#### JWT 보안

- [ ] `JWT_SECRET` 강력한 랜덤 문자열 (32자 이상)
- [ ] 프로덕션에서는 HTTPS만 사용
- [ ] Token 만료 시간 적절히 설정 (24h 권장)

#### CORS 설정

- [ ] `FRONTEND_URL` 정확히 설정
- [ ] 프로덕션에서는 와일드카드(`*`) 사용 금지
- [ ] Preflight 요청 처리 확인

---

### 6. 성능 최적화

**배치 크기 조정**:

```typescript
// 네트워크 속도에 따라 조정
const BATCH_SIZE = 10; // 서버 성능 좋으면 증가
const SUB_ACCOUNT_BATCH = 5; // API 제한 고려
const RESOURCE_BATCH = 3; // 응답 시간 고려
```

**캐싱 전략**:
```typescript
// 리소스 조회 결과는 localStorage에 캐싱
localStorage.setItem(`account_${accountId}_resources`, JSON.stringify(data));

// 10분 이내에는 캐시 사용
const cached = localStorage.getItem(`account_${accountId}_resources`);
if (cached && Date.now() - cached.timestamp < 600000) {
  return JSON.parse(cached.data);
}
```

**병렬 처리**:
```typescript
// 좋은 예: Promise.allSettled로 병렬 처리
const [costs, subAccounts, resources] = await Promise.allSettled([
  fetchCosts(),
  fetchSubAccounts(),
  fetchResources()
]);

// 나쁜 예: 순차 처리
const costs = await fetchCosts();
const subAccounts = await fetchSubAccounts();
const resources = await fetchResources();
```

---

## 📊 통합 시나리오

### 시나리오 1: 월별 비용 조회 기능만 추가

**최소한으로 가져갈 파일**:

```
backend/
├── src/services/ncp/
│   ├── ncpApiClient.ts        # 기본 클라이언트
│   └── billingService.ts      # 비용 조회
├── src/utils/
│   └── encryption.ts          # 암호화
└── src/controllers/
    └── accountController.ts (getAccountCosts 함수만)

frontend/
├── src/services/
│   └── api.ts (accountApi.getCosts 함수만)
└── src/pages/
    └── AccountDetailPage.tsx (월 선택 UI 부분만)
```

**통합 절차**:

1. **백엔드 통합**:
```typescript
// 1. ncpApiClient.ts와 billingService.ts 복사
// 2. 팀원 프로젝트 controller에 추가:

import { NcpBillingService } from '../services/ncp/billingService';
import { decrypt } from '../utils/encryption';

app.get('/api/accounts/:id/costs', async (req, res) => {
  const { id } = req.params;
  const { month } = req.query;

  // 기존 계정 조회 로직
  const account = await getAccountById(id);

  // NCP Client 생성
  const billingService = new NcpBillingService({
    accessKey: decrypt(account.accessKey),
    secretKey: decrypt(account.secretKey)
  });

  // 비용 조회
  const result = month
    ? await billingService.getMonthlyCostByMonth(month)
    : await billingService.getCurrentMonthCost();

  res.json(result);
});
```

2. **프론트엔드 통합**:
```typescript
// 1. 월 옵션 생성 함수 복사
const generateMonthOptions = () => {
  // ... (위 코드 참조)
};

// 2. API 호출 함수 추가
const fetchMonthlyCost = async (accountId: string, month: string) => {
  const response = await fetch(`/api/accounts/${accountId}/costs?month=${month}`);
  return response.json();
};

// 3. UI 컴포넌트 추가
<select onChange={(e) => fetchMonthlyCost(accountId, e.target.value)}>
  {monthOptions.map(opt => (
    <option value={opt.value}>{opt.label}</option>
  ))}
</select>
```

**예상 소요 시간**: 2-3시간

---

### 시나리오 2: 전체 기능 통합

**모든 파일 가져가기**:

```
backend/
├── src/
│   ├── services/ncp/          # 전체
│   ├── controllers/           # 전체
│   ├── routes/                # 전체
│   ├── middlewares/           # 전체
│   └── utils/                 # 전체
└── prisma/
    └── schema.prisma          # 병합 필요

frontend/
└── src/                       # 전체
```

**통합 절차**:

1. **데이터베이스 스키마 병합**
2. **API 엔드포인트 정리** (충돌 해결)
3. **프론트엔드 라우팅 통합**
4. **환경변수 설정**
5. **통합 테스트**

**예상 소요 시간**: 1-2일

---

## 🔗 참고 자료

### NCP API 문서
- [NCP API 메인](https://api.ncloud-docs.com/)
- [Sub Account API](https://api.ncloud-docs.com/docs/common-ncpapi)
- [Billing API](https://api.ncloud-docs.com/docs/common-billingapi)
- [Server API](https://api.ncloud-docs.com/docs/compute-vserver)
- [VPC API](https://api.ncloud-docs.com/docs/networking-vpc)

### 기술 스택 문서
- [Prisma](https://www.prisma.io/docs)
- [Express.js](https://expressjs.com/)
- [React](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/docs/)

---

## 📞 추가 지원

### 프로젝트 위치
```
c:\Users\kzm05\OneDrive\바탕 화면\PROJECT\Account
```

### 실행 방법

**백엔드**:
```bash
cd backend
npm install
npx prisma generate
npm run dev
```

**프론트엔드**:
```bash
cd frontend
npm install
npm run dev
```

### 주요 파일 위치

**월별 비용 조회 (핵심)**:
- Backend: `backend/src/services/ncp/billingService.ts`
- Controller: `backend/src/controllers/accountController.ts`
- Frontend: `frontend/src/pages/AccountDetailPage.tsx`

**전체 동기화**:
- Controller: `backend/src/controllers/courseController.ts`
- Frontend: `frontend/src/pages/CourseDetailPage.tsx`

---

**작성자**: 본인
**최종 수정일**: 2026-01-16
**버전**: 1.0

**통합 작업 화이팅! 🚀**
