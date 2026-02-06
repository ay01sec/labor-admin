const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const nodemailer = require("nodemailer");

initializeApp();
const db = getFirestore();
const auth = getAuth();

// PAY.JP初期化（環境変数から）
function getPayjp() {
  const secretKey = process.env.PAYJP_SECRET_KEY;
  if (!secretKey) {
    throw new HttpsError("failed-precondition", "PAY.JP設定が未完了です。管理者に連絡してください。");
  }
  return require("payjp")(secretKey);
}

/**
 * 8桁のユニークな企業コードを生成（連番）
 */
async function generateUniqueCompanyCode() {
  const START_CODE = 10000001; // 開始番号（8桁）

  // 既存の最大企業コードを取得
  const snapshot = await db
    .collection("companies")
    .orderBy("companyCode", "desc")
    .limit(1)
    .get();

  let nextCode;
  if (snapshot.empty) {
    // 初めての企業の場合は開始番号から
    nextCode = START_CODE;
  } else {
    // 最大コード + 1（ただし開始番号未満の場合は開始番号を使用）
    const maxCode = parseInt(snapshot.docs[0].data().companyCode, 10);
    nextCode = Math.max(maxCode + 1, START_CODE);
  }

  // 8桁を超えないかチェック
  if (nextCode > 99999999) {
    throw new HttpsError("internal", "企業コードが上限に達しました。");
  }

  return String(nextCode);
}

/**
 * ウェルカムメールを送信
 */
async function sendWelcomeEmail({ to, companyCode, displayName, adminUrl }) {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM;

  if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
    console.warn("SMTP設定が未設定のためメール送信をスキップしました");
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number(smtpPort) || 587,
    secure: false,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  const loginUrl = `${adminUrl || "https://labor-admin-20260202.web.app"}/login`;

  const mailBody = `
${displayName} 様

この度は労務管理システムをご利用いただきありがとうございます。
利用開始手続きが完了しましたので、ログイン情報をお送りいたします。

━━━━━━━━━━━━━━━━━━━━━━
■ ログイン情報
━━━━━━━━━━━━━━━━━━━━━━

企業ID: ${companyCode}
メールアドレス: ${to}
パスワード: ●●●●●●（利用開始手続き時に設定したパスワード）

━━━━━━━━━━━━━━━━━━━━━━
■ ログイン方法
━━━━━━━━━━━━━━━━━━━━━━

1. 以下のURLにアクセスしてください
   ${loginUrl}

2. 上記の企業ID（8桁の数字）を入力してください

3. メールアドレスとパスワードを入力して「ログイン」をクリックしてください

━━━━━━━━━━━━━━━━━━━━━━
■ ログイン後にできること
━━━━━━━━━━━━━━━━━━━━━━

・自社情報の設定（銀行情報、通知設定など）
・社員の登録・管理
・取引先の登録・管理
・現場の登録・管理
・日報の確認・承認
・ユーザーの追加

━━━━━━━━━━━━━━━━━━━━━━

※ このメールに心当たりがない場合は、お手数ですが破棄してください。
※ パスワードを忘れた場合は、ログイン画面の「パスワードを忘れた方」から再設定できます。
`.trim();

  await transporter.sendMail({
    from: `"労務管理システム" <${smtpFrom}>`,
    to,
    subject: "【労務管理システム】利用開始のご案内",
    text: mailBody,
  });

  return true;
}

/**
 * PAY.JP カード登録処理
 */
