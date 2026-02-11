const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentUpdated, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { getStorage } = require("firebase-admin/storage");
const nodemailer = require("nodemailer");
const sgMail = require("@sendgrid/mail");
const PDFDocument = require("pdfkit");
const JSZip = require("jszip");
const QRCode = require("qrcode");
const path = require("path");

initializeApp();
const db = getFirestore();
const auth = getAuth();
const bucket = getStorage().bucket();
const messaging = getMessaging();

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

  const loginUrl = `${adminUrl || "https://construction-manage.improve-biz.com"}/login`;

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
 * 請求書払い申請処理 - 一時的に無効化
 */
/*
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
*/

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
      const adminUrl = process.env.ADMIN_URL || "https://construction-manage.improve-biz.com";
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

/**
 * PDF一括ダウンロード
 */
exports.generateBulkPdf = onCall(
  { region: "asia-northeast1", maxInstances: 10, memory: "1GiB", timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { companyId, startDate, endDate } = request.data;
    if (!companyId || !startDate || !endDate) {
      throw new HttpsError("invalid-argument", "companyId, startDate, endDateは必須です");
    }

    try {
      // 日付をTimestampに変換
      const startDateObj = new Date(startDate + "T00:00:00");
      const endDateObj = new Date(endDate + "T23:59:59");

      // 承認済み日報を取得
      const reportsSnapshot = await db
        .collection("companies")
        .doc(companyId)
        .collection("dailyReports")
        .where("status", "==", "approved")
        .where("reportDate", ">=", Timestamp.fromDate(startDateObj))
        .where("reportDate", "<=", Timestamp.fromDate(endDateObj))
        .orderBy("reportDate", "asc")
        .get();

      if (reportsSnapshot.empty) {
        return { zipBase64: null, count: 0, message: "該当する日報がありません" };
      }

      // 会社情報を取得
      const companyDoc = await db.collection("companies").doc(companyId).get();
      const companyData = companyDoc.exists ? companyDoc.data() : {};

      // フォントパス
      const fontPath = path.join(__dirname, "fonts", "NotoSansJP-Regular.otf");

      // ロゴ画像をダウンロード（一度だけ）
      const logoImageBuffer = await downloadSignatureImage(companyData.logoImage);

      const zip = new JSZip();
      const reports = [];

      reportsSnapshot.forEach((doc) => {
        reports.push({ id: doc.id, ...doc.data() });
      });

      // 各日報のPDFを生成
      for (const report of reports) {
        const signatureImageBuffer = await downloadSignatureImage(report.clientSignature?.imageUrl);
        // 現場データから元請会社名と昼休憩設定を取得
        let clientName = null;
        let siteLunchBreakSettings = null;
        if (report.siteId) {
          const siteDoc = await db.collection("companies").doc(companyId).collection("sites").doc(report.siteId).get();
          if (siteDoc.exists) {
            const siteData = siteDoc.data();
            clientName = siteData.clientName || null;
            siteLunchBreakSettings = siteData.lunchBreakSettings || null;
          }
        }
        const pdfBuffer = await generateReportPdf(report, companyData, fontPath, signatureImageBuffer, logoImageBuffer, clientName, siteLunchBreakSettings);
        const reportDate = report.reportDate?.toDate ? report.reportDate.toDate() : new Date(report.reportDate);
        const dateStr = formatDateForFilename(reportDate);
        const siteName = (report.siteName || "不明").replace(/[/\\?%*:|"<>]/g, "_");
        const filename = `日報_${dateStr}_${siteName}.pdf`;
        zip.file(filename, pdfBuffer);
      }

      // ZIPファイルを生成
      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const zipBase64 = zipBuffer.toString("base64");

      return { zipBase64, count: reports.length };
    } catch (error) {
      console.error("PDF一括生成エラー:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "PDF生成に失敗しました: " + error.message);
    }
  }
);

/**
 * 署名画像をダウンロード
 */
async function downloadSignatureImage(imageUrl) {
  if (!imageUrl) return null;
  const https = require("https");
  return new Promise((resolve) => {
    https.get(imageUrl, (res) => {
      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", () => resolve(null));
    }).on("error", () => resolve(null));
  });
}

/**
 * 日報PDFを生成（テンプレート形式）
 */
function generateReportPdf(report, companyData, fontPath, signatureImageBuffer, logoImageBuffer, clientName, siteLunchBreakSettings) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const buffers = [];

      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", reject);

      doc.registerFont("NotoSans", fontPath);
      doc.font("NotoSans");

      const LEFT = 50;
      const RIGHT = 545;
      const WIDTH = RIGHT - LEFT;

      // 日付フォーマット
      const reportDate = report.reportDate?.toDate
        ? report.reportDate.toDate()
        : new Date(report.reportDate);
      const dateStr = `${reportDate.getMonth() + 1}月${reportDate.getDate()}日`;

      const submittedAt = report.submittedAt?.toDate
        ? report.submittedAt.toDate()
        : report.submittedAt ? new Date(report.submittedAt) : new Date();
      const reportDateStr = `${submittedAt.getMonth() + 1}月${submittedAt.getDate()}日`;

      // === ロゴ・会社名・報告日（上段） ===
      let currentY = 50;
      const logoHeight = 40;

      // ロゴ画像（左側）
      if (logoImageBuffer) {
        try {
          doc.image(logoImageBuffer, LEFT, currentY, {
            fit: [logoHeight, logoHeight],
          });
        } catch (e) {
          console.error("ロゴ画像埋め込みエラー:", e);
        }
      }

      // 会社名（ロゴの右隣）
      const companyNameX = logoImageBuffer ? LEFT + logoHeight + 10 : LEFT;
      doc.fontSize(14).fillColor("#000000");
      doc.text(companyData.companyName || "", companyNameX, currentY + 12, {
        width: 300,
      });

      // 報告日（右側）
      doc.fontSize(10).fillColor("#000000");
      doc.text(`報告日：${reportDateStr}`, RIGHT - 100, currentY + 15, {
        width: 100,
        align: "right",
      });

      currentY += logoHeight + 15;
      doc.y = currentY;

      // === ヘッダー2行構成 ===
      const headerTop = currentY;
      const row1H = 55;        // 上段（元請確認欄）高さを大きく
      const row2H = 22;        // 下段（作業日報）通常高さ
      const labelW = 70;       // 「元請確認欄」「作業日報」列
      const signW = 200;       // サイン列
      const infoLabelW = 50;   // 「実施日」「作成者」列
      const col1 = LEFT;
      const col2 = LEFT + labelW;
      const col3 = col2 + signW;
      const col4 = col3 + infoLabelW;

      // 上段: 元請確認欄 | サイン | 実施日 | 日付
      doc.rect(col1, headerTop, WIDTH, row1H).stroke();
      doc.moveTo(col2, headerTop).lineTo(col2, headerTop + row1H).stroke();
      doc.moveTo(col3, headerTop).lineTo(col3, headerTop + row1H).stroke();
      doc.moveTo(col4, headerTop).lineTo(col4, headerTop + row1H).stroke();

      doc.fontSize(9);
      doc.text("元請確認欄", col1 + 4, headerTop + (row1H / 2) - 5);
      doc.text("実施日", col3 + 4, headerTop + (row1H / 2) - 5);
      doc.text(dateStr, col4 + 4, headerTop + (row1H / 2) - 5);

      // サイン画像（上段のみ: col2〜col3）
      if (signatureImageBuffer) {
        try {
          const sigPad = 4;
          doc.image(signatureImageBuffer, col2 + sigPad, headerTop + sigPad, {
            fit: [signW - sigPad * 2, row1H - sigPad * 2],
          });
        } catch (e) {
          console.error("サイン画像埋め込みエラー:", e);
        }
      }

      // 下段: 作業日報 | （空白） | 作成者 | 名前
      const row2Top = headerTop + row1H;
      doc.rect(col1, row2Top, WIDTH, row2H).stroke();
      doc.moveTo(col3, row2Top).lineTo(col3, row2Top + row2H).stroke();
      doc.moveTo(col4, row2Top).lineTo(col4, row2Top + row2H).stroke();

      doc.text("作業日報", col1 + 4, row2Top + 6);
      doc.text("作成者", col3 + 4, row2Top + 6);
      doc.text(report.createdByName || "", col4 + 4, row2Top + 6);

      // === 元請会社名・現場名 ===
      let infoTop = row2Top + row2H + 10;
      doc.fontSize(11);

      // 元請会社名
      if (clientName) {
        doc.text("元請会社名", LEFT, infoTop, { continued: true });
        doc.text(`  ${clientName}`);
        infoTop = doc.y + 5;
      }

      // 現場名
      doc.text("現場名", LEFT, infoTop, { continued: true });
      doc.text(`     ${report.siteName || ""}`);
      doc.moveDown(0.5);

      // === 作業員テーブル ===
      const tableTop = doc.y;
      const colWidths = [90, 55, 55, 50, 55, 190];
      const headers = ["氏名", "開始時間", "終了時間", "実働時間", "昼休憩なし", "備考及び作業内容"];
      const rowHeight = 22;
      const totalRows = 9; // 固定9行（リファレンス準拠）
      const workers = report.workers || [];

      // 昼休憩設定を取得（現場設定を優先、なければ会社設定）
      const lunchSettings = siteLunchBreakSettings || companyData?.attendanceSettings || {};
      const deductLunchBreak = lunchSettings.deductLunchBreak !== false; // デフォルトtrue
      const lunchBreakMinutes = lunchSettings.lunchBreakMinutes || 60;

      // 実働時間を計算するヘルパー関数
      const calcWorkingHours = (startTime, endTime, noLunchBreak) => {
        if (!startTime || !endTime) return "";
        const [startH, startM] = startTime.split(":").map(Number);
        const [endH, endM] = endTime.split(":").map(Number);
        if (isNaN(startH) || isNaN(endH)) return "";
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;
        let diff = endMinutes - startMinutes;
        if (diff < 0) return "";
        // 昼休憩控除: deductLunchBreakがtrueかつnoLunchBreakがfalseの場合のみ控除
        if (deductLunchBreak && !noLunchBreak) {
          diff -= lunchBreakMinutes;
          if (diff < 0) diff = 0;
        }
        const hours = Math.floor(diff / 60);
        const minutes = diff % 60;
        return minutes > 0 ? `${hours}:${String(minutes).padStart(2, "0")}` : `${hours}:00`;
      };

      // テーブルヘッダー
      doc.rect(LEFT, tableTop, WIDTH, rowHeight).stroke();
      doc.fontSize(9).fillColor("#000000");
      let x = LEFT;
      headers.forEach((header, i) => {
        doc.text(header, x + 3, tableTop + 6, { width: colWidths[i] - 6 });
        if (i < headers.length - 1) {
          doc.moveTo(x + colWidths[i], tableTop)
            .lineTo(x + colWidths[i], tableTop + rowHeight).stroke();
        }
        x += colWidths[i];
      });

      // テーブル行
      for (let row = 0; row < totalRows; row++) {
        const y = tableTop + rowHeight * (row + 1);
        doc.rect(LEFT, y, WIDTH, rowHeight).stroke();

        x = LEFT;
        const worker = workers[row];

        // 各列の区切り線
        for (let i = 0; i < colWidths.length - 1; i++) {
          x += colWidths[i];
          doc.moveTo(x, y).lineTo(x, y + rowHeight).stroke();
        }

        if (worker) {
          x = LEFT;
          // 氏名
          doc.text(worker.name || "", x + 3, y + 6, { width: colWidths[0] - 6 });
          x += colWidths[0];
          // 開始時間
          doc.text(worker.startTime || "", x + 3, y + 6, { width: colWidths[1] - 6 });
          x += colWidths[1];
          // 終了時間
          doc.text(worker.endTime || "", x + 3, y + 6, { width: colWidths[2] - 6 });
          x += colWidths[2];
          // 実働時間（昼休憩控除を考慮）
          const workingHours = calcWorkingHours(worker.startTime, worker.endTime, worker.noLunchBreak);
          doc.text(workingHours, x + 3, y + 6, { width: colWidths[3] - 6 });
          x += colWidths[3];
          // 昼休憩なしチェックボックス
          const cbX = x + (colWidths[4] / 2) - 6;
          const cbY = y + 5;
          doc.rect(cbX, cbY, 12, 12).stroke();
          if (worker.noLunchBreak) {
            doc.moveTo(cbX + 2, cbY + 6).lineTo(cbX + 5, cbY + 10)
              .lineTo(cbX + 10, cbY + 2).stroke();
          }
          x += colWidths[4];
          // 備考
          doc.text(worker.remarks || "", x + 3, y + 6, { width: colWidths[5] - 6 });
        } else {
          // 空行のチェックボックスのみ描画
          x = LEFT + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3];
          const cbX = x + (colWidths[4] / 2) - 6;
          const cbY = y + 5;
          doc.rect(cbX, cbY, 12, 12).stroke();
        }
      }

      // === 連絡事項 ===
      const notesTop = tableTop + rowHeight * (totalRows + 1) + 15;
      const notesHeight = 100;
      doc.rect(LEFT, notesTop, WIDTH, notesHeight).stroke();
      doc.fontSize(9).text("連絡事項", LEFT + 5, notesTop + 5);
      if (report.notes) {
        doc.fontSize(9).text(report.notes, LEFT + 10, notesTop + 22, {
          width: WIDTH - 20,
          height: notesHeight - 30,
        });
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 日本語日付フォーマット
 */
function formatDateJapanese(date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  const day = days[date.getDay()];
  return `${y}年${m}月${d}日(${day})`;
}

function formatDateTimeJapanese(date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}年${m}月${d}日 ${h}:${min}`;
}

function formatDateForFilename(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * 単一日報のPDF生成とQRコード生成
 * PDF・QRコードをStorageにアップロードし、URLをFirestoreに保存
 */
exports.generateReportPdfWithQR = onCall(
  { region: "asia-northeast1", maxInstances: 10, memory: "512MiB", timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { companyId, reportId } = request.data;
    if (!companyId || !reportId) {
      throw new HttpsError("invalid-argument", "companyIdとreportIdは必須です");
    }

    try {
      // 日報データを取得
      const reportRef = db.collection("companies").doc(companyId).collection("dailyReports").doc(reportId);
      const reportSnap = await reportRef.get();

      if (!reportSnap.exists) {
        throw new HttpsError("not-found", "日報が見つかりません");
      }

      const report = { id: reportSnap.id, ...reportSnap.data() };

      // 会社情報を取得
      const companyDoc = await db.collection("companies").doc(companyId).get();
      const companyData = companyDoc.exists ? companyDoc.data() : {};

      // フォントパス
      const fontPath = path.join(__dirname, "fonts", "NotoSansJP-Regular.otf");

      // 署名画像をダウンロード
      const signatureImageBuffer = await downloadSignatureImage(report.clientSignature?.imageUrl);

      // ロゴ画像をダウンロード
      const logoImageBuffer = await downloadSignatureImage(companyData.logoImage);

      // 現場データから元請会社名と昼休憩設定を取得
      let clientName = null;
      let siteLunchBreakSettings = null;
      if (report.siteId) {
        const siteDoc = await db.collection("companies").doc(companyId).collection("sites").doc(report.siteId).get();
        if (siteDoc.exists) {
          const siteData = siteDoc.data();
          clientName = siteData.clientName || null;
          siteLunchBreakSettings = siteData.lunchBreakSettings || null;
        }
      }

      // PDF生成
      const pdfBuffer = await generateReportPdf(report, companyData, fontPath, signatureImageBuffer, logoImageBuffer, clientName, siteLunchBreakSettings);

      // 日付文字列を生成
      const reportDate = report.reportDate?.toDate ? report.reportDate.toDate() : new Date(report.reportDate);
      const dateStr = formatDateForFilename(reportDate);
      const siteName = (report.siteName || "不明").replace(/[/\\?%*:|"<>]/g, "_");

      // PDFをStorageにアップロード（ダウンロードトークン付き）
      const pdfPath = `companies/${companyId}/reports/${reportId}/report_${dateStr}.pdf`;
      const pdfFile = bucket.file(pdfPath);
      const pdfToken = require("crypto").randomUUID();
      await pdfFile.save(pdfBuffer, {
        contentType: "application/pdf",
        metadata: {
          cacheControl: "public, max-age=31536000",
          metadata: {
            firebaseStorageDownloadTokens: pdfToken,
          },
        },
      });

      // Firebase Storage形式のダウンロードURL
      const pdfUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(pdfPath)}?alt=media&token=${pdfToken}`;

      // QRコード生成（PDFのURLを含む）
      const qrDataUrl = await QRCode.toDataURL(pdfUrl, {
        width: 256,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      });

      // QRコードをStorageにアップロード（ダウンロードトークン付き）
      const qrBuffer = Buffer.from(qrDataUrl.split(",")[1], "base64");
      const qrPath = `companies/${companyId}/reports/${reportId}/qrcode.png`;
      const qrFile = bucket.file(qrPath);
      const qrToken = require("crypto").randomUUID();
      await qrFile.save(qrBuffer, {
        contentType: "image/png",
        metadata: {
          cacheControl: "public, max-age=31536000",
          metadata: {
            firebaseStorageDownloadTokens: qrToken,
          },
        },
      });

      // Firebase Storage形式のダウンロードURL
      const qrUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(qrPath)}?alt=media&token=${qrToken}`;

      // Firestoreに保存
      await reportRef.update({
        pdfUrl: pdfUrl,
        qrCodeUrl: qrUrl,
        pdfGeneratedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        pdfUrl,
        qrCodeUrl: qrUrl,
      };
    } catch (error) {
      console.error("PDF/QRコード生成エラー:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "PDF/QRコード生成に失敗しました: " + error.message);
    }
  }
);

/**
 * 承認設定を解決（現場設定 > 企業設定のフォールバック）
 */
async function resolveApprovalSettings(companyId, siteId) {
  // 企業設定を取得
  const companyDoc = await db.collection("companies").doc(companyId).get();
  const companyData = companyDoc.data();
  const companySettings = companyData?.approvalSettings || { mode: "manual", autoApprovalEmails: [] };

  if (!siteId) {
    return { mode: companySettings.mode, emails: companySettings.autoApprovalEmails || [] };
  }

  // 現場設定を取得
  const siteDoc = await db.collection("companies").doc(companyId)
    .collection("sites").doc(siteId).get();
  const siteSettings = siteDoc.data()?.approvalSettings;

  if (!siteSettings || siteSettings.mode === "default") {
    return { mode: companySettings.mode, emails: companySettings.autoApprovalEmails || [] };
  }

  // 現場設定がautoで、メールが空なら企業設定のメールを使用
  const emails = (siteSettings.autoApprovalEmails?.length > 0)
    ? siteSettings.autoApprovalEmails
    : companySettings.autoApprovalEmails || [];

  return { mode: siteSettings.mode, emails };
}

/**
 * 自動承認用PDF生成（テンプレート形式・署名画像付き）
 */
function generateReportPdfForEmail(reportData, companyData, signatureImageBuffer, logoImageBuffer, clientName, siteLunchBreakSettings) {
  return new Promise((resolve, reject) => {
    try {
      const fontPath = path.join(__dirname, "fonts", "NotoSansJP-Regular.otf");
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const buffers = [];

      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", reject);

      doc.registerFont("NotoSans", fontPath);
      doc.font("NotoSans");

      const LEFT = 50;
      const RIGHT = 545;
      const WIDTH = RIGHT - LEFT;

      // 日付フォーマット
      const reportDate = reportData.reportDate?.toDate
        ? reportData.reportDate.toDate()
        : new Date(reportData.reportDate);
      const dateStr = `${reportDate.getMonth() + 1}月${reportDate.getDate()}日`;

      const submittedAt = reportData.submittedAt?.toDate
        ? reportData.submittedAt.toDate()
        : reportData.submittedAt ? new Date(reportData.submittedAt) : new Date();
      const reportDateStr = `${submittedAt.getMonth() + 1}月${submittedAt.getDate()}日`;

      // === ロゴ・会社名・報告日（上段） ===
      let currentY = 50;
      const logoHeight = 40;

      // ロゴ画像（左側）
      if (logoImageBuffer) {
        try {
          doc.image(logoImageBuffer, LEFT, currentY, {
            fit: [logoHeight, logoHeight],
          });
        } catch (e) {
          console.error("ロゴ画像埋め込みエラー:", e);
        }
      }

      // 会社名（ロゴの右隣）
      const companyNameX = logoImageBuffer ? LEFT + logoHeight + 10 : LEFT;
      doc.fontSize(14).fillColor("#000000");
      doc.text(companyData.companyName || "", companyNameX, currentY + 12, {
        width: 300,
      });

      // 報告日（右側）
      doc.fontSize(10).fillColor("#000000");
      doc.text(`報告日：${reportDateStr}`, RIGHT - 100, currentY + 15, {
        width: 100,
        align: "right",
      });

      currentY += logoHeight + 15;
      doc.y = currentY;

      // === ヘッダー2行構成 ===
      const headerTop = currentY;
      const row1H = 55;
      const row2H = 22;
      const labelW = 70;
      const signW = 200;
      const infoLabelW = 50;
      const col1 = LEFT;
      const col2 = LEFT + labelW;
      const col3 = col2 + signW;
      const col4 = col3 + infoLabelW;

      // 上段
      doc.rect(col1, headerTop, WIDTH, row1H).stroke();
      doc.moveTo(col2, headerTop).lineTo(col2, headerTop + row1H).stroke();
      doc.moveTo(col3, headerTop).lineTo(col3, headerTop + row1H).stroke();
      doc.moveTo(col4, headerTop).lineTo(col4, headerTop + row1H).stroke();

      doc.fontSize(9);
      doc.text("元請確認欄", col1 + 4, headerTop + (row1H / 2) - 5);
      doc.text("実施日", col3 + 4, headerTop + (row1H / 2) - 5);
      doc.text(dateStr, col4 + 4, headerTop + (row1H / 2) - 5);

      // サイン画像
      if (signatureImageBuffer) {
        try {
          const sigPad = 4;
          doc.image(signatureImageBuffer, col2 + sigPad, headerTop + sigPad, {
            fit: [signW - sigPad * 2, row1H - sigPad * 2],
          });
        } catch (e) {
          console.error("サイン画像埋め込みエラー:", e);
        }
      }

      // 下段
      const row2Top = headerTop + row1H;
      doc.rect(col1, row2Top, WIDTH, row2H).stroke();
      doc.moveTo(col3, row2Top).lineTo(col3, row2Top + row2H).stroke();
      doc.moveTo(col4, row2Top).lineTo(col4, row2Top + row2H).stroke();

      doc.text("作業日報", col1 + 4, row2Top + 6);
      doc.text("作成者", col3 + 4, row2Top + 6);
      doc.text(reportData.createdByName || "", col4 + 4, row2Top + 6);

      // === 元請会社名・現場名 ===
      let infoTop = row2Top + row2H + 10;
      doc.fontSize(11);

      // 元請会社名
      if (clientName) {
        doc.text("元請会社名", LEFT, infoTop, { continued: true });
        doc.text(`  ${clientName}`);
        infoTop = doc.y + 5;
      }

      // 現場名
      doc.text("現場名", LEFT, infoTop, { continued: true });
      doc.text(`     ${reportData.siteName || ""}`);
      doc.moveDown(0.5);

      // === 作業員テーブル ===
      const tableTop = doc.y;
      const colWidths = [90, 55, 55, 50, 55, 190];
      const headers = ["氏名", "開始時間", "終了時間", "実働時間", "昼休憩なし", "備考及び作業内容"];
      const rowHeight = 22;
      const totalRows = 9;
      const workers = reportData.workers || [];

      // 昼休憩設定を取得（現場設定を優先、なければ会社設定）
      const lunchSettings = siteLunchBreakSettings || companyData?.attendanceSettings || {};
      const deductLunchBreak = lunchSettings.deductLunchBreak !== false; // デフォルトtrue
      const lunchBreakMinutes = lunchSettings.lunchBreakMinutes || 60;

      // 実働時間を計算するヘルパー関数
      const calcWorkingHours = (startTime, endTime, noLunchBreak) => {
        if (!startTime || !endTime) return "";
        const [startH, startM] = startTime.split(":").map(Number);
        const [endH, endM] = endTime.split(":").map(Number);
        if (isNaN(startH) || isNaN(endH)) return "";
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;
        let diff = endMinutes - startMinutes;
        if (diff < 0) return "";
        // 昼休憩控除: deductLunchBreakがtrueかつnoLunchBreakがfalseの場合のみ控除
        if (deductLunchBreak && !noLunchBreak) {
          diff -= lunchBreakMinutes;
          if (diff < 0) diff = 0;
        }
        const hours = Math.floor(diff / 60);
        const minutes = diff % 60;
        return minutes > 0 ? `${hours}:${String(minutes).padStart(2, "0")}` : `${hours}:00`;
      };

      // テーブルヘッダー
      doc.rect(LEFT, tableTop, WIDTH, rowHeight).stroke();
      doc.fontSize(9).fillColor("#000000");
      let x = LEFT;
      headers.forEach((header, i) => {
        doc.text(header, x + 3, tableTop + 6, { width: colWidths[i] - 6 });
        if (i < headers.length - 1) {
          doc.moveTo(x + colWidths[i], tableTop)
            .lineTo(x + colWidths[i], tableTop + rowHeight).stroke();
        }
        x += colWidths[i];
      });

      // テーブル行
      for (let row = 0; row < totalRows; row++) {
        const y = tableTop + rowHeight * (row + 1);
        doc.rect(LEFT, y, WIDTH, rowHeight).stroke();

        x = LEFT;
        const worker = workers[row];

        for (let i = 0; i < colWidths.length - 1; i++) {
          x += colWidths[i];
          doc.moveTo(x, y).lineTo(x, y + rowHeight).stroke();
        }

        if (worker) {
          x = LEFT;
          doc.text(worker.name || "", x + 3, y + 6, { width: colWidths[0] - 6 });
          x += colWidths[0];
          doc.text(worker.startTime || "", x + 3, y + 6, { width: colWidths[1] - 6 });
          x += colWidths[1];
          doc.text(worker.endTime || "", x + 3, y + 6, { width: colWidths[2] - 6 });
          x += colWidths[2];
          // 実働時間（昼休憩控除を考慮）
          const workingHours = calcWorkingHours(worker.startTime, worker.endTime, worker.noLunchBreak);
          doc.text(workingHours, x + 3, y + 6, { width: colWidths[3] - 6 });
          x += colWidths[3];
          // 昼休憩なしチェックボックス
          const cbX = x + (colWidths[4] / 2) - 6;
          const cbY = y + 5;
          doc.rect(cbX, cbY, 12, 12).stroke();
          if (worker.noLunchBreak) {
            doc.moveTo(cbX + 2, cbY + 6).lineTo(cbX + 5, cbY + 10)
              .lineTo(cbX + 10, cbY + 2).stroke();
          }
          x += colWidths[4];
          doc.text(worker.remarks || "", x + 3, y + 6, { width: colWidths[5] - 6 });
        } else {
          x = LEFT + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3];
          const cbX = x + (colWidths[4] / 2) - 6;
          const cbY = y + 5;
          doc.rect(cbX, cbY, 12, 12).stroke();
        }
      }

      // === 連絡事項 ===
      const notesTop = tableTop + rowHeight * (totalRows + 1) + 15;
      const notesHeight = 100;
      doc.rect(LEFT, notesTop, WIDTH, notesHeight).stroke();
      doc.fontSize(9).text("連絡事項", LEFT + 5, notesTop + 5);
      if (reportData.notes) {
        doc.fontSize(9).text(reportData.notes, LEFT + 10, notesTop + 22, {
          width: WIDTH - 20,
          height: notesHeight - 30,
        });
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 日報自動承認処理（ステータスがsubmittedに変更された時）
 */
const sendgridApiKey = defineSecret("SENDGRID_API_KEY");

exports.onAutoApproveReport = onDocumentUpdated(
  {
    document: "companies/{companyId}/dailyReports/{reportId}",
    region: "asia-northeast1",
    secrets: [sendgridApiKey],
  },
  async (event) => {
    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    // ステータスが変更されていない場合はスキップ
    if (beforeData.status === afterData.status) {
      return;
    }

    const companyId = event.params.companyId;
    const reportId = event.params.reportId;

    // === Case 1: submitted → 自動承認モードならapprovedに変更 ===
    if (afterData.status === "submitted") {
      try {
        const approvalConfig = await resolveApprovalSettings(companyId, afterData.siteId);

        if (approvalConfig.mode !== "auto") {
          console.log(`手動承認モード: ${companyId}/${reportId}`);
          return;
        }

        console.log(`自動承認開始: ${companyId}/${reportId}`);

        const reportRef = db.collection("companies").doc(companyId)
          .collection("dailyReports").doc(reportId);
        await reportRef.update({
          status: "approved",
          "approval.approvedBy": "system",
          "approval.approvedByName": "自動承認",
          "approval.approvedAt": Timestamp.now(),
          updatedAt: Timestamp.now(),
        });

        console.log(`自動承認完了: ${companyId}/${reportId}`);
        // メール送信はCase 2（approved検知時）で行う
      } catch (error) {
        console.error("自動承認エラー:", error);
      }
      return;
    }

    // === Case 2: approved → PDF/QR生成 + Storage保存 + メール送信（自動・手動共通） ===
    if (afterData.status === "approved") {
      try {
        console.log(`承認処理開始: ${companyId}/${reportId}`);

        // 会社情報を取得
        const companyDoc = await db.collection("companies").doc(companyId).get();
        const companyData = companyDoc.data();

        // サイン画像・ロゴ画像ダウンロード
        const signatureImageBuffer = await downloadSignatureImage(afterData.clientSignature?.imageUrl);
        const logoImageBuffer = await downloadSignatureImage(companyData.logoImage);

        // 現場データから元請会社名と昼休憩設定を取得
        let clientName = null;
        let siteLunchBreakSettings = null;
        if (afterData.siteId) {
          const siteDoc = await db.collection("companies").doc(companyId).collection("sites").doc(afterData.siteId).get();
          if (siteDoc.exists) {
            const siteData = siteDoc.data();
            clientName = siteData.clientName || null;
            siteLunchBreakSettings = siteData.lunchBreakSettings || null;
          }
        }

        // PDF生成
        const pdfBuffer = await generateReportPdfForEmail(afterData, companyData, signatureImageBuffer, logoImageBuffer, clientName, siteLunchBreakSettings);

        // 日付文字列を生成
        const reportDate = afterData.reportDate?.toDate
          ? afterData.reportDate.toDate()
          : new Date(afterData.reportDate);
        const dateStr = `${reportDate.getFullYear()}年${reportDate.getMonth() + 1}月${reportDate.getDate()}日`;
        const dateStrForFile = `${reportDate.getFullYear()}${String(reportDate.getMonth() + 1).padStart(2, "0")}${String(reportDate.getDate()).padStart(2, "0")}`;

        // PDFをStorageにアップロード（ダウンロードトークン付き）
        const crypto = require("crypto");
        const pdfPath = `companies/${companyId}/reports/${reportId}/report_${dateStrForFile}.pdf`;
        const pdfFile = bucket.file(pdfPath);
        const pdfToken = crypto.randomUUID();
        await pdfFile.save(pdfBuffer, {
          contentType: "application/pdf",
          metadata: {
            cacheControl: "public, max-age=31536000",
            metadata: {
              firebaseStorageDownloadTokens: pdfToken,
            },
          },
        });

        // Firebase Storage形式のダウンロードURL
        const pdfUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(pdfPath)}?alt=media&token=${pdfToken}`;
        console.log(`PDF保存完了: ${pdfUrl}`);

        // QRコード生成（PDFのURLを含む）
        const qrDataUrl = await QRCode.toDataURL(pdfUrl, {
          width: 256,
          margin: 2,
          color: {
            dark: "#000000",
            light: "#ffffff",
          },
        });

        // QRコードをStorageにアップロード（ダウンロードトークン付き）
        const qrBuffer = Buffer.from(qrDataUrl.split(",")[1], "base64");
        const qrPath = `companies/${companyId}/reports/${reportId}/qrcode.png`;
        const qrFile = bucket.file(qrPath);
        const qrToken = crypto.randomUUID();
        await qrFile.save(qrBuffer, {
          contentType: "image/png",
          metadata: {
            cacheControl: "public, max-age=31536000",
            metadata: {
              firebaseStorageDownloadTokens: qrToken,
            },
          },
        });

        // Firebase Storage形式のダウンロードURL
        const qrUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(qrPath)}?alt=media&token=${qrToken}`;
        console.log(`QRコード保存完了: ${qrUrl}`);

        // Firestoreに保存
        const reportRef = db.collection("companies").doc(companyId)
          .collection("dailyReports").doc(reportId);
        await reportRef.update({
          pdfUrl: pdfUrl,
          qrCodeUrl: qrUrl,
          pdfGeneratedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        console.log(`Firestore更新完了: pdfUrl, qrCodeUrl`);

        // 承認設定からメール送信先を取得
        const approvalConfig = await resolveApprovalSettings(companyId, afterData.siteId);
        const emails = approvalConfig.emails.filter(e => e && e.trim());

        if (emails.length === 0) {
          console.log(`メール送信先なし（PDF/QR生成は完了）: ${companyId}/${reportId}`);
          return;
        }

        // SendGrid APIでメール送信
        const isAutoApproved = afterData.approval?.approvedBy === "system";
        const approvalType = isAutoApproved ? "自動承認" : "承認";

        sgMail.setApiKey(sendgridApiKey.value());
        await sgMail.send({
          to: emails,
          from: "labor-management-info@improve-biz.com",
          subject: `【日報】${afterData.siteName || ""} - ${dateStr}`,
          text: `${companyData?.companyName || ""}の日報が${approvalType}されました。\n\n現場: ${afterData.siteName || ""}\n実施日: ${dateStr}\n作成者: ${afterData.createdByName || ""}\n\nPDFを添付しています。`,
          attachments: [{
            filename: `日報_${afterData.siteName || ""}_${dateStr}.pdf`,
            content: pdfBuffer.toString("base64"),
            type: "application/pdf",
            disposition: "attachment",
          }],
        });

        console.log(`承認メール送信完了: ${emails.join(", ")} (${approvalType})`);
      } catch (error) {
        console.error("承認処理エラー:", error);
      }
    }
  }
);

/**
 * ユーザー作成（Admin SDK使用）
 * 事務員以上が呼び出し可能
 * - 管理者: 全ロール作成可能
 * - 事務員: admin以外のロール作成可能
 */
exports.createUser = onCall(
  { region: "asia-northeast1", maxInstances: 10 },
  async (request) => {
    console.log("createUser called with data:", JSON.stringify(request.data));

    if (!request.auth) {
      console.log("No auth provided");
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    console.log("Auth UID:", request.auth.uid);

    const { companyId, email, password, displayName, role, employeeId } = request.data;

    // バリデーション
    if (!companyId) {
      throw new HttpsError("invalid-argument", "companyIdは必須です");
    }
    if (!email || !email.trim()) {
      throw new HttpsError("invalid-argument", "メールアドレスは必須です");
    }
    if (!password || password.length < 6) {
      throw new HttpsError("invalid-argument", "パスワードは6文字以上で入力してください");
    }
    if (!displayName || !displayName.trim()) {
      throw new HttpsError("invalid-argument", "表示名は必須です");
    }
    if (!role) {
      throw new HttpsError("invalid-argument", "権限は必須です");
    }

    try {
      // 呼び出し元ユーザーの権限をチェック
      const callerDoc = await db
        .collection("companies")
        .doc(companyId)
        .collection("users")
        .doc(request.auth.uid)
        .get();

      if (!callerDoc.exists) {
        throw new HttpsError("permission-denied", "ユーザー情報が見つかりません");
      }

      const callerRole = callerDoc.data().role;
      const isCallerAdmin = callerRole === "admin";
      const isCallerOffice = ["admin", "office", "manager"].includes(callerRole);

      if (!isCallerOffice) {
        throw new HttpsError("permission-denied", "ユーザー作成権限がありません");
      }

      // 事務員がadminを作成しようとした場合はエラー
      if (!isCallerAdmin && role === "admin") {
        throw new HttpsError("permission-denied", "管理者権限のユーザーを作成する権限がありません");
      }

      // Firebase Authにユーザー作成
      console.log("Creating Firebase Auth user:", email.trim());
      const userRecord = await auth.createUser({
        email: email.trim(),
        password: password,
        displayName: displayName.trim(),
      });
      console.log("Firebase Auth user created:", userRecord.uid);

      // Firestoreにユーザードキュメント作成
      const userRef = db
        .collection("companies")
        .doc(companyId)
        .collection("users")
        .doc(userRecord.uid);

      console.log("Creating Firestore user document at:", userRef.path);
      await userRef.set({
        email: email.trim(),
        displayName: displayName.trim(),
        role: role,
        employeeId: employeeId || null,
        isActive: true,
        lastLoginAt: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      console.log("Firestore user document created successfully");

      return {
        success: true,
        userId: userRecord.uid,
      };
    } catch (error) {
      console.error("ユーザー作成エラー:", error);
      console.error("エラーコード:", error.code);
      console.error("エラーメッセージ:", error.message);
      console.error("エラースタック:", error.stack);

      if (error.code === "auth/email-already-exists") {
        throw new HttpsError("already-exists", "このメールアドレスは既に登録されています");
      }
      if (error.code === "auth/invalid-email") {
        throw new HttpsError("invalid-argument", "メールアドレスの形式が正しくありません");
      }
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError("internal", "ユーザー作成に失敗しました: " + error.message);
    }
  }
);

/**
 * ユーザー削除（Admin SDK使用）
 * 管理者のみが呼び出し可能
 */
exports.deleteUser = onCall(
  { region: "asia-northeast1", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { targetUserId, companyId } = request.data;

    if (!targetUserId || !companyId) {
      throw new HttpsError("invalid-argument", "targetUserIdとcompanyIdは必須です");
    }

    // 自分自身は削除できない
    if (targetUserId === request.auth.uid) {
      throw new HttpsError("invalid-argument", "自分自身を削除することはできません");
    }

    try {
      // 呼び出し元ユーザーの権限をチェック
      const callerDoc = await db
        .collection("companies")
        .doc(companyId)
        .collection("users")
        .doc(request.auth.uid)
        .get();

      const callerRole = callerDoc.exists ? callerDoc.data().role : null;
      const isOfficeOrAbove = ["admin", "office", "manager"].includes(callerRole);
      if (!isOfficeOrAbove) {
        throw new HttpsError("permission-denied", "事務員以上の権限が必要です");
      }

      // 対象ユーザーのドキュメントを削除
      const targetUserRef = db
        .collection("companies")
        .doc(companyId)
        .collection("users")
        .doc(targetUserId);

      const targetUserDoc = await targetUserRef.get();
      if (!targetUserDoc.exists) {
        throw new HttpsError("not-found", "ユーザーが見つかりません");
      }

      // Firestoreからユーザードキュメント削除
      await targetUserRef.delete();

      // Firebase Authからユーザー削除
      await auth.deleteUser(targetUserId);

      return { success: true };
    } catch (error) {
      console.error("ユーザー削除エラー:", error);

      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError("internal", "ユーザー削除に失敗しました");
    }
  }
);

// ==================== 日報アプリ用関数（daily-report-appから統合） ====================

/**
 * 企業作成時に自動で連番の企業IDを付与
 */
exports.assignCompanyCode = onDocumentCreated(
  {
    document: "companies/{companyId}",
    region: "asia-northeast1",
  },
  async (event) => {
    const companyId = event.params.companyId;
    const companyData = event.data.data();

    // 既にcompanyCodeが設定されている場合はスキップ
    if (companyData.companyCode) {
      console.log(`企業 ${companyId} は既にcompanyCodeを持っています: ${companyData.companyCode}`);
      return;
    }

    try {
      // カウンターを取得・更新（トランザクションで排他制御）
      const counterRef = db.collection("settings").doc("companyCodeCounter");

      const newCompanyCode = await db.runTransaction(async (transaction) => {
        const counterDoc = await transaction.get(counterRef);

        let nextCode = 0;
        if (counterDoc.exists) {
          nextCode = counterDoc.data().lastCode + 1;
        }

        // カウンターを更新
        transaction.set(counterRef, { lastCode: nextCode }, { merge: true });

        // 8桁のゼロ埋め文字列に変換
        return String(nextCode).padStart(8, "0");
      });

      // 企業ドキュメントにcompanyCodeを設定
      await db.collection("companies").doc(companyId).update({
        companyCode: newCompanyCode,
      });

      console.log(`企業 ${companyId} に企業ID ${newCompanyCode} を割り当てました`);
    } catch (error) {
      console.error("企業ID割り当てエラー:", error);
    }
  }
);

/**
 * 時刻が現在時刻の±7分以内かチェック
 */
function isWithinTimeWindow(targetTime, currentTime, windowMinutes = 7) {
  const [targetHour, targetMin] = targetTime.split(":").map(Number);
  const [currentHour, currentMin] = currentTime.split(":").map(Number);

  const targetMinutes = targetHour * 60 + targetMin;
  const currentMinutes = currentHour * 60 + currentMin;

  // 通常の差分
  let diff = Math.abs(targetMinutes - currentMinutes);

  // 日付またぎを考慮（例: 23:55 と 00:02 の差は 7分）
  const dayMinutes = 24 * 60;
  const wrapAroundDiff = dayMinutes - diff;

  // 通常の差分と日付またぎの差分の小さい方を使用
  const actualDiff = Math.min(diff, wrapAroundDiff);

  return actualDiff <= windowMinutes;
}

/**
 * 現在時刻をHH:MM形式で取得（JST）
 */
function getCurrentTimeJST() {
  const now = new Date();
  const jstOffset = 9 * 60;
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const jst = new Date(utc + jstOffset * 60000);
  return `${String(jst.getHours()).padStart(2, "0")}:${String(jst.getMinutes()).padStart(2, "0")}`;
}

/**
 * 今日の日付をJSTで取得
 */
function getTodayJST() {
  const now = new Date();
  const jstOffset = 9 * 60;
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const jst = new Date(utc + jstOffset * 60000);
  jst.setHours(0, 0, 0, 0);
  return jst;
}

/**
 * 日報未提出リマインダー（1分ごとに実行）
 */
exports.scheduledNotifications = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "Asia/Tokyo",
    region: "asia-northeast1",
  },
  async (event) => {
    const currentTime = getCurrentTimeJST();
    const today = getTodayJST();
    const todayStart = Timestamp.fromDate(today);
    const todayEnd = Timestamp.fromDate(new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1));

    console.log(`リマインダーチェック開始: ${currentTime}`);

    try {
      // 全企業を取得
      const companiesSnapshot = await db.collection("companies").get();

      for (const companyDoc of companiesSnapshot.docs) {
        const companyId = companyDoc.id;
        const companyData = companyDoc.data();
        const companyNotificationSettings = companyData.notificationSettings;

        // 企業の通知設定が無効な場合はスキップ
        if (!companyNotificationSettings?.enabled) continue;

        // 現在時刻が通知時刻に該当するかチェック（完全一致）
        const reminderTimes = companyNotificationSettings.reminderTimes || [];
        const shouldNotify = reminderTimes.includes(currentTime);

        if (!shouldNotify) continue;

        console.log(`企業 ${companyId}: リマインダー時刻一致 (${currentTime})`);

        // この企業のユーザーを取得
        const usersSnapshot = await db
          .collection("companies")
          .doc(companyId)
          .collection("users")
          .where("isActive", "==", true)
          .get();

        for (const userDoc of usersSnapshot.docs) {
          const userData = userDoc.data();
          const userId = userDoc.id;
          const fcmToken = userData.fcmToken;

          if (!fcmToken) continue;

          // ユーザーの通知設定をチェック（設定がない場合はデフォルトで受信）
          if (userData.notifications?.dailyReminder === false) continue;

          // このユーザーの今日の日報をチェック（サブコレクション）
          const reportsSnapshot = await db
            .collection("companies")
            .doc(companyId)
            .collection("dailyReports")
            .where("createdBy", "==", userId)
            .where("reportDate", ">=", todayStart)
            .where("reportDate", "<=", todayEnd)
            .get();

          // 日報が未提出（存在しない、draft、signed）の場合に通知
          let needsReminder = true;

          if (!reportsSnapshot.empty) {
            const report = reportsSnapshot.docs[0].data();
            if (report.status === "submitted" || report.status === "approved") {
              needsReminder = false;
            }
          }

          if (needsReminder) {
            try {
              await messaging.send({
                token: fcmToken,
                notification: {
                  title: "作業日報アプリ -CDS-",
                  body: "本日の作業日報がまだ送信されていません",
                },
                data: {
                  type: "reminder",
                  url: "/reports/new",
                },
                android: {
                  priority: "high",
                },
                apns: {
                  payload: {
                    aps: {
                      sound: "default",
                    },
                  },
                },
              });
              console.log(`リマインダー送信成功: ${userId}`);
            } catch (sendError) {
              console.error(`リマインダー送信失敗: ${userId}`, sendError);
            }
          }
        }
      }

      console.log("リマインダーチェック完了");
    } catch (error) {
      console.error("リマインダー処理エラー:", error);
    }
  }
);

/**
 * 日報差戻し通知（ステータスがrejectedに変更された時）
 */
exports.onReportRejected = onDocumentUpdated(
  {
    document: "companies/{companyId}/dailyReports/{reportId}",
    region: "asia-northeast1",
  },
  async (event) => {
    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    // ステータスがrejectedに変更された場合のみ処理
    if (beforeData.status === afterData.status || afterData.status !== "rejected") {
      return;
    }

    const reportId = event.params.reportId;
    const companyId = event.params.companyId;
    const createdBy = afterData.createdBy;

    try {
      // 作成者のFCMトークンを取得
      const userDoc = await db
        .collection("companies")
        .doc(companyId)
        .collection("users")
        .doc(createdBy)
        .get();

      if (!userDoc.exists) {
        console.log("ユーザーが見つかりません:", createdBy);
        return;
      }

      const userData = userDoc.data();
      const fcmToken = userData.fcmToken;

      if (!fcmToken) {
        console.log("FCMトークンがありません:", createdBy);
        return;
      }

      // 通知を送信
      await messaging.send({
        token: fcmToken,
        notification: {
          title: "日報が差戻しされました",
          body: `${afterData.siteName}の日報に修正が必要です。`,
        },
        data: {
          type: "rejected",
          reportId: reportId,
          url: `/reports/${reportId}/edit`,
        },
        android: {
          priority: "high",
        },
        apns: {
          payload: {
            aps: {
              sound: "default",
            },
          },
        },
      });

      console.log(`差戻し通知送信成功: ${createdBy}, レポート: ${reportId}`);
    } catch (error) {
      console.error("差戻し通知送信エラー:", error);
    }
  }
);

/**
 * カスタム通知（1分ごとに実行）
 */
exports.customNotifications = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "Asia/Tokyo",
    region: "asia-northeast1",
  },
  async (event) => {
    const currentTime = getCurrentTimeJST();
    const now = new Date();
    const jstOffset = 9 * 60;
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const jst = new Date(utc + jstOffset * 60000);
    const currentDayOfWeek = jst.getDay(); // 0=日, 1=月, ..., 6=土

    console.log(`カスタム通知チェック開始: ${currentTime}, 曜日: ${currentDayOfWeek}`);

    try {
      // 有効なカスタム通知を取得
      const notificationsSnapshot = await db
        .collection("customNotifications")
        .where("enabled", "==", true)
        .get();

      console.log(`有効な通知設定: ${notificationsSnapshot.size}件`);

      for (const notificationDoc of notificationsSnapshot.docs) {
        const notification = notificationDoc.data();
        const notificationId = notificationDoc.id;

        // companyIdバリデーション
        if (!notification.companyId) {
          console.warn(`通知 ${notificationId}: companyIdが未設定のためスキップ`);
          continue;
        }

        // 時刻チェック（完全一致）
        if (notification.time !== currentTime) {
          continue;
        }

        console.log(`通知 ${notificationId}: 時刻一致 (${currentTime}), repeat=${notification.repeat}`);

        // repeatのバリデーションと曜日チェック
        const validRepeats = ["daily", "weekdays", "custom"];
        if (!validRepeats.includes(notification.repeat)) {
          console.warn(`通知 ${notificationId}: 不正なrepeat値 "${notification.repeat}" のためスキップ`);
          continue;
        }

        if (notification.repeat === "weekdays" && (currentDayOfWeek === 0 || currentDayOfWeek === 6)) {
          console.log(`通知 ${notificationId}: 平日のみ設定のため土日はスキップ`);
          continue;
        }
        if (notification.repeat === "custom") {
          if (!notification.customDays || !Array.isArray(notification.customDays) || notification.customDays.length === 0) {
            console.warn(`通知 ${notificationId}: customDaysが未設定のためスキップ`);
            continue;
          }
          if (!notification.customDays.includes(currentDayOfWeek)) {
            console.log(`通知 ${notificationId}: 今日は対象曜日ではないためスキップ`);
            continue;
          }
        }

        const companyId = notification.companyId;
        console.log(`通知 ${notificationId} (${notification.time}): 処理開始 - ${notification.message?.substring(0, 20)}...`);

        // 対象ユーザーを取得
        const usersSnapshot = await db
          .collection("companies")
          .doc(companyId)
          .collection("users")
          .where("isActive", "==", true)
          .get();

        // siteIdフィルタリング用のユーザーセット
        let targetUserIds = new Set(usersSnapshot.docs.map((doc) => doc.id));

        // siteIdが指定されている場合、その現場で作業したことがあるユーザーのみに絞り込む
        if (notification.siteId) {
          const thirtyDaysAgo = new Date(jst.getTime() - 30 * 24 * 60 * 60 * 1000);
          const reportsSnapshot = await db
            .collection("companies")
            .doc(companyId)
            .collection("dailyReports")
            .where("siteId", "==", notification.siteId)
            .where("reportDate", ">=", Timestamp.fromDate(thirtyDaysAgo))
            .get();

          const siteUserIds = new Set(reportsSnapshot.docs.map((doc) => doc.data().createdBy));
          targetUserIds = new Set([...targetUserIds].filter((id) => siteUserIds.has(id)));
          console.log(`通知 ${notificationId}: 現場 ${notification.siteName || notification.siteId} の対象ユーザー: ${targetUserIds.size}人`);
        }

        let successCount = 0;
        let failCount = 0;
        let skipCount = 0;

        for (const userDoc of usersSnapshot.docs) {
          const userData = userDoc.data();
          const userId = userDoc.id;
          const fcmToken = userData.fcmToken;
          const displayName = userData.displayName || "不明";

          // siteIdフィルタリング
          if (!targetUserIds.has(userId)) {
            console.log(`  スキップ: ${displayName} (現場フィルタ外)`);
            skipCount++;
            continue;
          }

          if (!fcmToken) {
            console.log(`  スキップ: ${displayName} (FCMトークンなし)`);
            skipCount++;
            continue;
          }

          // ユーザーの通知設定をチェック（設定がない場合はデフォルトで受信）
          if (userData.notifications?.customNotification === false) {
            console.log(`  スキップ: ${displayName} (カスタム通知OFF)`);
            skipCount++;
            continue;
          }

          try {
            await messaging.send({
              token: fcmToken,
              notification: {
                title: "作業日報アプリ -CDS-",
                body: notification.message,
              },
              data: {
                type: "custom",
                notificationId: notificationId,
              },
              android: {
                priority: "high",
              },
              apns: {
                payload: {
                  aps: {
                    sound: "default",
                  },
                },
              },
            });
            console.log(`  送信成功: ${displayName} (トークン: ${fcmToken.substring(0, 20)}...)`);
            successCount++;
          } catch (sendError) {
            console.error(`  送信失敗: ${displayName}`, sendError.message);
            failCount++;
          }
        }

        console.log(`通知 ${notificationId}: 完了 - 成功: ${successCount}, 失敗: ${failCount}, スキップ: ${skipCount}`);
      }

      console.log("カスタム通知チェック完了");
    } catch (error) {
      console.error("カスタム通知処理エラー:", error);
    }
  }
);

/**
 * テスト通知を即座に送信（デバッグ用）
 */
exports.sendTestNotification = onCall(
  {
    region: "asia-northeast1",
  },
  async (request) => {
    const { companyId, userId, message } = request.data;

    if (!companyId) {
      throw new HttpsError("invalid-argument", "companyIdは必須です");
    }

    const results = [];
    const notificationMessage = message || "これはテスト通知です";

    try {
      let usersQuery = db
        .collection("companies")
        .doc(companyId)
        .collection("users")
        .where("isActive", "==", true);

      const usersSnapshot = await usersQuery.get();

      console.log(`テスト通知: ${usersSnapshot.size}人のユーザーを取得`);

      for (const userDoc of usersSnapshot.docs) {
        const userData = userDoc.data();
        const userIdCurrent = userDoc.id;

        // 特定のユーザーが指定されている場合はそのユーザーのみ
        if (userId && userIdCurrent !== userId) {
          continue;
        }

        const fcmToken = userData.fcmToken;
        const displayName = userData.displayName || "不明";

        if (!fcmToken) {
          results.push({
            userId: userIdCurrent,
            displayName,
            success: false,
            error: "FCMトークンが未設定",
          });
          console.log(`テスト通知: ${displayName} - FCMトークンなし`);
          continue;
        }

        try {
          await messaging.send({
            token: fcmToken,
            notification: {
              title: "作業日報アプリ -CDS- (テスト)",
              body: notificationMessage,
            },
            data: {
              type: "test",
            },
            android: {
              priority: "high",
            },
            apns: {
              payload: {
                aps: {
                  sound: "default",
                },
              },
            },
          });

          results.push({
            userId: userIdCurrent,
            displayName,
            success: true,
          });
          console.log(`テスト通知送信成功: ${displayName}`);
        } catch (sendError) {
          results.push({
            userId: userIdCurrent,
            displayName,
            success: false,
            error: sendError.message,
          });
          console.error(`テスト通知送信失敗: ${displayName}`, sendError.message);

          // 無効なトークンの場合はFirestoreから削除
          if (
            sendError.code === "messaging/invalid-registration-token" ||
            sendError.code === "messaging/registration-token-not-registered"
          ) {
            await db
              .collection("companies")
              .doc(companyId)
              .collection("users")
              .doc(userIdCurrent)
              .update({
                fcmToken: FieldValue.delete(),
                fcmTokenUpdatedAt: FieldValue.delete(),
              });
            console.log(`無効なFCMトークンを削除: ${displayName}`);
          }
        }
      }

      return { results };
    } catch (error) {
      console.error("テスト通知処理エラー:", error);
      throw new HttpsError("internal", error.message);
    }
  }
);

/**
 * カスタム通知の送信ログをクリア（管理者用）
 */
exports.clearNotificationLogs = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { companyId, notificationId, clearAll } = request.data;

    if (!companyId) {
      throw new HttpsError("invalid-argument", "companyIdは必須です");
    }

    // 管理者権限チェック
    const userDoc = await db
      .collection("companies")
      .doc(companyId)
      .collection("users")
      .doc(request.auth.uid)
      .get();

    if (!userDoc.exists || userDoc.data().role !== "admin") {
      throw new HttpsError("permission-denied", "管理者権限が必要です");
    }

    try {
      let deletedCount = 0;
      const logsRef = db.collection("customNotificationLogs");

      if (clearAll) {
        // 全ての送信ログを削除
        const allLogs = await logsRef.get();
        const batch = db.batch();
        allLogs.docs.forEach((doc) => {
          batch.delete(doc.ref);
          deletedCount++;
        });
        await batch.commit();
      } else if (notificationId) {
        // 特定の通知IDの送信ログを削除
        const logs = await logsRef
          .where("notificationId", "==", notificationId)
          .get();
        const batch = db.batch();
        logs.docs.forEach((doc) => {
          batch.delete(doc.ref);
          deletedCount++;
        });
        await batch.commit();
      } else {
        // 今日の送信ログのみ削除
        const now = new Date();
        const jstOffset = 9 * 60;
        const utc = now.getTime() + now.getTimezoneOffset() * 60000;
        const jst = new Date(utc + jstOffset * 60000);
        const todayDateStr = `${jst.getFullYear()}-${String(jst.getMonth() + 1).padStart(2, "0")}-${String(jst.getDate()).padStart(2, "0")}`;

        const allLogs = await logsRef.get();
        const batch = db.batch();
        allLogs.docs.forEach((doc) => {
          if (doc.id.endsWith(todayDateStr)) {
            batch.delete(doc.ref);
            deletedCount++;
          }
        });
        await batch.commit();
      }

      console.log(`送信ログをクリア: ${deletedCount}件削除`);
      return { success: true, deletedCount };
    } catch (error) {
      console.error("送信ログクリアエラー:", error);
      throw new HttpsError("internal", error.message);
    }
  }
);

/**
 * 日報手動承認（権限チェック付き）
 */
exports.approveReport = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { companyId, reportId } = request.data;
    if (!companyId || !reportId) {
      throw new HttpsError("invalid-argument", "companyIdとreportIdは必須です");
    }

    try {
      // 権限チェック
      const userDoc = await db
        .collection("companies")
        .doc(companyId)
        .collection("users")
        .doc(request.auth.uid)
        .get();

      if (!userDoc.exists) {
        throw new HttpsError("permission-denied", "ユーザーが見つかりません");
      }

      const userData = userDoc.data();
      if (!["admin", "office", "manager"].includes(userData.role)) {
        throw new HttpsError("permission-denied", "事務員以上の権限が必要です");
      }

      // 日報のステータス確認
      const reportRef = db
        .collection("companies")
        .doc(companyId)
        .collection("dailyReports")
        .doc(reportId);
      const reportSnap = await reportRef.get();

      if (!reportSnap.exists) {
        throw new HttpsError("not-found", "日報が見つかりません");
      }

      const reportData = reportSnap.data();
      if (reportData.status !== "submitted") {
        throw new HttpsError("failed-precondition", "送信完了の日報のみ承認できます");
      }

      // 承認を実行
      await reportRef.update({
        status: "approved",
        "approval.approvedBy": request.auth.uid,
        "approval.approvedByName": userData.displayName || userData.email || "",
        "approval.approvedAt": Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

      console.log(`日報承認成功: ${reportId} by ${userData.displayName || userData.email}`);

      return { success: true };
    } catch (error) {
      console.error("日報承認エラー:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "承認に失敗しました");
    }
  }
);

/**
 * 日報差戻し（権限チェック付き）
 */
exports.rejectReport = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { companyId, reportId, reason } = request.data;
    if (!companyId || !reportId) {
      throw new HttpsError("invalid-argument", "companyIdとreportIdは必須です");
    }

    try {
      // 権限チェック
      const userDoc = await db
        .collection("companies")
        .doc(companyId)
        .collection("users")
        .doc(request.auth.uid)
        .get();

      if (!userDoc.exists) {
        throw new HttpsError("permission-denied", "ユーザーが見つかりません");
      }

      const userData = userDoc.data();
      if (!["admin", "office", "manager"].includes(userData.role)) {
        throw new HttpsError("permission-denied", "事務員以上の権限が必要です");
      }

      // 日報のステータス確認
      const reportRef = db
        .collection("companies")
        .doc(companyId)
        .collection("dailyReports")
        .doc(reportId);
      const reportSnap = await reportRef.get();

      if (!reportSnap.exists) {
        throw new HttpsError("not-found", "日報が見つかりません");
      }

      const reportData = reportSnap.data();
      if (!["submitted", "approved"].includes(reportData.status)) {
        throw new HttpsError("failed-precondition", "送信完了または承認済みの日報のみ差戻しできます");
      }

      // 差戻しを実行（署名もクリア）
      await reportRef.update({
        status: "rejected",
        "rejection.rejectedBy": request.auth.uid,
        "rejection.rejectedByName": userData.displayName || userData.email || "",
        "rejection.rejectedAt": Timestamp.now(),
        "rejection.reason": reason || "",
        // 署名をクリア（再署名が必要）
        "clientSignature.imageUrl": null,
        "clientSignature.signedAt": null,
        "clientSignature.signerName": null,
        updatedAt: Timestamp.now(),
      });

      console.log(`日報差戻し成功: ${reportId} by ${userData.displayName || userData.email}`);

      return { success: true };
    } catch (error) {
      console.error("日報差戻しエラー:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "差戻しに失敗しました");
    }
  }
);

/**
 * 署名データ移行スクリプト（管理者のみ実行可能）
 * 古いパス形式の署名を新しい統一パス形式に移行
 */
exports.migrateSignatureData = onCall(
  { region: "asia-northeast1", timeoutSeconds: 540 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { companyId, dryRun = true } = request.data;
    if (!companyId) {
      throw new HttpsError("invalid-argument", "companyIdは必須です");
    }

    try {
      // 管理者権限チェック
      const userDoc = await db
        .collection("companies")
        .doc(companyId)
        .collection("users")
        .doc(request.auth.uid)
        .get();

      if (!userDoc.exists || userDoc.data().role !== "admin") {
        throw new HttpsError("permission-denied", "管理者権限が必要です");
      }

      // 全日報を取得
      const reportsSnapshot = await db
        .collection("companies")
        .doc(companyId)
        .collection("dailyReports")
        .get();

      const results = {
        total: reportsSnapshot.size,
        needsMigration: 0,
        migrated: 0,
        skipped: 0,
        errors: [],
      };

      for (const reportDoc of reportsSnapshot.docs) {
        const reportData = reportDoc.data();
        const imageUrl = reportData.clientSignature?.imageUrl;

        if (!imageUrl) {
          results.skipped++;
          continue;
        }

        // 新しいパス形式かどうかをチェック
        // 新パス: companies/{companyId}/dailyReports/{reportId}/signatures/
        // 旧パス1: signatures/{companyId}/{reportId}/
        // 旧パス2: companies/{companyId}/reports/{reportId}/photos/signature_
        const isNewFormat = imageUrl.includes(`/dailyReports/${reportDoc.id}/signatures/`);

        if (isNewFormat) {
          results.skipped++;
          continue;
        }

        results.needsMigration++;

        if (dryRun) {
          console.log(`[DRY RUN] 移行対象: ${reportDoc.id} - ${imageUrl}`);
          continue;
        }

        try {
          // 古いファイルをダウンロード
          const oldUrl = new URL(imageUrl);
          const oldPath = decodeURIComponent(oldUrl.pathname.split("/o/")[1]?.split("?")[0] || "");

          if (!oldPath) {
            results.errors.push({ reportId: reportDoc.id, error: "パス解析失敗" });
            continue;
          }

          const oldFile = bucket.file(oldPath);
          const [exists] = await oldFile.exists();

          if (!exists) {
            results.errors.push({ reportId: reportDoc.id, error: "元ファイルが存在しない" });
            continue;
          }

          // 新しいパスにコピー
          const timestamp = Date.now();
          const newPath = `companies/${companyId}/dailyReports/${reportDoc.id}/signatures/${timestamp}.png`;
          const newFile = bucket.file(newPath);

          await oldFile.copy(newFile);

          // 新しいURLを取得
          const [newUrl] = await newFile.getSignedUrl({
            action: "read",
            expires: "03-01-2500",
          });

          // Firestore更新
          await reportDoc.ref.update({
            "clientSignature.imageUrl": newUrl,
            "clientSignature.migratedAt": Timestamp.now(),
            "clientSignature.oldImageUrl": imageUrl,
          });

          // 古いファイルを削除（オプション：コメントアウト）
          // await oldFile.delete();

          results.migrated++;
          console.log(`移行成功: ${reportDoc.id}`);
        } catch (migrateError) {
          results.errors.push({ reportId: reportDoc.id, error: migrateError.message });
          console.error(`移行失敗: ${reportDoc.id}`, migrateError);
        }
      }

      console.log("移行結果:", results);
      return results;
    } catch (error) {
      console.error("署名データ移行エラー:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "移行に失敗しました");
    }
  }
);
