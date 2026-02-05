const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const nodemailer = require("nodemailer");

initializeApp();
const db = getFirestore();
const auth = getAuth();

/**
 * 8桁のユニークな企業コードを生成
 */
async function generateUniqueCompanyCode() {
  for (let i = 0; i < 10; i++) {
    const code = String(Math.floor(10000000 + Math.random() * 90000000));
    const snapshot = await db
      .collection("companies")
      .where("companyCode", "==", code)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return code;
    }
  }
  throw new HttpsError("internal", "企業コードの生成に失敗しました。しばらくしてから再度お試しください。");
}

/**
 * ウェルカムメールを送信
 */
async function sendWelcomeEmail({ to, companyCode, displayName, adminUrl }) {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpUser || !smtpPass) {
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
    from: `"労務管理システム" <${smtpUser}>`,
    to,
    subject: "【労務管理システム】利用開始のご案内",
    text: mailBody,
  });

  return true;
}

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
