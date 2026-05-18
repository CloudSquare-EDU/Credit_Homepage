# API 명세서

## 기본 정보

- Base URL: `http://localhost:4000/api`
- 인증: Bearer Token (JWT)
- Content-Type: application/json

---

## 인증 API

### POST /auth/register
회원가입

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "홍길동"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "name": "홍길동",
      "role": "VIEWER"
    },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

### POST /auth/login
로그인

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "name": "홍길동",
      "role": "ADMIN"
    },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

### GET /auth/me
현재 로그인 사용자 정보

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "홍길동",
    "role": "ADMIN",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "lastLoginAt": "2024-01-15T10:30:00.000Z"
  }
}
```

---

## 과정 API

### GET /courses
과정 목록 조회

**Query Parameters:**
- `status` (optional): DRAFT, ACTIVE, COMPLETED, ARCHIVED
- `search` (optional): 검색어
- `page` (optional): 페이지 번호 (기본: 1)
- `limit` (optional): 페이지당 개수 (기본: 20)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "클라우드 기초 교육",
      "description": "NCP 기초 과정",
      "startDate": "2024-01-01T00:00:00.000Z",
      "endDate": "2024-01-31T00:00:00.000Z",
      "billingPeriod": "2024-01",
      "tags": ["교육", "기초"],
      "status": "ACTIVE",
      "_count": {
        "accounts": 30
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 15,
    "totalPages": 1
  }
}
```

### POST /courses
과정 생성 (ADMIN 이상)

**Request:**
```json
{
  "name": "클라우드 기초 교육",
  "description": "NCP 기초 과정",
  "startDate": "2024-01-01",
  "endDate": "2024-01-31",
  "billingPeriod": "2024-01",
  "tags": ["교육", "기초"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "클라우드 기초 교육",
    "status": "DRAFT",
    ...
  }
}
```

### GET /courses/:courseId
과정 상세 조회

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "클라우드 기초 교육",
    "accounts": [
      {
        "id": "account-uuid",
        "displayName": "교육계정401",
        "accessKeyHash": "abc123...",
        "isActive": true,
        "_count": {
          "resources": 5,
          "subAccounts": 2
        }
      }
    ],
    ...
  }
}
```

---

## 계정 API

### POST /accounts/course/:courseId
계정 추가 (ADMIN 이상)

**Request:**
```json
{
  "accessKey": "ncp_iam_BPAMKR...",
  "secretKey": "ncp_iam_BPKMKR...",
  "displayName": "교육계정401"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "displayName": "교육계정401",
    "accessKeyHash": "abc123...",
    "isActive": true
  }
}
```

### POST /accounts/course/:courseId/bulk
계정 일괄 추가 (ADMIN 이상)

**Request:**
```json
{
  "accounts": [
    {
      "accessKey": "ncp_iam_BPAMKR1...",
      "secretKey": "ncp_iam_BPKMKR1..."
    },
    {
      "accessKey": "ncp_iam_BPAMKR2...",
      "secretKey": "ncp_iam_BPKMKR2..."
    }
  ],
  "startNumber": 400
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 2,
    "success": 2,
    "failed": 0,
    "results": [
      { "success": true, "accessKey": "ncp_iam_BP...", "id": "uuid1" },
      { "success": true, "accessKey": "ncp_iam_BP...", "id": "uuid2" }
    ]
  }
}
```

### GET /accounts/:accountId/services
계정 서비스 조회 (NCP API 호출)

**Response:**
```json
{
  "success": true,
  "data": {
    "services": ["Server (VPC)", "VPC (Virtual Private Cloud)"],
    "serviceDetails": [
      {
        "serviceCode": "SVR",
        "serviceName": "Server (VPC)",
        "usageQuantity": 720,
        "usageUnit": "Hour",
        "cost": 50000
      }
    ],
    "count": 2,
    "date": "2024-01-14"
  }
}
```

### POST /accounts/:accountId/sync
계정 리소스 동기화

**Response:**
```json
{
  "success": true,
  "data": {
    "servers": { "count": 2, "items": [...] },
    "vpcs": { "count": 1, "items": [...] },
    "subnets": { "count": 2, "items": [...] },
    "blockStorages": { "count": 3, "items": [...] },
    "subAccounts": { "count": 1, "items": [...] }
  }
}
```

---

## 모니터링 API

### GET /monitoring/dashboard
대시보드 데이터

**Response:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalCourses": 10,
      "activeCourses": 3,
      "totalActiveAccounts": 150,
      "coursesByStatus": {
        "DRAFT": 2,
        "ACTIVE": 3,
        "COMPLETED": 5
      }
    },
    "alerts": {
      "endingSoon": [
        {
          "id": "uuid",
          "name": "클라우드 교육 3기",
          "endDate": "2024-01-20T00:00:00.000Z"
        }
      ]
    },
    "recentActivity": [...]
  }
}
```

### GET /monitoring/courses/:courseId/costs
과정 비용 현황

**Response:**
```json
{
  "success": true,
  "data": {
    "courseId": "uuid",
    "courseName": "클라우드 기초 교육",
    "currentTotalCost": 1500000,
    "currency": "KRW",
    "accounts": [
      {
        "accountId": "uuid",
        "displayName": "교육계정401",
        "services": [
          { "name": "Server (VPC)", "cost": 50000 }
        ],
        "totalCost": 50000
      }
    ],
    "history": [...]
  }
}
```

---

## 정리 API

### GET /cleanup/courses/:courseId/preview
정리 미리보기 (Dry-run)

**Response:**
```json
{
  "success": true,
  "data": {
    "courseId": "uuid",
    "courseName": "클라우드 기초 교육",
    "accountCount": 30,
    "totals": {
      "servers": 15,
      "vpcs": 10,
      "subnets": 20,
      "natGateways": 5,
      "blockStorages": 30,
      "nasVolumes": 2,
      "loadBalancers": 3,
      "subAccounts": 60
    },
    "accounts": [...],
    "warning": "이 작업은 되돌릴 수 없습니다. 실행 전 반드시 확인하세요."
  }
}
```

### POST /cleanup/courses/:courseId/jobs
정리 작업 생성

**Request:**
```json
{
  "isDryRun": true,
  "scheduledAt": "2024-01-31T03:00:00.000Z"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "job-uuid",
    "courseId": "course-uuid",
    "status": "PENDING",
    "isDryRun": true,
    "scheduledAt": "2024-01-31T03:00:00.000Z"
  }
}
```

### POST /cleanup/jobs/:jobId/execute
정리 작업 실행 (SUPER_ADMIN만)

**Request:**
```json
{
  "confirm": "DELETE_ALL_RESOURCES"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "jobId": "job-uuid",
    "isDryRun": false,
    "summary": {
      "totalAccounts": 30,
      "totalActions": 145,
      "successActions": 140,
      "failedActions": 5
    },
    "results": [...]
  }
}
```

---

## 에러 응답

모든 에러는 다음 형식을 따릅니다:

```json
{
  "success": false,
  "error": "에러 메시지"
}
```

### HTTP 상태 코드
- `400` - Bad Request (잘못된 요청)
- `401` - Unauthorized (인증 필요)
- `403` - Forbidden (권한 없음)
- `404` - Not Found (리소스 없음)
- `500` - Internal Server Error (서버 오류)
