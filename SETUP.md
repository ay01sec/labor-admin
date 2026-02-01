# 労務管理システム 管理画面 セットアップ手順

## プロジェクト構造

```
labor-admin/
├── public/
│   └── index.html
├── src/
│   ├── components/          # 共通コンポーネント
│   │   ├── Layout/
│   │   │   ├── Header.jsx
│   │   │   ├── Sidebar.jsx
│   │   │   └── Layout.jsx
│   │   ├── common/
│   │   │   ├── Button.jsx
│   │   │   ├── Card.jsx
│   │   │   ├── Table.jsx
│   │   │   ├── Modal.jsx
│   │   │   ├── Input.jsx
│   │   │   └── Badge.jsx
│   │   └── forms/
│   │       ├── EmployeeForm.jsx
│   │       ├── ClientForm.jsx
│   │       └── SiteForm.jsx
│   ├── pages/               # ページコンポーネント
│   │   ├── Dashboard.jsx
│   │   ├── employees/
│   │   │   ├── EmployeeList.jsx
│   │   │   └── EmployeeDetail.jsx
│   │   ├── clients/
│   │   │   ├── ClientList.jsx
│   │   │   └── ClientDetail.jsx
│   │   ├── sites/
│   │   │   ├── SiteList.jsx
│   │   │   └── SiteDetail.jsx
│   │   ├── reports/
│   │   │   ├── ReportList.jsx
│   │   │   └── ReportDetail.jsx
│   │   ├── contracts/
│   │   │   └── ContractList.jsx
│   │   ├── documents/
│   │   │   └── DocumentList.jsx
│   │   ├── leaves/
│   │   │   └── LeaveList.jsx
│   │   ├── users/
│   │   │   └── UserList.jsx
│   │   ├── settings/
│   │   │   └── CompanySettings.jsx
│   │   └── auth/
│   │       └── Login.jsx
│   ├── hooks/               # カスタムフック
│   │   ├── useAuth.js
│   │   ├── useFirestore.js
│   │   └── useStorage.js
│   ├── contexts/            # Context
│   │   └── AuthContext.jsx
│   ├── services/            # Firebase操作
│   │   ├── firebase.js
│   │   ├── authService.js
│   │   ├── employeeService.js
│   │   ├── clientService.js
│   │   ├── siteService.js
│   │   ├── reportService.js
│   │   └── storageService.js
│   ├── utils/               # ユーティリティ
│   │   ├── formatters.js
│   │   └── validators.js
│   ├── App.jsx
│   ├── index.jsx
│   └── index.css
├── .env                     # 環境変数（Firebase設定）
├── .gitignore
├── package.json
├── tailwind.config.js
└── README.md
```

---

## セットアップ手順

### 1. プロジェクト作成

```bash
# Viteでプロジェクト作成
npm create vite@latest labor-admin -- --template react

# ディレクトリ移動
cd labor-admin

# 依存パッケージインストール
npm install
```

### 2. 必要なパッケージをインストール

```bash
# Tailwind CSS
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

# Firebase
npm install firebase

# ルーティング
npm install react-router-dom

# アイコン
npm install lucide-react

# 日付操作
npm install date-fns

# フォーム
npm install react-hook-form

# 通知
npm install react-hot-toast
```

### 3. Tailwind CSS設定

`tailwind.config.js` を編集：

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

`src/index.css` を編集：

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### 4. 環境変数設定

`.env` ファイルを作成：

```
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

### 5. Firebase設定値の取得方法

1. Firebase Console → プロジェクト設定（歯車アイコン）
2. 「全般」タブ → 「マイアプリ」セクション
3. Webアプリがなければ「アプリを追加」→ Web（</>アイコン）
4. アプリのニックネームを入力（例：labor-admin）
5. 「Firebase Hostingも設定する」はチェックなしでOK
6. 「アプリを登録」をクリック
7. 表示される `firebaseConfig` の値をコピー

### 6. 開発サーバー起動

```bash
npm run dev
```

ブラウザで http://localhost:5173 を開く

---

## Firebase Hosting へのデプロイ

### 1. Firebase CLI インストール

```bash
npm install -g firebase-tools
```

### 2. ログイン

```bash
firebase login
```

### 3. プロジェクト初期化

```bash
firebase init hosting
```

- 「Use an existing project」を選択
- 対象のFirebaseプロジェクトを選択
- public directory: `dist`
- Single-page app: `Yes`
- GitHub自動デプロイ: `No`

### 4. ビルド & デプロイ

```bash
npm run build
firebase deploy --only hosting
```

---

## 次のステップ

1. 各ファイルを順番に作成
2. ローカルで動作確認
3. Firebaseにデプロイ
