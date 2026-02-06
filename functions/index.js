const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const nodemailer = require("nodemailer");
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

      const zip = new JSZip();
      const reports = [];

      reportsSnapshot.forEach((doc) => {
        reports.push({ id: doc.id, ...doc.data() });
      });

      // 各日報のPDFを生成
      for (const report of reports) {
        const pdfBuffer = await generateReportPdf(report, companyData, fontPath);
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
 * 日報PDFを生成
 */
async function generateReportPdf(report, companyData, fontPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 40, bottom: 40, left: 40, right: 40 },
      });

      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // フォント登録
      doc.registerFont("NotoSans", fontPath);
      doc.font("NotoSans");

      const pageWidth = doc.page.width - 80;
      const reportDate = report.reportDate?.toDate ? report.reportDate.toDate() : new Date(report.reportDate);
      const weatherMap = { sunny: "晴れ", cloudy: "曇り", rainy: "雨", snowy: "雪" };

      // ヘッダー
      doc.fontSize(18).text("作業日報", { align: "center" });
      doc.moveDown(0.5);

      // 会社名
      if (companyData.companyName) {
        doc.fontSize(10).text(companyData.companyName, { align: "right" });
      }
      doc.moveDown();

      // 基本情報テーブル
      const y1 = doc.y;
      doc.fontSize(10);

      // 左側情報
      doc.text(`実施日: ${formatDateJapanese(reportDate)}`, 40);
      doc.text(`現場名: ${report.siteName || "-"}`, 40);
      doc.text(`天候: ${weatherMap[report.weather] || report.weather || "-"}`, 40);

      // 右側情報
      doc.text(`作成者: ${report.createdByName || "-"}`, 300, y1);
      if (report.submittedAt) {
        const submittedDate = report.submittedAt?.toDate ? report.submittedAt.toDate() : new Date(report.submittedAt);
        doc.text(`送信日時: ${formatDateTimeJapanese(submittedDate)}`, 300);
      }

      doc.moveDown(2);

      // 作業員テーブル（5人/ページ）
      const workers = report.workers || [];
      const workersPerPage = 5;
      const totalPages = Math.ceil(workers.length / workersPerPage) || 1;

      for (let page = 0; page < totalPages; page++) {
        if (page > 0) {
          doc.addPage();
          doc.font("NotoSans");
          doc.fontSize(12).text(`作業日報（${page + 1}/${totalPages}ページ）`, { align: "center" });
          doc.moveDown();
        }

        // 作業員セクション
        doc.fontSize(12).text(`作業員一覧（${workers.length}名）`, 40);
        doc.moveDown(0.5);

        // テーブルヘッダー
        const tableTop = doc.y;
        const colWidths = [120, 70, 70, 60, 195];
        const headers = ["氏名", "開始", "終了", "昼休憩", "備考/作業内容"];

        doc.fontSize(9);
        drawTableRow(doc, tableTop, colWidths, headers, true);

        // 作業員データ
        let currentY = tableTop + 20;
        const startIdx = page * workersPerPage;
        const endIdx = Math.min(startIdx + workersPerPage, workers.length);

        for (let i = startIdx; i < endIdx; i++) {
          const worker = workers[i];
          const rowData = [
            worker.name || "-",
            worker.startTime || "-",
            worker.endTime || "-",
            worker.noLunchBreak ? "なし" : "あり",
            worker.remarks || "-",
          ];
          drawTableRow(doc, currentY, colWidths, rowData, false);
          currentY += 20;
        }

        doc.y = currentY + 10;
      }

      // 連絡事項
      if (report.notes) {
        doc.moveDown();
        doc.fontSize(12).text("連絡事項", 40);
        doc.moveDown(0.5);
        doc.fontSize(10).text(report.notes, 40, doc.y, { width: pageWidth });
      }

      // 署名情報
      if (report.clientSignature?.signedAt) {
        doc.moveDown();
        const signedAt = report.clientSignature.signedAt?.toDate
          ? report.clientSignature.signedAt.toDate()
          : new Date(report.clientSignature.signedAt);
        doc.fontSize(10).text(`元請確認サイン: ${formatDateTimeJapanese(signedAt)}`, 40);
      }

      // 承認情報
      if (report.approval?.approvedAt) {
        doc.moveDown();
        const approvedAt = report.approval.approvedAt?.toDate
          ? report.approval.approvedAt.toDate()
          : new Date(report.approval.approvedAt);
        doc.fontSize(10).text(`承認: ${report.approval.approvedByName || "-"} (${formatDateTimeJapanese(approvedAt)})`, 40);
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * テーブル行を描画
 */
function drawTableRow(doc, y, colWidths, data, isHeader) {
  let x = 40;
  const rowHeight = 18;

  if (isHeader) {
    doc.rect(x, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill("#f3f4f6");
    doc.fillColor("#374151");
  } else {
    doc.rect(x, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).stroke("#e5e7eb");
    doc.fillColor("#000000");
  }

  for (let i = 0; i < data.length; i++) {
    const text = String(data[i] || "-");
    const maxChars = Math.floor(colWidths[i] / 6);
    const displayText = text.length > maxChars ? text.substring(0, maxChars - 1) + "…" : text;
    doc.text(displayText, x + 4, y + 4, { width: colWidths[i] - 8, height: rowHeight - 4, lineBreak: false });
    x += colWidths[i];
  }
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

      // PDF生成
      const pdfBuffer = await generateReportPdf(report, companyData, fontPath);

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
