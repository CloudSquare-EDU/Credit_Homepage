# NCP 교육용 계정 관리 시스템 배포 가이드

완전 무료로 배포하는 방법입니다. 컴퓨터가 꺼져 있어도 서비스가 24시간 운영됩니다.

## 배포 구성

- **프론트엔드**: Vercel (무료)
- **백엔드**: Render (무료)
- **데이터베이스**: Neon PostgreSQL (무료, 500MB)

---

## 1단계: Neon 데이터베이스 생성

### 1.1 Neon 계정 생성
1. https://neon.tech 접속
2. "Sign Up" 클릭
3. GitHub 계정으로 로그인 (추천) 또는 이메일로 가입

### 1.2 프로젝트 생성
1. "Create a project" 클릭
2. 설정:
   - **Project name**: `ncp-edu-manager` (원하는 이름)
   - **Region**: `AWS / Asia Pacific (ap-southeast-1) Singapore` (한국과 가까움)
   - **Postgres version**: 최신 버전 (기본값)
3. "Create project" 클릭

### 1.3 Connection String 복사
1. 프로젝트 생성 후 대시보드에서 "Connection Details" 섹션 확인
2. **Connection string** 복사 (Prisma 탭 선택)
   ```
   예시: postgresql://username:password@ep-xxx.neon.tech/ncp_edu_manager?sslmode=require
   ```
3. **메모장에 저장해두기** (나중에 사용)

---

## 2단계: Render 백엔드 배포

### 2.1 Render 계정 생성
1. https://render.com 접속
2. "Get Started" 클릭
3. GitHub 계정으로 로그인

### 2.2 Web Service 생성
1. Dashboard에서 "New +" 버튼 클릭
2. "Web Service" 선택
3. GitHub 저장소 연결:
   - "Connect account" 클릭하여 GitHub 인증
   - 저장소 선택: `your-username/Account` (본인의 GitHub 저장소)
4. 설정 입력:

   **Basic 정보:**
   - **Name**: `ncp-edu-backend` (원하는 이름)
   - **Region**: `Singapore (Southeast Asia)` (한국과 가까움)
   - **Branch**: `main`
   - **Root Directory**: `backend`
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npx prisma generate && npm run build`
   - **Start Command**: `npx prisma db push && npm start`

   **Instance Type:**
   - **Free** 선택

5. "Advanced" 클릭하여 환경변수 추가:

   **Environment Variables 추가:**
   
   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | (1단계에서 복사한 Neon Connection String) |
   | `JWT_SECRET` | (랜덤 문자열 32자 이상, 예: `ncp-edu-jwt-secret-key-2026-change-this-random`) |
   | `ENCRYPTION_KEY` | (랜덤 문자열 32자 이상, 예: `MySecureEncKey2026!@#$%^&*()`) |
   | `PORT` | `4000` |
   | `NODE_ENV` | `production` |
   | `FRONTEND_URL` | `https://your-app.vercel.app` (3단계 후 업데이트) |

   > 💡 **랜덤 문자열 생성 방법**: https://generate-secret.vercel.app/32

6. "Create Web Service" 클릭

### 2.3 배포 확인
1. 배포 로그 확인 (5-10분 소요)
2. 에러 없이 완료되면 상단에 URL 표시됨
   - 예: `https://ncp-edu-backend.onrender.com`
3. **이 URL을 메모장에 저장**

---

## 3단계: Vercel 프론트엔드 배포

### 3.1 Vercel 계정 생성
1. https://vercel.com 접속
2. "Sign Up" 클릭
3. GitHub 계정으로 로그인

### 3.2 프로젝트 Import
1. Dashboard에서 "Add New..." → "Project" 클릭
2. GitHub 저장소 Import:
   - "Import Git Repository" 선택
   - 저장소 찾기: `your-username/Account`
   - "Import" 클릭

### 3.3 프로젝트 설정
1. Configure Project 화면:

   **Basic 정보:**
   - **Framework Preset**: `Vite` (자동 감지됨)
   - **Root Directory**: `frontend` (Edit 클릭하여 변경)
   - **Build Command**: `npm run build` (기본값)
   - **Output Directory**: `dist` (기본값)

2. **Environment Variables 추가:**
   
   | Key | Value |
   |-----|-------|
   | `VITE_API_URL` | `https://ncp-edu-backend.onrender.com` (2단계에서 메모한 Render URL) |

3. "Deploy" 클릭

