# セキュリティ機能実装詳細

このドキュメントでは、労務管理システムに実装されたセキュリティ機能の詳細を説明します。

---

## 1. PAY.JP 3Dセキュア認証

### 概要

クレジットカード決済時のセキュリティを強化するため、PAY.JPの3Dセキュア（EMV 3-Dセキュア）認証を実装しました。2025年3月末までにEC加盟店に義務化されるセキュリティ要件に対応しています。

### 実装ファイル

- `src/pages/settings/CompanySettings.jsx` - `PayjpCardForm` コンポーネント

### 実装内容

```javascript
// PAY.JP初期化（3Dセキュアワークフロー指定）
const payjp = window.Payjp(PAYJP_PUBLIC_KEY, {
  threeDSecureWorkflow: 'iframe'
});

// トークン作成（3Dセキュア認証付き）
const response = await payjpRef.current.createToken(cardNumberElementRef.current, {
  three_d_secure: true,
  card: {
    name: cardName.trim(),
    email: cardEmail.trim(),
  },
});
```

### 追加入力項目

| 項目 | 必須 | 説明 |
|------|------|------|
| カード名義 | 必須 | 半角英字（自動大文字変換） |
| メールアドレス | 必須 | 3Dセキュア認証に使用 |
| カード番号 | 必須 | PAY.JP Elements |
| 有効期限 | 必須 | PAY.JP Elements |
| CVC | 必須 | PAY.JP Elements |

### 認証フロー

1. ユーザーがカード情報を入力
2. `createToken()` で3Dセキュア認証を開始
3. iframe内でカード発行会社の認証画面が表示（必要な場合）
4. 認証完了後、トークンが発行される
5. トークンをCloud Functionに送信してカード登録

### 参考資料

- [PAY.JP 3Dセキュア ご紹介資料](https://payjp-document.s3.ap-northeast-1.amazonaws.com/product/emv3ds.pdf)
- [EMV3Dセキュア導入義務化 | PAY.JP](https://pay.jp/info/2025-01-15-150000)

---

## 2. 2段階認証（MFA）

### 概要

アカウントセキュリティを強化するため、Firebase Multi-Factor Authentication（MFA）を実装しました。SMS認証とTOTP（認証アプリ）の両方に対応しています。

### 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/contexts/AuthContext.jsx` | MFA関連のメソッド追加 |
| `src/pages/auth/Login.jsx` | MFAチャレンジUI |
| `src/pages/settings/MfaSettings.jsx` | MFA設定ページ（新規作成） |
| `src/App.jsx` | ルーティング追加、管理者MFA必須チェック |

### 対応する認証方式

#### SMS認証

- 電話番号にワンタイムコードを送信
- reCAPTCHA による不正利用防止
- 日本の電話番号形式に対応（`+81` 自動付与）

#### TOTP認証（認証アプリ）

- Google Authenticator / Microsoft Authenticator 等に対応
- QRコード表示によるかんたん登録
- シークレットキーの手動入力にも対応

### AuthContext に追加されたメソッド

```javascript
// MFA認証（ログイン時）
sendMfaSmsCode(phoneHint, recaptchaVerifier)  // SMS送信
verifyMfaSmsCode(verificationId, verificationCode)  // SMS認証
verifyMfaTotpCode(factorUid, verificationCode)  // TOTP認証

// MFA登録
enrollSmsMfa(phoneNumber, recaptchaVerifier)  // SMS登録開始
completeSmsMfaEnrollment(verificationId, verificationCode, displayName)  // SMS登録完了
startTotpEnrollment()  // TOTP登録開始（シークレット生成）
completeTotpEnrollment(totpSecret, verificationCode, displayName)  // TOTP登録完了

// MFA管理
getEnrolledMfaFactors()  // 登録済みMFA一覧
unenrollMfa(factorUid)  // MFA登録解除
requiresMfaSetup()  // 管理者の2FA必須チェック
```

### ログインフロー

```
[ログイン画面]
    │
    ├─ メール/パスワード入力
    │
    ▼
[Firebase Auth ログイン試行]
    │
    ├─ 成功 → ダッシュボードへ
    │
    └─ auth/multi-factor-auth-required
           │
           ▼
       [MFA方式選択]
           │
           ├─ SMS認証 → コード送信 → コード入力 → 認証完了
           │
           └─ TOTP認証 → コード入力 → 認証完了
```

### 管理者の2FA必須

- 管理者（admin ロール）はMFA設定が必須
- MFA未設定の管理者がログインすると `/settings/mfa` にリダイレクト
- 最低1つのMFAを登録するまで他のページにアクセス不可

```javascript
// App.jsx - PrivateRoute
if (!skipMfaCheck && requiresMfaSetup() && location.pathname !== '/settings/mfa') {
  return <Navigate to="/settings/mfa" replace />;
}
```

### MFA設定ページ (`/settings/mfa`)

- 登録済みMFAの一覧表示
- SMS認証の追加
- TOTP認証の追加（QRコード表示）
- MFAの削除（管理者は最低1つ必要）

### Firebase Console 設定

MFA機能を有効にするには、Firebase Console で以下の設定が必要です：

1. **Authentication** → **Sign-in method** を開く
2. **Multi-factor authentication** を有効化
3. **Phone** プロバイダーを有効化（SMS認証用）
4. 必要に応じて **TOTP** を有効化

### 使用パッケージ

- `firebase/auth` - MFA関連API
- `qrcode` - QRコード生成

### 参考資料

- [Add TOTP multi-factor authentication to your web app | Firebase](https://firebase.google.com/docs/auth/web/totp-mfa)
- [SMS Multi-factor Auth | Firebase](https://firebase.google.com/docs/auth/web/multi-factor)

---

## 3. セキュリティベストプラクティス

### 実装済み

- [x] 3Dセキュア認証（カード決済）
- [x] 2段階認証（SMS/TOTP）
- [x] 管理者の2FA必須化
- [x] reCAPTCHA による不正ログイン防止
- [x] ロールベースアクセス制御（admin/manager/worker）
- [x] 企業ごとのデータ分離（マルチテナント）

### Firebase Console で設定が必要

- [ ] MFA（Multi-factor authentication）の有効化
- [ ] Phone プロバイダーの有効化
- [ ] 許可ドメインの設定

---

## 4. 環境変数

### フロントエンド（Vercel）

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_PAYJP_PUBLIC_KEY=
```

### バックエンド（Cloud Functions）

```
PAYJP_SECRET_KEY=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
```

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-02-06 | PAY.JP 3Dセキュア認証実装 |
| 2026-02-06 | 2段階認証（MFA）実装 |
