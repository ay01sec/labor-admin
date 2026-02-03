# 労務管理システム（管理画面）

建設業向け労務管理システムの管理画面アプリケーションです。社員・取引先・現場の管理、日報の承認、勤怠集計、自社情報設定などを行えます。

## 技術スタック

| 項目 | 技術 |
|------|------|
| フレームワーク | React 18.2 + React Router 6 |
| ビルドツール | Vite 5.1 |
| CSS | Tailwind CSS 3.4 |
| データベース | Cloud Firestore |
| 認証 | Firebase Authentication |
| ストレージ | Firebase Storage |
| ホスティング | Firebase Hosting |
| フォーム | React Hook Form |
| 通知 | React Hot Toast |
| アイコン | lucide-react |

## セットアップ

```bash
# 依存関係のインストール
npm install

# 開発サーバー起動
npm run dev

# ビルド
npm run build

# デプロイ
npm run build && npx firebase deploy --only hosting
```

## 環境変数

`.env` ファイルに Firebase の設定情報を記載してください。

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

---

## ユーザーロールと権限

| ロール | 説明 | アクセス範囲 |
|--------|------|-------------|
| admin（管理者） | 全機能にアクセス可能 | 全ページ・全操作 |
| manager（マネージャー） | 日報承認・閲覧が可能 | ダッシュボード・日報・マスタ閲覧 |
| worker（ワーカー） | 管理画面へのログイン不可 | 日報アプリのみ利用可能 |

---

## ログイン

1. **企業コード**（8桁の数字）を入力
2. **メールアドレス**と**パスワード**を入力してログイン
3. admin または manager ロールのユーザーのみログイン可能
4. パスワードを忘れた場合は「パスワードを忘れた方」リンクからリセットメールを送信

---

## 機能一覧

### ダッシュボード（`/`）

管理画面のトップページです。

- **サマリーカード**: 社員数・取引先数・稼働中現場数・未承認日報数を表示
- **今日の日報状況**: 稼働中現場に対する日報提出率をプログレスバーで表示
- **お知らせ**: 承認待ち日報数などの通知を表示
- **最近の日報**: 直近5件の日報を一覧表示（クリックで詳細へ遷移）

---

### マスタ管理

#### 社員管理（`/employees`）

社員情報の登録・編集・削除を行います。

**一覧画面の機能:**
- 氏名・フリガナでの検索
- 雇用形態フィルター（正社員/契約社員/パート/アルバイト）
- 状態フィルター（在籍/退職）
- ページネーション（10件/ページ）
- CSVインポート/エクスポート

**詳細画面のタブ構成:**

| タブ | 内容 | 権限 |
|------|------|------|
| 基本情報 | 氏名・生年月日・性別・血液型・在籍状態 | 全ユーザー |
| 住所・連絡先 | 住所・電話番号・メールアドレス | 管理者のみ |
| 雇用情報 | 雇用形態・入社日・退職日・経験年数・役職・職長フラグ | 全ユーザー |
| 給与 | 基本給・住宅手当・職長手当・通勤手当・その他手当 | 管理者のみ |
| 保険 | 社会保険番号・年金番号・雇用保険番号 | 管理者のみ |
| 資格・免許 | 複数の資格・免許を追加/削除 | 全ユーザー |
| 家族 | 家族情報（開発中） | 管理者のみ |

#### 取引先管理（`/clients`）

取引先情報の登録・編集・削除を行います。

- 取引先名・担当者名での検索
- 登録項目: 取引先名・担当者名・住所・電話番号・FAX・メールアドレス
- CSVインポート/エクスポート
- 電話番号・メールアドレスはクリックで発信/メール作成

#### 現場管理（`/sites`）

現場情報の登録・編集・削除を行います。

**一覧画面の機能:**
- 現場名・住所での検索
- 取引先フィルター
- ステータスフィルター（進行中/完了/予定）
- ページネーション（10件/ページ）
- CSVインポート/エクスポート

**詳細画面の登録項目:**
- 基本情報: 現場名・取引先（ドロップダウン）・ステータス・住所
- 工期: 開始日・終了日
- 承認設定: 承認モード（デフォルト/手動/自動）・自動承認時のメール送信先

---

### 日報管理（`/reports`）

日報アプリから送信された日報の確認・承認・却下を行います。

**一覧画面の機能:**
- 現場名・作成者名での検索
- 月別フィルター（直近12ヶ月）
- 現場フィルター
- ステータスフィルター（下書き/署名済み/提出済み/承認済み/却下）
- ステータス別件数を表示
- ソート機能（日付・現場名・作成者・作業員数・提出日時・ステータス）
- ページネーション（20件/ページ）
- CSVエクスポート（期間・社員で絞り込み可能）
- PDF一括ダウンロード（期間指定、ZIP形式）

**詳細画面（`/reports/:id`）:**
- 日報の全情報を表示（日付・天候・現場・作業員・備考・写真）
- 得意先署名画像の表示
- 承認/却下ボタン（管理者・マネージャーのみ）
- 却下時は理由を入力