### 3.4 배포 확인
1. 배포 완료 후 (2-3분 소요) "Visit" 클릭
2. 프론트엔드 URL 확인
   - 예: `https://your-app.vercel.app`
3. **이 URL을 메모**

---

## 4단계: CORS 설정 업데이트

프론트엔드 URL이 확정되었으므로 백엔드 환경변수를 업데이트해야 합니다.

### 4.1 Render에서 환경변수 수정
1. Render Dashboard → 생성한 Web Service 클릭
2. 왼쪽 메뉴에서 "Environment" 클릭
3. `FRONTEND_URL` 값을 Vercel URL로 변경
   - 예: `https://your-app.vercel.app`
4. "Save Changes" 클릭
5. 자동으로 재배포됨 (1-2분 소요)

---

## 5단계: 초기 설정 및 테스트

### 5.1 관리자 계정 생성
1. Vercel에서 배포된 프론트엔드 접속
2. 회원가입 페이지에서 첫 계정 생성
   - 첫 번째 가입자는 자동으로 `SUPER_ADMIN` 권한 부여됨

### 5.2 기능 테스트
1. 로그인
2. 과정 생성
3. 계정 추가
4. 동기화 테스트

---

## 중요 사항

### ⚠️ Render Free Tier 주의사항

**15분 비활성 시 Sleep 모드**
- 15분간 요청이 없으면 서버가 sleep 상태로 전환
- 다음 요청 시 ~30초 정도 대기 (cold start)
- 해결책: 무료 Uptime 모니터링 서비스 사용 (선택사항)
  - https://uptimerobot.com (무료)
  - 5분마다 서버에 ping → sleep 방지

### 💾 Neon Free Tier 제한

**500MB 저장공간**
- 계정 100개 정도 + 서브계정 1000개 정도까지 충분
- 용량 확인: Neon Dashboard → Storage 탭

**Compute Hours (191.9시간/월)**
- 사용 안 할 때 자동으로 꺼짐 (비용 절약)
- 일반적인 사용량으로는 제한 걸릴 일 없음

---

## 배포 후 관리

### 코드 업데이트 방법

```bash
# 로컬에서 코드 수정 후
git add .
git commit -m "기능 추가"
git push origin main

# Vercel과 Render가 자동으로 새 버전 배포 (1-5분)
```

### 로그 확인

**Render 로그:**
1. Render Dashboard → Web Service → "Logs" 탭

**Vercel 로그:**
1. Vercel Dashboard → Project → "Deployments" 탭 → 최신 배포 클릭

### 환경변수 변경

**백엔드 (Render):**
1. Dashboard → Service → Environment → 변경 후 Save

**프론트엔드 (Vercel):**
1. Dashboard → Project → Settings → Environment Variables → 변경
2. Deployments 탭에서 "Redeploy" 클릭 필요

---

## 트러블슈팅

### 문제: 프론트엔드에서 API 호출 실패

**원인:** CORS 설정 오류

**해결:**
1. Render의 `FRONTEND_URL` 환경변수 확인
2. Vercel URL과 정확히 일치하는지 확인 (https:// 포함, 뒤에 / 없음)

### 문제: 로그인 후 바로 로그아웃됨

**원인:** `JWT_SECRET` 불일치 또는 너무 짧음

**해결:**
1. Render Environment Variables에서 `JWT_SECRET` 확인
2. 32자 이상인지 확인
3. 변경 후 재배포

### 문제: DB 연결 실패

**원인:** `DATABASE_URL` 오류

**해결:**
1. Neon Dashboard에서 Connection String 다시 복사
2. Render Environment Variables에서 `DATABASE_URL` 업데이트
3. `?sslmode=require` 파라미터 포함 확인

### 문제: Render 빌드 실패

**원인:** Prisma generate 실패 또는 의존성 문제

**해결:**
1. Build Command 확인: `npm install && npx prisma generate && npm run build`
2. 로그에서 에러 메시지 확인
3. GitHub에 package.json이 제대로 push 되었는지 확인

---

## 완료!

이제 완전 무료로 24시간 운영되는 NCP 교육용 계정 관리 시스템이 배포되었습니다.

**배포된 서비스 URL:**
- 프론트엔드: `https://your-app.vercel.app`
- 백엔드 API: `https://ncp-edu-backend.onrender.com`
- 데이터베이스: Neon (자동 연결됨)

궁금한 점이 있으면 각 서비스의 공식 문서를 참고하세요:
- Neon: https://neon.tech/docs
- Render: https://render.com/docs
- Vercel: https://vercel.com/docs
