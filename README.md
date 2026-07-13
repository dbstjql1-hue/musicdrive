# musicdrive - 나만의 음악 창작곡 공유 플랫폼

자신이 직접 작사/작곡하고 제작한 소중한 음악들을 다른 사람들이 듣고 즐길 수 있도록 제작된 스트리밍 포트폴리오 웹사이트입니다. YouTube Music, 멜론, 지니의 감성을 벤치마킹하여 프리미엄 다크 테마 및 아크릴릭 글래스모피즘(Acrylic Glassmorphism) 레이아웃으로 구축되었습니다.

---

## 🛠️ 기술 스택 및 구조

- **데이터베이스 & 파일 스토리지**: [Supabase](https://supabase.com) (PostgreSQL + Supabase Storage)
- **프론트엔드 (웹 클라이언트)**: React.js (Vite) + Lucide Icons + Premium CSS (Vercel 배포)
- **백엔드 (API 서버)**: Node.js (Express.js) + Multer + Supabase SDK (Cloudtype 배포)

---

## 📂 프로젝트 구조

```
musicdrive/
├── backend/            # Express.js API 서버 (Cloudtype 배포용)
│   ├── .env.example    # 백엔드 환경 설정 양식
│   ├── index.js        # API 엔드포인트 및 서버 진입점
│   └── package.json
├── frontend/           # React SPA 웹 클라이언트 (Vercel 배포용)
│   ├── src/
│   │   ├── App.jsx     # 메인 클라이언트 애플리케이션 컴포넌트
│   │   ├── index.css   # 디자인 시스템 및 테마 스타일 시트
│   │   └── main.jsx
│   ├── index.html      # SEO 최적화 메타데이터 포함
│   └── package.json
├── schema.sql          # Supabase SQL 스키마 쿼리 파일
└── .gitignore
```

---

## 🚀 시작하기

### 1. Database (Supabase) 설정

1. [Supabase](https://supabase.com)에 로그인하고 프로젝트를 생성합니다.
2. 대시보드의 **SQL Editor**로 이동하여 프로젝트 루트에 있는 `schema.sql` 파일의 내용을 복사해 붙여넣고 **Run**을 눌러 테이블 및 트리거를 생성합니다.
3. **Storage** 메뉴로 이동하여 다음 두 개의 버킷을 생성합니다:
   - `songs` (Public 설정 필수)
   - `covers` (Public 설정 필수)
4. 스토리지 업로드 시 백엔드가 Supabase의 `service_role` 키를 사용하여 정책을 우회하므로 별도의 RLS 스토리지 정책 설정은 필요하지 않습니다.

### 2. Backend 실행 (Express.js)

1. `backend/` 폴더로 이동합니다.
2. `.env.example` 파일을 복사하여 `.env` 파일을 생성하고 아래 값들을 채워넣습니다:
   ```env
   PORT=5000
   SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL
   SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
   ADMIN_PASSWORD=admin1234
   ```
   > ⚠️ **주의**: `SUPABASE_SERVICE_ROLE_KEY`는 Storage에 직접 버퍼 파일을 업로드하기 위해 필수적이며 외부 노출을 금지해야 합니다. `ADMIN_PASSWORD`는 곡 업로드 시 사용하는 관리자용 인증 패스워드입니다.
3. 종속성을 설치하고 서버를 실행합니다:
   ```bash
   npm install
   npm start
   ```

### 3. Frontend 실행 (React + Vite)

1. `frontend/` 폴더로 이동합니다.
2. 로컬 실행 혹은 배포 빌드를 진행하기 전 백엔드 API URL 주소를 바인딩합니다. `.env` 파일을 새로 만들고 아래와 같이 환경 변수를 지정해 줍니다:
   ```env
   VITE_API_URL=http://localhost:5000
   ```
   *배포 시에는 `VITE_API_URL` 환경 변수에 배포된 Cloudtype 백엔드 URL을 적어줍니다.*
3. 종속성 설치 및 로컬 개발 서버를 실행합니다:
   ```bash
   npm install
   npm run dev
   ```

---

## ☁️ 배포 가이드

### 1. Backend (Cloudtype) 배포

1. [Cloudtype](https://cloudtype.io) 서비스에 가입하고 새 프로젝트를 생성합니다.
2. **Node.js** 템플릿을 선택합니다.
3. GitHub 저장소와 브랜치를 연결하고, Sub directory를 `backend`로 설정합니다.
4. **환경 변수**에 아래 값을 입력한 후 배포합니다:
   - `SUPABASE_URL`: Supabase 프로젝트 URL
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase 서비스 롤 키
   - `ADMIN_PASSWORD`: 관리자 업로드용 비밀번호
   - `CORS_ORIGINS`: 프런트 운영 도메인 (기본값: `https://musicdrive.kro.kr`)
5. 배포 완료 후 제공되는 Cloudtype 백엔드 도메인 주소(예: `https://port-0-xxxx.cloudtype.app`)를 복사해둡니다. 브라우저에서 `<백엔드 주소>/api/health`가 JSON으로 응답하는지 확인합니다.

### 2. Frontend (Vercel) 배포

1. [Vercel](https://vercel.com)에 로그인하고 **Add New Project**를 선택합니다.
2. 생성한 GitHub 저장소를 연동합니다.
3. **Root Directory**를 `frontend`로 지정합니다.
4. **Environment Variables**에 다음 값을 입력하고 배포합니다:
   - `VITE_API_URL`: 복사해 둔 Cloudtype 백엔드 도메인 주소 (슬래시 제외)
5. 배포 완료된 Vercel 도메인을 통해 전세계 어디서든 음악을 감상할 수 있습니다.
