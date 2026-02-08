# Claude 指示書 - Labor Management System

## 重要な注意事項

**以下の実装内容はすべて確定済みです。**

- 既存のコードを変更する必要がある場合は、必ず事前にユーザーに提案・確認を行ってください
- 追加機能の実装上、既存機能の変更が必要な場合も、都度確認を取ってから実行してください
- ユーザーが確認後に編集要否を判断します

---

## プロジェクト構成

| プロジェクト | 説明 | Hosting URL |
|-------------|------|-------------|
| `labor-admin` | 管理システム（Web） | https://construction-manage.improve-biz.com |
| `daily-report-app` | 日報アプリ（PWA） | https://construction-report.improve-biz.com |
| `functions` | Cloud Functions | asia-northeast1 |

---

## 完了済み実装一覧

### 1. PAY.JP 決済連携
- Stripe から PAY.JP への移行完了
- 3Dセキュア対応のカード登録フォーム
- `registerCard` Cloud Function
- 請求書払い・解約機能

### 2. 二要素認証（2FA）
- TOTP ベースの2FA実装
- QRコード表示によるセットアップ
- 管理者のログイン時に2FA検証

### 3. 法的文書
- 利用規約・プライバシーポリシーページ
- フッターリンク

### 4. SendGrid メール連携
- メール送信用 Cloud Function
- PDF添付メール機能

### 5. PDF生成機能
- PDFKit による日報PDF生成
- テンプレート形式対応（報告日、元請確認欄、サイン画像、作業員テーブル、連絡事項、会社名フッター）
- 昼休憩なしチェックボックス表示
- 日本語フォント（NotoSansJP）対応

### 6. QRコード生成
- PDF URL からQRコード生成
- Firebase Storage に保存
- Firestore に URL 保存

### 7. 自動承認機能
- `onAutoApproveReport` Cloud Function（Firestore トリガー）
- 日報提出時に自動承認モードの場合、自動で承認処理
- 承認時に PDF・QRコード生成
- SendGrid でPDF添付メール送信

### 8. リアルタイムステータス監視
- `useReport` フックで `onSnapshot` によるリアルタイム更新
- ステータス変更時にQRコードモーダル自動表示
- 「承認待ち」表示（スピナー付き）

### 9. ホーム画面ガイダンス
- 「本日の日報は提出済みです」の下にPDF・QR確認案内を表示

### 10. 日報削除機能（2026-02-06 追加）
- **会社設定**: `allowReportDeletion` 設定（解約セクションの上）
- **日報管理画面**:
  - チェックボックスによる複数選択
  - 一括削除ボタン（選択時のみ表示）
  - 削除確認モーダル
  - Firestore batch による完全削除
  - デスクトップ・モバイル両対応

---

## 主要ファイル

### Cloud Functions (`functions/index.js`)
- `registerCompany` - 会社登録
- `registerCard` - PAY.JP カード登録（3Dセキュア対応）
- `onAutoApproveReport` - 自動承認・PDF/QR生成・メール送信
- `generateBulkPdf` - PDF一括ダウンロード
- `sendEmail` - SendGrid メール送信

### 管理システム (`labor-admin/src/`)
- `pages/reports/ReportList.jsx` - 日報一覧・削除機能
- `pages/reports/ReportDetail.jsx` - 日報詳細・PDF/QR表示
- `pages/settings/CompanySettings.jsx` - 会社設定・削除許可設定

### 日報アプリ (`daily-report-app/src/`)
- `pages/HomePage.jsx` - ホーム画面・提出状況表示
- `pages/ReportDetailPage.jsx` - 日報詳細・QRコード表示
- `hooks/useReport.js` - リアルタイム日報取得

---

## 環境変数

### フロントエンド (`.env`)
```
VITE_PAYJP_PUBLIC_KEY=pk_...
VITE_FIREBASE_API_KEY=...
```

### Cloud Functions
```
PAYJP_SECRET_KEY (Firebase Secret)
SENDGRID_API_KEY (Firebase Secret)
```

---

## 今後のタスクリスト

（新しいタスクがあれば、ここに追記してください）

- [ ]
- [ ]
- [ ]

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-02-06 | 日報削除機能追加 |
| 2026-02-06 | 自動承認・PDF/QR生成・メール送信機能追加 |
| 2026-02-06 | リアルタイムステータス監視追加 |
