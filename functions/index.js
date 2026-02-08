const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
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
        // 現場データから元請会社名を取得
        let clientName = null;
        if (report.siteId) {
          const siteDoc = await db.collection("companies").doc(companyId).collection("sites").doc(report.siteId).get();
          if (siteDoc.exists) {
            clientName = siteDoc.data().clientName || null;
          }
        }
        const pdfBuffer = await generateReportPdf(report, companyData, fontPath, signatureImageBuffer, logoImageBuffer, clientName);
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
function generateReportPdf(report, companyData, fontPath, signatureImageBuffer, logoImageBuffer, clientName) {
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

      // 実働時間を計算するヘルパー関数
      const calcWorkingHours = (startTime, endTime) => {
        if (!startTime || !endTime) return "";
        const [startH, startM] = startTime.split(":").map(Number);
        const [endH, endM] = endTime.split(":").map(Number);
        if (isNaN(startH) || isNaN(endH)) return "";
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;
        const diff = endMinutes - startMinutes;
        if (diff < 0) return "";
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
          // 実働時間
          const workingHours = calcWorkingHours(worker.startTime, worker.endTime);
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

      // 現場データから元請会社名を取得
      let clientName = null;
      if (report.siteId) {
        const siteDoc = await db.collection("companies").doc(companyId).collection("sites").doc(report.siteId).get();
        if (siteDoc.exists) {
          clientName = siteDoc.data().clientName || null;
        }
      }

      // PDF生成
      const pdfBuffer = await generateReportPdf(report, companyData, fontPath, signatureImageBuffer, logoImageBuffer, clientName);

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
function generateReportPdfForEmail(reportData, companyData, signatureImageBuffer, logoImageBuffer, clientName) {
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

      // 実働時間を計算するヘルパー関数
      const calcWorkingHours = (startTime, endTime) => {
        if (!startTime || !endTime) return "";
        const [startH, startM] = startTime.split(":").map(Number);
        const [endH, endM] = endTime.split(":").map(Number);
        if (isNaN(startH) || isNaN(endH)) return "";
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;
        const diff = endMinutes - startMinutes;
        if (diff < 0) return "";
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
          // 実働時間
          const workingHours = calcWorkingHours(worker.startTime, worker.endTime);
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

        // 現場データから元請会社名を取得
        let clientName = null;
        if (afterData.siteId) {
          const siteDoc = await db.collection("companies").doc(companyId).collection("sites").doc(afterData.siteId).get();
          if (siteDoc.exists) {
            clientName = siteDoc.data().clientName || null;
          }
        }

        // PDF生成
        const pdfBuffer = await generateReportPdfForEmail(afterData, companyData, signatureImageBuffer, logoImageBuffer, clientName);

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