exports.registerCard = onCall(
  { region: "asia-northeast1", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { companyId, tokenId } = request.data;
    if (!companyId || !tokenId) {
      throw new HttpsError("invalid-argument", "companyIdとtokenIdは必須です");
    }

    try {
      const payjp = getPayjp();
      const companyRef = db.collection("companies").doc(companyId);
      const companySnap = await companyRef.get();

      if (!companySnap.exists) {
        throw new HttpsError("not-found", "企業が見つかりません");
      }

      const companyData = companySnap.data();
      let payjpCustomerId = companyData.billing?.payjpCustomerId;
      let card;

      if (!payjpCustomerId) {
        // PAY.JP顧客が未作成 → 顧客作成（カード付き）
        const customer = await payjp.customers.create({
          card: tokenId,
          description: `${companyData.companyName} (${companyData.companyCode})`,
        });
        payjpCustomerId = customer.id;
        card = customer.cards.data[0];
      } else {
        // 既存顧客 → カード追加
        const newCard = await payjp.customers.cards.create(payjpCustomerId, {
          card: tokenId,
        });
        card = newCard;

        // デフォルトカードに設定
        await payjp.customers.update(payjpCustomerId, {
          default_card: card.id,
        });
      }

      // Firestoreを更新
      await companyRef.update({
        "billing.paymentMethod": "card",
        "billing.status": "active",
        "billing.payjpCustomerId": payjpCustomerId,
        "billing.cardLast4": card.last4,
        "billing.cardBrand": card.brand,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        card: {
          last4: card.last4,
          brand: card.brand,
        },
      };
    } catch (error) {
      console.error("カード登録エラー:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "カード登録に失敗しました");
    }
  }
);

/**
 * 請求書払い申請処理
 */
exports.requestInvoicePayment = onCall(
  { region: "asia-northeast1", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { companyId, invoiceRequest } = request.data;
    if (!companyId) {
      throw new HttpsError("invalid-argument", "companyIdは必須です");
    }
    if (!invoiceRequest || !invoiceRequest.contactName) {
      throw new HttpsError("invalid-argument", "担当者名は必須です");
    }

    try {
      const companyRef = db.collection("companies").doc(companyId);
      await companyRef.update({
        "billing.paymentMethod": "invoice",
        "billing.status": "active",
        "billing.invoiceRequest": {
          contactName: invoiceRequest.contactName,
          billingAddress: invoiceRequest.billingAddress || "",
          note: invoiceRequest.note || "",
          requestedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { success: true };
    } catch (error) {
      console.error("請求書払い申請エラー:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "請求書払いの申請に失敗しました");
    }
  }
);

/**
 * 企業解約処理
 */
exports.cancelCompany = onCall(
  { region: "asia-northeast1", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { companyId } = request.data;
    if (!companyId) {
      throw new HttpsError("invalid-argument", "companyIdは必須です");
    }

    try {
      // 管理者権限チェック
      const companyRef = db.collection("companies").doc(companyId);
      const userDoc = await companyRef
        .collection("users")
        .doc(request.auth.uid)
        .get();

      if (!userDoc.exists || userDoc.data().role !== "admin") {
        throw new HttpsError("permission-denied", "管理者のみ解約できます");
      }

      // 既に解約済みかチェック
      const companySnap = await companyRef.get();
      if (!companySnap.exists) {
        throw new HttpsError("not-found", "企業が見つかりません");
      }
      if (companySnap.data().billing?.status === "canceled") {
        throw new HttpsError("failed-precondition", "既に解約済みです");
      }

      // 解約処理
      await companyRef.update({
        "billing.status": "canceled",
        "billing.canceledAt": FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { success: true };
    } catch (error) {
      console.error("企業解約エラー:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "解約処理に失敗しました");
    }
  }
);

/**
 * 新規企業登録 Cloud Function
 */
/**
 * 2段階認証コード送信
 */
exports.send2FACode = onCall(
  { region: "asia-northeast1", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { companyId } = request.data;
    if (!companyId) {
      throw new HttpsError("invalid-argument", "companyIdは必須です");
    }

    try {
      // ユーザー情報を取得
      const userDoc = await db
        .collection("companies")
        .doc(companyId)
        .collection("users")
        .doc(request.auth.uid)
        .get();

      if (!userDoc.exists) {
        throw new HttpsError("not-found", "ユーザーが見つかりません");
      }

      const userData = userDoc.data();

      // 6桁のコードを生成
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10分後に期限切れ

      // コードをFirestoreに保存
      await db.collection("twoFactorCodes").doc(request.auth.uid).set({
        code,
        companyId,
        expiresAt: Timestamp.fromDate(expiresAt),
        createdAt: FieldValue.serverTimestamp(),
        verified: false,
      });

      // メール送信
      const smtpHost = process.env.SMTP_HOST;
      const smtpPort = process.env.SMTP_PORT;
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      const smtpFrom = process.env.SMTP_FROM;

      if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
        console.warn("SMTP設定が未設定のためメール送信をスキップ");
        // 開発用: SMTPが未設定の場合はコードをレスポンスに含める
        return { success: true, devCode: code };
      }

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(smtpPort) || 587,
        secure: false,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      const mailBody = `
${userData.displayName} 様

以下の認証コードを入力してログインを完了してください。

━━━━━━━━━━━━━━━━━━━━━━
認証コード: ${code}
━━━━━━━━━━━━━━━━━━━━━━

※ このコードは10分間有効です。
※ このメールに心当たりがない場合は、破棄してください。
`.trim();

      await transporter.sendMail({
        from: `"労務管理システム" <${smtpFrom}>`,
        to: userData.email,
        subject: "【労務管理システム】認証コード",
        text: mailBody,
      });

      return { success: true };
    } catch (error) {
      console.error("2FAコード送信エラー:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "認証コードの送信に失敗しました");
    }
  }
);

/**
 * 2段階認証コード検証
 */
exports.verify2FACode = onCall(
  { region: "asia-northeast1", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { code } = request.data;
    if (!code) {
      throw new HttpsError("invalid-argument", "認証コードは必須です");
    }

    try {
      const codeDoc = await db
        .collection("twoFactorCodes")
        .doc(request.auth.uid)
        .get();

      if (!codeDoc.exists) {
        throw new HttpsError("not-found", "認証コードが見つかりません。再度コードを送信してください。");
      }

      const codeData = codeDoc.data();

      // 有効期限チェック
      if (codeData.expiresAt.toDate() < new Date()) {
        await db.collection("twoFactorCodes").doc(request.auth.uid).delete();
        throw new HttpsError("deadline-exceeded", "認証コードの有効期限が切れました。再度コードを送信してください。");
      }

      // コードチェック
      if (codeData.code !== code) {
        throw new HttpsError("invalid-argument", "認証コードが正しくありません");
      }

      // 検証済みに更新
      await db.collection("twoFactorCodes").doc(request.auth.uid).update({
        verified: true,
        verifiedAt: FieldValue.serverTimestamp(),
      });

      return { success: true };
    } catch (error) {
      console.error("2FAコード検証エラー:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "認証コードの検証に失敗しました");
    }
  }
);

/**
 * 新規企業登録 Cloud Function
 */
exports.registerCompany = onCall(
  { region: "asia-northeast1", maxInstances: 10 },
  async (request) => {
    const { company, user } = request.data;

    // --- バリデーション ---
    if (!company || !company.companyName || !company.companyName.trim()) {
      throw new HttpsError("invalid-argument", "会社名は必須です");
    }
    if (!user || !user.email || !user.email.trim()) {
      throw new HttpsError("invalid-argument", "メールアドレスは必須です");
    }
    if (!user.displayName || !user.displayName.trim()) {
      throw new HttpsError("invalid-argument", "表示名は必須です");
    }
    if (!user.password || user.password.length < 6) {
      throw new HttpsError("invalid-argument", "パスワードは6文字以上で入力してください");
    }

    try {
      // 1. 企業コード生成
      const companyCode = await generateUniqueCompanyCode();

      // 2. Firestore に企業ドキュメント作成
      const companyRef = db.collection("companies").doc();
      await companyRef.set({
        companyCode,
        companyName: company.companyName.trim(),
        branch: company.branch || "",
        managerName: company.managerName || "",
        postalCode: company.postalCode || "",
        prefecture: company.prefecture || "",
        city: company.city || "",
        address: company.address || "",
        building: company.building || "",
        tel: company.tel || "",
        fax: company.fax || "",
        email: company.email || "",
        invoiceNumber: "",
        retirementSystem: false,
        retirementNumber: "",
        bankInfo: {
          bankName: "",
          branchName: "",
          accountType: "",
          accountNumber: "",
          accountHolder: "",
        },
        notificationSettings: {
          enabled: false,
          reminderTimes: ["17:00"],
        },
        reportDeadline: "18:00",
        approvalSettings: {
          mode: "manual",
          autoApprovalEmails: [],
        },
        attendanceSettings: {
          deductLunchBreak: true,
          lunchBreakMinutes: 60,
        },
        employmentTypes: [
          { id: "seishain", label: "正社員", color: "blue", isDefault: true },
          { id: "keiyaku", label: "契約社員", color: "purple", isDefault: true },
          { id: "part", label: "パート", color: "orange", isDefault: true },
          { id: "arbeit", label: "アルバイト", color: "yellow", isDefault: true },
          { id: "gaibu", label: "外部", color: "gray", isDefault: true },
        ],
        billing: {
          status: "trial",
          paymentMethod: null,
          payjpCustomerId: null,
          trialEndsAt: Timestamp.fromDate(
            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          ),
          invoiceRequest: null,
          cardLast4: null,
          cardBrand: null,
        },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 3. Firebase Auth にユーザー作成
      const userRecord = await auth.createUser({
        email: user.email.trim(),
        password: user.password,
        displayName: user.displayName.trim(),
      });

      // 4. Firestore にユーザードキュメント作成
      await companyRef.collection("users").doc(userRecord.uid).set({
        email: user.email.trim(),
        displayName: user.displayName.trim(),
        role: "admin",
        employeeId: null,
        isActive: true,
        lastLoginAt: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 5. ウェルカムメール送信
      const adminUrl = process.env.ADMIN_URL || "https://labor-admin-20260202.web.app";
      await sendWelcomeEmail({
        to: user.email.trim(),
        companyCode,
        displayName: user.displayName.trim(),
        adminUrl,
      });

      return {
        success: true,
        companyCode,
      };
    } catch (error) {
      console.error("企業登録エラー:", error);

      if (error.code === "auth/email-already-exists") {
        throw new HttpsError("already-exists", "このメールアドレスは既に登録されています");
      }
      if (error.code === "auth/invalid-email") {
        throw new HttpsError("invalid-argument", "メールアドレスの形式が正しくありません");
      }
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError("internal", "登録処理中にエラーが発生しました。しばらくしてから再度お試しください。");
    }
  }
);
