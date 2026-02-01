# 開発環境 操作手順書

## 前提条件

- Node.js 18以上がインストール済み
- npmまたはyarnが使用可能
- Gitがインストール済み

---

## 開発サーバーの起動

### 1. プロジェクトディレクトリに移動

```bash
cd labor-admin
```

### 2. 依存パッケージのインストール（初回または更新時）

```bash
npm install
```

### 3. 開発サーバーを起動

```bash
npm run dev
```

### 4. ブラウザでアクセス

サーバー起動後、以下のURLにアクセス：

```
http://localhost:3000
```

※ 自動的にブラウザが開く設定になっています

---

## 開発サーバーの停止

ターミナルで以下のキーを押す：

```
Ctrl + C
```

確認メッセージが表示された場合は `Y` を入力してEnter

---

## その他のコマンド

### 本番ビルド

```bash
npm run build
```

`dist/` フォルダに本番用ファイルが生成されます。

### ビルド結果のプレビュー

```bash
npm run preview
```

### コードの静的解析（Lint）

```bash
npm run lint
```

---

## トラブルシューティング

### ポート3000が使用中の場合

他のアプリがポート3000を使用している場合、`vite.config.js` でポートを変更：

```javascript
server: {
  port: 3001,  // 別のポートに変更
  open: true
}
```

### node_modulesのエラー

node_modulesを削除して再インストール：

```bash
rm -rf node_modules
npm install
```

### 環境変数が読み込まれない

- `.env` ファイルがプロジェクトルートにあるか確認
- 変数名が `VITE_` で始まっているか確認
- 開発サーバーを再起動

---

## Firebase Hosting へのデプロイ

### 1. Firebase CLIのインストール（初回のみ）

```bash
npm install -g firebase-tools
```

### 2. Firebaseにログイン

```bash
firebase login
```

### 3. プロジェクトの初期化（初回のみ）

```bash
firebase init hosting
```

- 「Use an existing project」を選択
- public directory: `dist`
- Single-page app: `Yes`
- GitHub自動デプロイ: `No`

### 4. ビルド

```bash
npm run build
```

### 5. デプロイ

```bash
firebase deploy --only hosting
```

デプロイ完了後、表示されるURLでアクセス可能になります。
