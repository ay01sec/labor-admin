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
- **月額課金機能**（2026-03-02 実装、同日改修）
  - `dailyBillingProcessor` - 日次課金処理（毎日 09:00 JST）
  - `executeBilling` - 手動課金実行（管理者用）
  - `getBillingHistory` - 課金履歴取得
  - `calculateCurrentBilling` - 現在の料金計算
  - `getBillingStatus` - 課金ステータス取得
- **領収書自動発行**
  - 課金成功時にPDF領収書を自動生成
  - Firebase Storageに保存
  - 管理者にメール添付送信
  - 但し書き: 「労務管理アプリ月額使用料」

**料金体系:**
| 項目 | 価格（税込） |
|------|-------------|
| 基本料金 | ¥1,200/月 |
| 追加料金（4人目以降） | ¥300/人/月 |
| 無料トライアル | 30日間 |

**課金日の仕組み:**
- 初回課金: トライアル終了翌日
- 課金日: トライアル終了翌日が29日以降の場合は28日に固定、以降毎月同日
- リトライ: 課金失敗時は3日後→7日後に再試行、失敗でサービス停止

**課金ステータス:**
| ステータス | 説明 |
|-----------|------|
| `trial` | 無料トライアル中 |
| `active` | 有効（課金中） |
| `past_due` | 支払い遅延（リトライ待ち） |
| `expired` | トライアル終了（カード未登録） |
| `suspended` | サービス停止（課金失敗上限到達） |
| `canceled` | 解約済み |

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
- `registerCompany` - 会社登録（トライアル終了日設定）
- `registerCard` - PAY.JP カード登録（3Dセキュア対応、ステータス別処理）
- `onAutoApproveReport` - 自動承認・PDF/QR生成・メール送信
- `generateBulkPdf` - PDF一括ダウンロード
- `sendEmail` - SendGrid メール送信
- `dailyBillingProcessor` - 日次課金処理（毎日 09:00 JST）
- `monthlyBilling` - 互換性用（非推奨、何もしない）
- `executeBilling` - 手動課金実行
- `getBillingHistory` - 課金履歴取得
- `calculateCurrentBilling` - 料金計算プレビュー
- `getBillingStatus` - 課金ステータス取得
- `onUserAddedToCompany` - ユーザー追加時にCustom Claim設定（Storage権限用）
- `setCompanyClaim` - 既存ユーザー向けCustom Claim設定（モバイルアプリから呼び出し）

### 管理システム (`labor-admin/src/`)
- `pages/reports/ReportList.jsx` - 日報一覧・削除機能
- `pages/reports/ReportDetail.jsx` - 日報詳細・PDF/QR表示
- `pages/settings/CompanySettings.jsx` - 会社設定・削除許可設定

### 日報アプリ (`daily-report-app/src/`)
- `pages/HomePage.jsx` - ホーム画面・提出状況表示
- `pages/ReportDetailPage.jsx` - 日報詳細・QRコード表示
- `hooks/useReport.js` - リアルタイム日報取得

---

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| フレームワーク | React 19 / Vite 7 |
| スタイリング | Tailwind CSS 4 |
| バックエンド | Firebase (Auth, Firestore, Storage, Functions, Hosting) |
| 決済 | PAY.JP（3Dセキュア対応） |
| メール | SendGrid |
| PDF生成 | PDFKit（日本語フォント対応） |
| アイコン | Lucide React |
| E2Eテスト | Playwright |

## 開発コマンド

```bash
npm run dev      # 開発サーバー起動
npm run build    # プロダクションビルド
npm run lint     # ESLint実行
npm run test:e2e # E2Eテスト実行
```

---

## 環境変数

### フロントエンド (`.env` / `.env.production`)
```
VITE_PAYJP_PUBLIC_KEY=pk_...
VITE_FIREBASE_API_KEY=...
```

**PAY.JPキー切り替え:**
- 本番用: `.env.production` に設定済み（`pk_live_...`）
- テスト用: `.env` にコメントで保持（`pk_test_447266e79f203c5af45af804`）

### Cloud Functions
```
PAYJP_SECRET_KEY (Firebase Secret)
SENDGRID_API_KEY (Firebase Secret)
```

**PAY.JPシークレットキー切り替え:**
```bash
# 本番/テスト切り替え
firebase functions:secrets:set PAYJP_SECRET_KEY
# → PAY.JPダッシュボードから取得したシークレットキーを入力
```
※テスト用シークレットキーは`.env.local.backup`に保管

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
| 2026-04-01 | 技術スタック情報追加、npm audit fix実施 |
| 2026-03-02 | 課金システム改修: トライアル終了日基準の課金、日次スケジューラー、リトライ処理、機能制限 |
| 2026-03-02 | 月額課金機能追加（PAY.JP charges.create）、領収書自動発行、料金体系更新 |
| 2026-02-06 | 日報削除機能追加 |
| 2026-02-06 | 自動承認・PDF/QR生成・メール送信機能追加 |
| 2026-02-06 | リアルタイムステータス監視追加 |