**日報のステータス遷移:**
```
下書き → 署名済み → 提出済み → 承認済み
                              → 却下 → 再編集 → 署名済み → ...
```

---

### 勤怠集計（`/reports/attendance`）

月別の従業員勤怠データを集計・表示します（現在非公開）。

- 月選択（直近12ヶ月）
- 従業員別集計: 出勤日数・総労働時間・昼休憩なし日数
- 合計行の表示
- CSV出力
- 稼働時間の計算: 自社情報設定の勤怠設定に基づいて昼休憩を控除

---

### システム管理

#### ユーザー管理（`/users`）- 管理者のみ

管理画面にログインできるユーザーの管理を行います。

- 表示名・メールアドレスでの検索
- ユーザー情報: 表示名・メールアドレス・権限・紐付け社員・状態・最終ログイン
- 操作: 編集・パスワードリセット・有効/無効切替・削除
- 新規ユーザー作成時はFirebase Authenticationにアカウントが作成されます

**権限の説明:**
| 権限 | できること |
|------|-----------|
| 管理者 | 全機能の利用（社員管理、ユーザー管理、設定変更など） |
| マネージャー | 日報の承認・却下、一部の管理機能 |
| ワーカー | 日報アプリからの日報入力のみ |

#### 自社情報設定（`/settings`）- 管理者のみ

自社の基本情報や各種設定を管理します。

| タブ | 設定内容 |
|------|----------|
| 会社情報 | 企業コード・会社名・支店名・代表者名・住所・連絡先・インボイス番号 |
| 口座・退職金 | 銀行情報（銀行名・支店名・口座種別・口座番号・名義）・退職金制度 |
| 日報・承認 | 日報締切時刻・承認モード（手動/自動）・自動承認メール送信先・通知設定 |
| 勤怠設定 | 昼休憩の稼働時間控除（する/しない）・昼休憩時間（30/45/60/90分） |

---

### CSVインポート機能

社員・取引先・現場データのCSV一括登録に対応しています。

**対応フォーマット:**
- 文字コード: UTF-8 / Shift-JIS（自動検出）
- BOM付きUTF-8に対応

**インポートの流れ:**
1. テンプレートCSVをダウンロード
2. データを入力してアップロード
3. プレビュー画面でバリデーション結果を確認
4. エラーがある行はスキップ可能
5. インポート実行（プログレスバー表示）
6. 結果サマリー（新規/更新/エラー件数）を確認
7. エラー行のCSVダウンロードが可能

---

### 通知機能

ヘッダーのベルアイコンから通知を確認できます。

- 提出済み日報の通知（承認待ち）
- 却下された日報の通知
- バッジで未読件数を表示
- クリックで日報詳細に遷移

---

## レスポンシブ対応

768px未満のモバイル表示に対応しています。

- **サイドバー**: ハンバーガーメニューで開閉、メニュー選択時に自動クローズ
- **一覧ページ**: テーブル表示からカード表示に自動切替
- **ヘッダー**: タイトルサイズをモバイル用に縮小
- **設定ページ**: タブバーが横スクロール可能
- **コンテンツ**: パディングをモバイル用に縮小

**対象ページ:** ダッシュボード・日報一覧・社員一覧・取引先一覧・現場一覧・ユーザー一覧・勤怠集計

---

## Firestoreデータ構造

```
companies/{companyId}
├── companyCode, companyName, branch, managerName
├── address (postalCode, prefecture, city, address, building)
├── contact (tel, fax, email)
├── invoiceNumber, bankInfo, retirementSystem
├── reportDeadline, approvalSettings, notificationSettings
├── attendanceSettings (deductLunchBreak, lunchBreakMinutes)
│
├── users/{userId}
│   ├── email, displayName, role, employeeId
│   ├── isActive, lastLoginAt
│
├── employees/{employeeId}
│   ├── lastName, firstName, lastNameKana, firstNameKana
│   ├── birthDate, gender, bloodType, isActive
│   ├── address, contact, employment, salary
│   ├── insurance, qualifications, licenses, family
│
├── clients/{clientId}
│   ├── clientName, managerName
│   ├── address, tel, fax, email
│
├── sites/{siteId}
│   ├── siteName, clientId, clientName, address
│   ├── startDate, endDate, status
│   ├── approvalSettings (mode, autoApprovalEmails)
│
└── dailyReports/{reportId}
    ├── reportDate, siteId, siteName, weather
    ├── createdBy, createdByName, status
    ├── workers[] (name, employeeId, startTime, endTime, noLunchBreak, remarks)
    ├── notes, photos[] (url, path, name)
    ├── clientSignature (imageUrl, signedAt)
    ├── submittedAt, approval (approvedBy, approvedAt, rejectionReason)
```

---

## 関連プロジェクト

- **日報アプリ**（現場作業員向け）: [daily-report-app](https://github.com/ay01sec/daily-report-app) - 日報の作成・署名・提出を行うモバイルPWAアプリ
