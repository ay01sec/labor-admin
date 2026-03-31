const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentUpdated, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const payjpSecretKey = defineSecret("PAYJP_SECRET_KEY");
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

/**
 * UTCの日付を日本時間（JST）に変換
 * @param {Date} date - UTC日付
 * @returns {Date} - JST日付
 */
function toJST(date) {
  const jstOffset = 9 * 60; // JST = UTC + 9時間
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utc + jstOffset * 60000);
}

// ============================================================
// Custom Claims for Storage Security
// ============================================================

/**
 * ユーザーが企業に追加された時、companyIdをCustom Claimに設定
 */
exports.onUserAddedToCompany = onDocumentCreated(
  {
    document: "companies/{companyId}/users/{userId}",
    region: "asia-northeast1",
  },
  async (event) => {
    const companyId = event.params.companyId;
    const userId = event.params.userId;

    try {
      // Custom ClaimにcompanyIdを設定
      await auth.setCustomUserClaims(userId, { companyId });
      console.log(`Custom Claim設定完了: userId=${userId}, companyId=${companyId}`);

      // ユーザードキュメントにclaimsUpdatedAtを記録（クライアント側でトークン更新の判断に使用）
      await db
        .collection("companies")
        .doc(companyId)
        .collection("users")
        .doc(userId)
        .update({ claimsUpdatedAt: Timestamp.now() });
    } catch (error) {
      console.error("Custom Claim設定エラー:", error);
    }
  }
);

/**
 * 既存ユーザー向け：companyIdをCustom Claimに設定（Callable Function）
 * ログイン後にクライアントから呼び出す
 */
exports.setCompanyClaim = onCall(
  {
    region: "asia-northeast1",
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const userId = request.auth.uid;

    try {
      // ユーザーが所属する企業を検索
      const companiesSnapshot = await db.collection("companies").get();

      let foundCompanyId = null;
      for (const companyDoc of companiesSnapshot.docs) {
        const userDoc = await companyDoc.ref.collection("users").doc(userId).get();

        if (userDoc.exists) {
          foundCompanyId = companyDoc.id;
          break;
        }
      }

      if (!foundCompanyId) {
        throw new HttpsError("not-found", "所属企業が見つかりません");
      }

      // 既存のClaimを確認
      const user = await auth.getUser(userId);
      const currentClaims = user.customClaims || {};

      // 既に正しいcompanyIdが設定されている場合はスキップ
      if (currentClaims.companyId === foundCompanyId) {
        console.log(`Custom Claim既存: userId=${userId}, companyId=${foundCompanyId}`);
        return { companyId: foundCompanyId, updated: false };
      }

      // Custom Claimを設定
      await auth.setCustomUserClaims(userId, { ...currentClaims, companyId: foundCompanyId });
      console.log(`Custom Claim更新: userId=${userId}, companyId=${foundCompanyId}`);

      return { companyId: foundCompanyId, updated: true };
    } catch (error) {
      console.error("setCompanyClaim エラー:", error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError("internal", "Custom Claim設定に失敗しました");
    }
  }
);

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
 * - トライアル中: カード情報を保存（課金はトライアル終了後）
 * - expired/suspended: 即時課金して再開
 * - active: カード情報を更新
 */
exports.registerCard = onCall(
  { region: "asia-northeast1", maxInstances: 10, secrets: [payjpSecretKey] },
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
      const currentStatus = companyData.billing?.status || "trial";
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
        // 既存顧客 → カード追加を試行
        try {
          const newCard = await payjp.customers.cards.create(payjpCustomerId, {
            card: tokenId,
          });
          card = newCard;

          // デフォルトカードに設定
          await payjp.customers.update(payjpCustomerId, {
            default_card: card.id,
          });
        } catch (customerError) {
          // 顧客が存在しない場合（テスト→本番切り替え等）、新規作成
          if (customerError?.body?.error?.code === "invalid_id" ||
              customerError?.body?.error?.message?.includes("No such customer")) {
            console.log("既存顧客が見つからないため、新規作成します:", payjpCustomerId);
            const customer = await payjp.customers.create({
              card: tokenId,
              description: `${companyData.companyName} (${companyData.companyCode})`,
            });
            payjpCustomerId = customer.id;
            card = customer.cards.data[0];
          } else {
            throw customerError;
          }
        }
      }

      // 基本的なカード情報を更新
      const updateData = {
        "billing.paymentMethod": "card",
        "billing.payjpCustomerId": payjpCustomerId,
        "billing.cardLast4": card.last4,
        "billing.cardBrand": card.brand,
        "billing.retryCount": 0,
        updatedAt: FieldValue.serverTimestamp(),
      };

      // トライアル中の場合: ステータスはそのまま（課金はトライアル終了後）
      if (currentStatus === "trial") {
        console.log(`カード登録（トライアル中）: ${companyData.companyName}`);
        await companyRef.update(updateData);

        return {
          success: true,
          card: { last4: card.last4, brand: card.brand },
          message: "カードを登録しました。トライアル終了後に課金が開始されます。",
        };
      }

      // expired/suspended の場合: 即時課金してサービス再開
      if (currentStatus === "expired" || currentStatus === "suspended" || currentStatus === "past_due") {
        console.log(`カード登録（再開）: ${companyData.companyName} (${currentStatus})`);

        const jst = toJST(new Date());
        const billingDay = calculateBillingDay(jst);
        const billingMonth = `${jst.getFullYear()}-${String(jst.getMonth() + 1).padStart(2, "0")}`;

        // アクティブなユーザー数を取得
        const usersSnapshot = await db
          .collection("companies")
          .doc(companyId)
          .collection("users")
          .where("isActive", "==", true)
          .where("role", "in", ["admin", "office", "manager", "site_manager"])
          .get();

        const userCount = usersSnapshot.size;
        const amount = calculateBillingAmount(userCount);

        // 即時課金を実行
        const charge = await payjp.charges.create({
          amount: amount,
          currency: "jpy",
          customer: payjpCustomerId,
          description: `${companyData.companyName} - ${billingMonth}月額利用料（再開）`,
          metadata: {
            companyId: companyId,
            billingMonth: billingMonth,
            userCount: String(userCount),
            reactivation: "true",
          },
        });

        // 課金履歴を保存
        await db
          .collection("companies")
          .doc(companyId)
          .collection("billingHistory")
          .add({
            billingMonth: billingMonth,
            amount: amount,
            userCount: userCount,
            chargeId: charge.id,
            status: "success",
            isReactivation: true,
            paidAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
          });

        // 次回課金日を計算
        const nextBillingDate = calculateNextBillingDate(billingDay);

        // ステータスをactiveに更新
        await companyRef.update({
          ...updateData,
          "billing.status": "active",
          "billing.billingDay": billingDay,
          "billing.nextBillingDate": Timestamp.fromDate(nextBillingDate),
          "billing.lastBilledAt": FieldValue.serverTimestamp(),
          "billing.lastBilledAmount": amount,
        });

        // 管理者のメールアドレスを取得
        const adminUser = usersSnapshot.docs.find((doc) => doc.data().role === "admin");
        const adminEmail = adminUser?.data()?.email;

        // 領収書を生成・送信
        await processReceiptAfterCharge({
          companyId,
          companyName: companyData.companyName,
          adminEmail,
          amount,
          userCount,
          billingMonth,
          chargeId: charge.id,
        });

        console.log(`サービス再開・課金成功: ${companyData.companyName} - ¥${amount}`);

        return {
          success: true,
          card: { last4: card.last4, brand: card.brand },
          chargeId: charge.id,
          amount: amount,
          message: "カードを登録し、サービスを再開しました。",
        };
      }

      // active の場合: カード情報更新のみ
      await companyRef.update(updateData);

      return {
        success: true,
        card: { last4: card.last4, brand: card.brand },
        message: "カード情報を更新しました。",
      };
    } catch (error) {
      console.error("カード登録エラー:", error);
      console.error("エラー詳細:", JSON.stringify(error, null, 2));
      if (error instanceof HttpsError) throw error;
      // PAY.JPエラーの場合、詳細メッセージを含める
      const errorMessage = error?.body?.error?.message || error?.message || "カード登録に失敗しました";
      throw new HttpsError("internal", `カード登録に失敗しました: ${errorMessage}`);
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
          trialEndDate: Timestamp.fromDate(
            new Date(Date.now() + PRICING.TRIAL_DAYS * 24 * 60 * 60 * 1000)
          ),
          billingDay: null, // 課金日（初回課金時に設定）
          nextBillingDate: null, // 次回課金日
          retryCount: 0,
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

      const submittedAtUtc = report.submittedAt?.toDate
        ? report.submittedAt.toDate()
        : report.submittedAt ? new Date(report.submittedAt) : new Date();
      const submittedAtJst = toJST(submittedAtUtc);
      const reportDateStr = `${submittedAtJst.getMonth() + 1}月${submittedAtJst.getDate()}日`;

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

      const submittedAtUtc = reportData.submittedAt?.toDate
        ? reportData.submittedAt.toDate()
        : reportData.submittedAt ? new Date(reportData.submittedAt) : new Date();
      const submittedAtJst = toJST(submittedAtUtc);
      const reportDateStr = `${submittedAtJst.getMonth() + 1}月${submittedAtJst.getDate()}日`;

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
    memory: "1GiB",
    timeoutSeconds: 300,
    retry: true,
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

// ========================================
// 月額課金関連
// ========================================

/**
 * 料金体系定数
 */
const PRICING = {
  BASE_PRICE: 1200, // 基本料金（税込）
  ADDITIONAL_PRICE_PER_USER: 300, // 追加料金（4人目以降）
  FREE_USER_COUNT: 3, // 基本料金に含まれるユーザー数
  TRIAL_DAYS: 30, // トライアル期間
  RETRY_INTERVALS: [3, 7], // リトライ間隔（日数）: 3日後、7日後
  MAX_BILLING_DAY: 28, // 最大課金日（29日以降は28日に固定）
};

/**
 * 課金日を計算（29日以降は28日に固定）
 * @param {Date} date - 基準日
 * @returns {number} - 課金日（1-28）
 */
function calculateBillingDay(date) {
  const day = date.getDate();
  return Math.min(day, PRICING.MAX_BILLING_DAY);
}

/**
 * 次回課金日を計算
 * @param {number} billingDay - 課金日（1-28）
 * @param {Date} fromDate - 基準日（省略時は現在）
 * @returns {Date} - 次回課金日
 */
function calculateNextBillingDate(billingDay, fromDate = null) {
  const jst = fromDate ? toJST(fromDate) : toJST(new Date());
  let year = jst.getFullYear();
  let month = jst.getMonth();

  // 今月の課金日を過ぎている場合は来月
  if (jst.getDate() >= billingDay) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return new Date(year, month, billingDay, 9, 0, 0); // 9:00 JST
}

/**
 * 課金金額を計算
 * @param {number} userCount - 現場管理者の人数
 * @returns {number} - 課金金額（円）
 */
function calculateBillingAmount(userCount) {
  if (userCount <= PRICING.FREE_USER_COUNT) {
    return PRICING.BASE_PRICE;
  }
  const additionalUsers = userCount - PRICING.FREE_USER_COUNT;
  return PRICING.BASE_PRICE + additionalUsers * PRICING.ADDITIONAL_PRICE_PER_USER;
}

/**
 * 領収書番号を生成
 * @param {string} billingMonth - 課金月（YYYY-MM形式）
 * @param {string} companyId - 企業ID
 * @returns {string} - 領収書番号
 */
function generateReceiptNumber(billingMonth, companyId) {
  const monthPart = billingMonth.replace("-", "");
  const companyPart = companyId.substring(0, 6).toUpperCase();
  const timestamp = Date.now().toString(36).toUpperCase();
  return `RCP-${monthPart}-${companyPart}-${timestamp}`;
}

/**
 * 領収書PDFを生成
 * @param {Object} params - 領収書パラメータ
 * @returns {Promise<Buffer>} - PDFバッファ
 */
function generateReceiptPdf(params) {
  const {
    receiptNumber,
    companyName,
    amount,
    billingMonth,
    userCount,
    issuedAt,
  } = params;

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
      const CENTER = (LEFT + RIGHT) / 2;

      // タイトル
      doc.fontSize(28).text("領 収 書", LEFT, 80, { align: "center" });

      // 領収書番号
      doc.fontSize(8).text(`No. ${receiptNumber}`, RIGHT - 200, 60, { width: 200, align: "right" });

      // 発行日
      doc.fontSize(9).text(`発行日: ${issuedAt}`, RIGHT - 200, 75, { width: 200, align: "right" });

      // 宛名
      doc.fontSize(14).text(`${companyName} 御中`, LEFT, 150);

      // 金額ボックス
      const amountY = 200;
      doc.rect(LEFT, amountY, RIGHT - LEFT, 60).stroke();
      doc.fontSize(12).text("金額", LEFT + 20, amountY + 10);

      const formattedAmount = `¥${amount.toLocaleString()}-`;
      doc.fontSize(24).text(formattedAmount, LEFT, amountY + 25, {
        width: RIGHT - LEFT,
        align: "center"
      });

      // 但し書き
      doc.fontSize(11).text("但し、労務管理アプリ月額使用料として　　　クレジットカード利用", LEFT, amountY + 80);

      // 内訳
      const detailY = amountY + 120;
      doc.fontSize(10).text("【内訳】", LEFT, detailY);

      const basePrice = PRICING.BASE_PRICE;
      const additionalUsers = Math.max(0, userCount - PRICING.FREE_USER_COUNT);
      const additionalAmount = additionalUsers * PRICING.ADDITIONAL_PRICE_PER_USER;

      doc.text(`対象月: ${billingMonth}`, LEFT + 20, detailY + 20);
      doc.text(`基本料金: ¥${basePrice.toLocaleString()}`, LEFT + 20, detailY + 35);
      doc.text(`利用者数: ${userCount}名`, LEFT + 20, detailY + 50);

      if (additionalUsers > 0) {
        doc.text(`追加料金 (${additionalUsers}名 × ¥${PRICING.ADDITIONAL_PRICE_PER_USER}): ¥${additionalAmount.toLocaleString()}`, LEFT + 20, detailY + 65);
      }

      doc.text(`合計金額（税込）: ¥${amount.toLocaleString()}`, LEFT + 20, detailY + 85);

      // 発行者情報
      const issuerY = detailY + 140;
      doc.fontSize(10).text("【発行者】", RIGHT - 200, issuerY);
      doc.fontSize(9);
      doc.text("AYBDX株式会社", RIGHT - 200, issuerY + 18);
      doc.text("〒080-0804", RIGHT - 200, issuerY + 33);
      doc.text("北海道帯広市東4条14丁目6-3", RIGHT - 200, issuerY + 46);
      doc.text("クラックスハイム第三帯広501", RIGHT - 200, issuerY + 59);
      doc.text("TEL: 070-8533-0395", RIGHT - 200, issuerY + 74);

      // 印鑑画像
      const stampPath = path.join(__dirname, "assets", "stamp.png");
      doc.image(stampPath, RIGHT - 80, issuerY + 10, { width: 60, height: 60 });

      // フッター
      doc.fontSize(8)
        .fillColor("#666666")
        .text(
          "この領収書は電子的に発行されたものです。",
          LEFT,
          750,
          { align: "center", width: RIGHT - LEFT }
        );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 領収書メールを送信
 * @param {Object} params - メールパラメータ
 */
async function sendReceiptEmail(params) {
  const {
    to,
    companyName,
    amount,
    billingMonth,
    receiptNumber,
    pdfBuffer,
  } = params;

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM;

  if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
    console.warn("SMTP設定が未設定のため領収書メール送信をスキップしました");
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

  const mailBody = `
${companyName} 様

いつも労務管理システムをご利用いただきありがとうございます。

${billingMonth}分のご利用料金のお支払いが完了いたしました。
領収書を添付いたしますので、ご確認ください。

━━━━━━━━━━━━━━━━━━━━━━
■ お支払い情報
━━━━━━━━━━━━━━━━━━━━━━

領収書番号: ${receiptNumber}
対象月: ${billingMonth}
金額: ¥${amount.toLocaleString()}（税込）

━━━━━━━━━━━━━━━━━━━━━━

ご不明な点がございましたら、お気軽にお問い合わせください。

今後とも労務管理システムをよろしくお願いいたします。
`.trim();

  await transporter.sendMail({
    from: `"労務管理システム" <${smtpFrom}>`,
    to,
    subject: `【労務管理システム】${billingMonth}分 領収書のお知らせ`,
    text: mailBody,
    attachments: [
      {
        filename: `receipt_${billingMonth.replace("-", "")}_${receiptNumber}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });

  return true;
}

/**
 * 課金完了後の領収書処理
 * @param {Object} params - 処理パラメータ
 */
async function processReceiptAfterCharge(params) {
  const {
    companyId,
    companyName,
    adminEmail,
    amount,
    userCount,
    billingMonth,
    chargeId,
  } = params;

  try {
    // 領収書番号を生成
    const receiptNumber = generateReceiptNumber(billingMonth, companyId);

    // 発行日（JST）
    const jst = toJST(new Date());
    const issuedAt = `${jst.getFullYear()}年${jst.getMonth() + 1}月${jst.getDate()}日`;

    // 領収書PDFを生成
    const pdfBuffer = await generateReceiptPdf({
      receiptNumber,
      companyName,
      amount,
      billingMonth,
      userCount,
      issuedAt,
    });

    // Firebase Storageに保存
    const storagePath = `companies/${companyId}/receipts/${billingMonth}_${receiptNumber}.pdf`;
    const file = bucket.file(storagePath);
    await file.save(pdfBuffer, {
      metadata: { contentType: "application/pdf" },
    });

    // 署名付きURLを取得（1年間有効）
    const [receiptUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
    });

    // Firestoreの課金履歴を更新
    const historySnapshot = await db
      .collection("companies")
      .doc(companyId)
      .collection("billingHistory")
      .where("chargeId", "==", chargeId)
      .limit(1)
      .get();

    if (!historySnapshot.empty) {
      await historySnapshot.docs[0].ref.update({
        receiptNumber,
        receiptUrl,
        receiptGeneratedAt: FieldValue.serverTimestamp(),
      });
    }

    // 管理者にメール送信
    if (adminEmail) {
      await sendReceiptEmail({
        to: adminEmail,
        companyName,
        amount,
        billingMonth,
        receiptNumber,
        pdfBuffer,
      });
      console.log(`領収書メール送信完了: ${companyName} -> ${adminEmail}`);
    }

    return { receiptNumber, receiptUrl };
  } catch (error) {
    console.error(`領収書処理エラー: ${companyName}`, error);
    return null;
  }
}

/**
 * 単一企業の課金を実行する内部関数
 * @param {Object} params - 課金パラメータ
 * @returns {Object} - 課金結果
 */
async function executeCompanyBilling(params) {
  const {
    companyId,
    companyData,
    payjp,
    billingMonth,
    isRetry = false,
  } = params;

  const companyName = companyData.companyName || "不明";
  const payjpCustomerId = companyData.billing?.payjpCustomerId;

  if (!payjpCustomerId) {
    return { success: false, reason: "no_customer_id" };
  }

  // アクティブなユーザー数を取得
  const usersSnapshot = await db
    .collection("companies")
    .doc(companyId)
    .collection("users")
    .where("isActive", "==", true)
    .where("role", "in", ["admin", "office", "manager", "site_manager"])
    .get();

  const userCount = usersSnapshot.size;
  const amount = calculateBillingAmount(userCount);

  // 管理者のメールアドレスを取得
  const adminUser = usersSnapshot.docs.find((doc) => doc.data().role === "admin");
  const adminEmail = adminUser?.data()?.email;

  console.log(`課金実行: ${companyName} - ユーザー数: ${userCount}人, 金額: ¥${amount}${isRetry ? " (リトライ)" : ""}`);

  // PAY.JPで課金実行
  const charge = await payjp.charges.create({
    amount: amount,
    currency: "jpy",
    customer: payjpCustomerId,
    description: `${companyName} - ${billingMonth}月額利用料${isRetry ? "（リトライ）" : ""}`,
    metadata: {
      companyId: companyId,
      billingMonth: billingMonth,
      userCount: String(userCount),
      isRetry: String(isRetry),
    },
  });

  // 課金履歴を保存
  await db
    .collection("companies")
    .doc(companyId)
    .collection("billingHistory")
    .add({
      billingMonth: billingMonth,
      amount: amount,
      userCount: userCount,
      chargeId: charge.id,
      status: "success",
      isRetry: isRetry,
      paidAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    });

  // 次回課金日を計算
  const billingDay = companyData.billing?.billingDay || 1;
  const nextBillingDate = calculateNextBillingDate(billingDay);

  // 企業の課金情報を更新
  await db.collection("companies").doc(companyId).update({
    "billing.status": "active",
    "billing.lastBilledAt": FieldValue.serverTimestamp(),
    "billing.lastBilledAmount": amount,
    "billing.nextBillingDate": Timestamp.fromDate(nextBillingDate),
    "billing.retryCount": 0,
    "billing.lastFailedAt": FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  console.log(`課金成功: ${companyName} - ¥${amount} (chargeId: ${charge.id})`);

  // 領収書を生成・送信
  await processReceiptAfterCharge({
    companyId,
    companyName,
    adminEmail,
    amount,
    userCount,
    billingMonth,
    chargeId: charge.id,
  });

  return { success: true, chargeId: charge.id, amount };
}

/**
 * 課金失敗時の処理
 * @param {Object} params - パラメータ
 */
async function handleBillingFailure(params) {
  const { companyId, companyData, billingMonth, errorMessage, adminEmail } = params;

  const currentRetryCount = companyData.billing?.retryCount || 0;
  const newRetryCount = currentRetryCount + 1;
  const billingDay = companyData.billing?.billingDay || 1;

  // 課金失敗履歴を保存
  await db
    .collection("companies")
    .doc(companyId)
    .collection("billingHistory")
    .add({
      billingMonth: billingMonth,
      status: "failed",
      errorMessage: errorMessage,
      retryCount: newRetryCount,
      createdAt: FieldValue.serverTimestamp(),
    });

  // リトライ上限に達した場合
  if (newRetryCount > PRICING.RETRY_INTERVALS.length) {
    // サービス停止
    await db.collection("companies").doc(companyId).update({
      "billing.status": "suspended",
      "billing.retryCount": newRetryCount,
      "billing.suspendedAt": FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`サービス停止: ${companyData.companyName} (リトライ上限到達)`);

    // 停止通知メール送信
    if (adminEmail) {
      await sendBillingFailureNotification({
        to: adminEmail,
        companyName: companyData.companyName,
        isSuspended: true,
      });
    }
  } else {
    // 次回リトライ日を計算
    const retryDays = PRICING.RETRY_INTERVALS[newRetryCount - 1];
    const nextRetryDate = new Date();
    nextRetryDate.setDate(nextRetryDate.getDate() + retryDays);

    await db.collection("companies").doc(companyId).update({
      "billing.status": "past_due",
      "billing.retryCount": newRetryCount,
      "billing.lastFailedAt": FieldValue.serverTimestamp(),
      "billing.nextRetryDate": Timestamp.fromDate(nextRetryDate),
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`課金失敗: ${companyData.companyName} - 次回リトライ: ${retryDays}日後`);

    // 失敗通知メール送信
    if (adminEmail) {
      await sendBillingFailureNotification({
        to: adminEmail,
        companyName: companyData.companyName,
        retryDays: retryDays,
        isSuspended: false,
      });
    }
  }
}

/**
 * 課金失敗通知メールを送信
 * @param {Object} params - パラメータ
 */
async function sendBillingFailureNotification(params) {
  const { to, companyName, retryDays, isSuspended } = params;

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM;

  if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
    console.warn("SMTP設定が未設定のため通知メール送信をスキップしました");
    return;
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

  let subject, mailBody;

  if (isSuspended) {
    subject = "【重要】労務管理システム - サービス停止のお知らせ";
    mailBody = `
${companyName} 様

ご利用料金のお支払いが確認できなかったため、サービスを一時停止いたしました。

サービスを再開するには、管理画面の「決済情報」から有効なクレジットカードを登録してください。

━━━━━━━━━━━━━━━━━━━━━━
■ サービス再開方法
━━━━━━━━━━━━━━━━━━━━━━

1. 管理画面にログイン
2. 「自社情報設定」→「決済情報」タブを開く
3. 有効なクレジットカードを登録

カード登録後、自動的にサービスが再開されます。

━━━━━━━━━━━━━━━━━━━━━━

ご不明な点がございましたら、お気軽にお問い合わせください。
`.trim();
  } else {
    subject = "【重要】労務管理システム - お支払いの確認";
    mailBody = `
${companyName} 様

ご利用料金のお支払いが確認できませんでした。
${retryDays}日後に再度課金を試みます。

クレジットカードの有効期限や利用限度額をご確認ください。

━━━━━━━━━━━━━━━━━━━━━━
■ カード情報の更新方法
━━━━━━━━━━━━━━━━━━━━━━

1. 管理画面にログイン
2. 「自社情報設定」→「決済情報」タブを開く
3. 「カード情報を更新」からカードを再登録

━━━━━━━━━━━━━━━━━━━━━━

ご不明な点がございましたら、お気軽にお問い合わせください。
`.trim();
  }

  await transporter.sendMail({
    from: `"労務管理システム" <${smtpFrom}>`,
    to,
    subject,
    text: mailBody,
  });
}

/**
 * 日次課金処理（毎日午前9時に実行）
 * - トライアル終了チェック
 * - 課金日の企業への課金
 * - リトライ処理
 */
exports.dailyBillingProcessor = onSchedule(
  {
    schedule: "0 9 * * *", // 毎日 09:00
    timeZone: "Asia/Tokyo",
    region: "asia-northeast1",
    secrets: [payjpSecretKey],
  },
  async () => {
    console.log("日次課金処理を開始します");

    const jst = toJST(new Date());
    const today = jst.getDate();
    const billingMonth = `${jst.getFullYear()}-${String(jst.getMonth() + 1).padStart(2, "0")}`;

    try {
      const payjp = getPayjp();

      // ========================================
      // 1. トライアル終了チェック
      // ========================================
      console.log("トライアル終了チェック...");

      const trialCompaniesSnapshot = await db
        .collection("companies")
        .where("billing.status", "==", "trial")
        .get();

      for (const companyDoc of trialCompaniesSnapshot.docs) {
        const companyId = companyDoc.id;
        const companyData = companyDoc.data();
        const companyName = companyData.companyName || "不明";
        const trialEndDate = companyData.billing?.trialEndDate?.toDate?.();

        // テスト企業（企業コード10000000以下）は自動課金処理から除外
        const companyCodeNum = parseInt(companyData.companyCode, 10);
        if (!isNaN(companyCodeNum) && companyCodeNum <= 10000000) {
          console.log(`スキップ: ${companyName} (テスト企業: ${companyData.companyCode})`);
          continue;
        }

        if (!trialEndDate) continue;

        // トライアル終了日を過ぎているか
        if (jst >= trialEndDate) {
          const payjpCustomerId = companyData.billing?.payjpCustomerId;

          if (payjpCustomerId) {
            // カード登録済み → 初回課金を実行
            console.log(`トライアル終了（カード登録済み）: ${companyName}`);

            // 課金日を決定（トライアル終了翌日、29日以降は28日）
            const billingDay = calculateBillingDay(jst);

            try {
              // 初回課金を実行
              await executeCompanyBilling({
                companyId,
                companyData: {
                  ...companyData,
                  billing: { ...companyData.billing, billingDay },
                },
                payjp,
                billingMonth,
                isRetry: false,
              });

              // 課金日を保存
              await db.collection("companies").doc(companyId).update({
                "billing.billingDay": billingDay,
              });

              console.log(`初回課金成功: ${companyName} - 課金日: ${billingDay}日`);
            } catch (chargeError) {
              console.error(`初回課金失敗: ${companyName}`, chargeError.message);

              // 管理者メールを取得
              const usersSnapshot = await db
                .collection("companies")
                .doc(companyId)
                .collection("users")
                .where("role", "==", "admin")
                .limit(1)
                .get();
              const adminEmail = usersSnapshot.docs[0]?.data()?.email;

              await handleBillingFailure({
                companyId,
                companyData: { ...companyData, billing: { ...companyData.billing, billingDay } },
                billingMonth,
                errorMessage: chargeError.message,
                adminEmail,
              });

              // 課金日を保存
              await db.collection("companies").doc(companyId).update({
                "billing.billingDay": billingDay,
              });
            }
          } else {
            // カード未登録 → 機能制限
            console.log(`トライアル終了（カード未登録）: ${companyName}`);

            await db.collection("companies").doc(companyId).update({
              "billing.status": "expired",
              "billing.expiredAt": FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            });

            // 管理者に通知メール
            const usersSnapshot = await db
              .collection("companies")
              .doc(companyId)
              .collection("users")
              .where("role", "==", "admin")
              .limit(1)
              .get();
            const adminEmail = usersSnapshot.docs[0]?.data()?.email;

            if (adminEmail) {
              await sendTrialExpiredNotification({
                to: adminEmail,
                companyName,
              });
            }
          }
        }
      }

      // ========================================
      // 2. 通常課金処理（課金日が今日の企業）
      // ========================================
      console.log(`課金日チェック（${today}日）...`);

      // 今日が課金日の企業を取得
      const billingCompaniesSnapshot = await db
        .collection("companies")
        .where("billing.status", "==", "active")
        .where("billing.paymentMethod", "==", "card")
        .where("billing.billingDay", "==", today)
        .get();

      console.log(`課金対象企業: ${billingCompaniesSnapshot.size}社`);

      let successCount = 0;
      let failCount = 0;
      let skipCount = 0;

      for (const companyDoc of billingCompaniesSnapshot.docs) {
        const companyId = companyDoc.id;
        const companyData = companyDoc.data();
        const companyName = companyData.companyName || "不明";

        // テスト企業（00000000）は自動課金処理から除外
        if (companyData.companyCode === "00000000") {
          console.log(`スキップ: ${companyName} (テスト企業)`);
          skipCount++;
          continue;
        }

        // 既にこの月の課金が完了している場合はスキップ
        const existingBilling = await db
          .collection("companies")
          .doc(companyId)
          .collection("billingHistory")
          .where("billingMonth", "==", billingMonth)
          .where("status", "==", "success")
          .limit(1)
          .get();

        if (!existingBilling.empty) {
          console.log(`スキップ: ${companyName} (${billingMonth}は課金済み)`);
          skipCount++;
          continue;
        }

        try {
          await executeCompanyBilling({
            companyId,
            companyData,
            payjp,
            billingMonth,
            isRetry: false,
          });
          successCount++;
        } catch (chargeError) {
          console.error(`課金失敗: ${companyName}`, chargeError.message);

          // 管理者メールを取得
          const usersSnapshot = await db
            .collection("companies")
            .doc(companyId)
            .collection("users")
            .where("role", "==", "admin")
            .limit(1)
            .get();
          const adminEmail = usersSnapshot.docs[0]?.data()?.email;

          await handleBillingFailure({
            companyId,
            companyData,
            billingMonth,
            errorMessage: chargeError.message,
            adminEmail,
          });
          failCount++;
        }
      }

      // ========================================
      // 3. リトライ処理
      // ========================================
      console.log("リトライ処理...");

      const pastDueCompaniesSnapshot = await db
        .collection("companies")
        .where("billing.status", "==", "past_due")
        .get();

      for (const companyDoc of pastDueCompaniesSnapshot.docs) {
        const companyId = companyDoc.id;
        const companyData = companyDoc.data();
        const companyName = companyData.companyName || "不明";
        const nextRetryDate = companyData.billing?.nextRetryDate?.toDate?.();

        // テスト企業（企業コード10000000以下）は自動課金処理から除外
        const companyCodeNum = parseInt(companyData.companyCode, 10);
        if (!isNaN(companyCodeNum) && companyCodeNum <= 10000000) {
          console.log(`スキップ: ${companyName} (テスト企業: ${companyData.companyCode})`);
          continue;
        }

        if (!nextRetryDate) continue;

        // リトライ日を過ぎているか
        if (jst >= nextRetryDate) {
          console.log(`リトライ実行: ${companyName}`);

          try {
            await executeCompanyBilling({
              companyId,
              companyData,
              payjp,
              billingMonth,
              isRetry: true,
            });
            console.log(`リトライ成功: ${companyName}`);
          } catch (chargeError) {
            console.error(`リトライ失敗: ${companyName}`, chargeError.message);

            // 管理者メールを取得
            const usersSnapshot = await db
              .collection("companies")
              .doc(companyId)
              .collection("users")
              .where("role", "==", "admin")
              .limit(1)
              .get();
            const adminEmail = usersSnapshot.docs[0]?.data()?.email;

            await handleBillingFailure({
              companyId,
              companyData,
              billingMonth,
              errorMessage: chargeError.message,
              adminEmail,
            });
          }
        }
      }

      console.log(`日次課金処理完了 - 成功: ${successCount}, 失敗: ${failCount}, スキップ: ${skipCount}`);
    } catch (error) {
      console.error("日次課金処理エラー:", error);
    }
  }
);

/**
 * トライアル期限切れ通知メールを送信
 * @param {Object} params - パラメータ
 */
async function sendTrialExpiredNotification(params) {
  const { to, companyName } = params;

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM;

  if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
    console.warn("SMTP設定が未設定のため通知メール送信をスキップしました");
    return;
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
${companyName} 様

無料トライアル期間が終了しました。

サービスを継続してご利用いただくには、クレジットカードの登録が必要です。

━━━━━━━━━━━━━━━━━━━━━━
■ 継続利用の手順
━━━━━━━━━━━━━━━━━━━━━━

1. 管理画面にログイン
2. 「自社情報設定」→「決済情報」タブを開く
3. クレジットカード情報を登録

カード登録後、すべての機能がご利用いただけます。

━━━━━━━━━━━━━━━━━━━━━━
■ 料金プラン
━━━━━━━━━━━━━━━━━━━━━━

基本料金: ¥1,200/月（3名まで）
追加料金: ¥300/人/月（4人目以降）

※作業員権限のユーザーは課金対象外です

━━━━━━━━━━━━━━━━━━━━━━

ご不明な点がございましたら、お気軽にお問い合わせください。

今後とも労務管理システムをよろしくお願いいたします。
`.trim();

  await transporter.sendMail({
    from: `"労務管理システム" <${smtpFrom}>`,
    to,
    subject: "【労務管理システム】無料トライアル終了のお知らせ",
    text: mailBody,
  });
}

/**
 * 旧monthlyBilling関数（互換性のため残す - 実際はdailyBillingProcessorを使用）
 * @deprecated dailyBillingProcessorを使用してください
 */
exports.monthlyBilling = onSchedule(
  {
    schedule: "0 9 1 * *", // 毎月1日 09:00（旧スケジュール、互換性のため）
    timeZone: "Asia/Tokyo",
    region: "asia-northeast1",
  },
  async () => {
    console.log("monthlyBilling is deprecated. Use dailyBillingProcessor instead.");
    // 何もしない（dailyBillingProcessorが処理）
  }
);

/**
 * 手動課金実行（管理者用・テスト用）
 */
exports.executeBilling = onCall(
  { region: "asia-northeast1", maxInstances: 10, secrets: [payjpSecretKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { companyId, testMode } = request.data;
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
      const companyRef = db.collection("companies").doc(companyId);
      const companySnap = await companyRef.get();

      if (!companySnap.exists) {
        throw new HttpsError("not-found", "企業が見つかりません");
      }

      const companyData = companySnap.data();
      const payjpCustomerId = companyData.billing?.payjpCustomerId;

      if (!payjpCustomerId) {
        throw new HttpsError("failed-precondition", "カード情報が登録されていません");
      }

      // アクティブなユーザー数を取得
      const usersSnapshot = await db
        .collection("companies")
        .doc(companyId)
        .collection("users")
        .where("isActive", "==", true)
        .where("role", "in", ["admin", "office", "manager", "site_manager"])
        .get();

      const userCount = usersSnapshot.size;
      const amount = calculateBillingAmount(userCount);

      const jst = toJST(new Date());
      const billingMonth = `${jst.getFullYear()}-${String(jst.getMonth() + 1).padStart(2, "0")}`;

      // テストモードの場合は課金を実行せずに情報のみ返す
      if (testMode) {
        return {
          success: true,
          testMode: true,
          userCount,
          amount,
          billingMonth,
          message: `テストモード: ${userCount}人 × 料金計算 = ¥${amount}`,
        };
      }

      const payjp = getPayjp();

      // PAY.JPで課金実行
      const charge = await payjp.charges.create({
        amount: amount,
        currency: "jpy",
        customer: payjpCustomerId,
        description: `${companyData.companyName} - ${billingMonth}月額利用料（手動）`,
        metadata: {
          companyId: companyId,
          billingMonth: billingMonth,
          userCount: String(userCount),
          manual: "true",
        },
      });

      // 課金履歴を保存
      await db
        .collection("companies")
        .doc(companyId)
        .collection("billingHistory")
        .add({
          billingMonth: billingMonth,
          amount: amount,
          userCount: userCount,
          chargeId: charge.id,
          status: "success",
          manual: true,
          paidAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        });

      // 企業の最終課金日を更新
      await companyRef.update({
        "billing.lastBilledAt": FieldValue.serverTimestamp(),
        "billing.lastBilledAmount": amount,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // 管理者のメールアドレスを取得
      const adminUser = usersSnapshot.docs.find((doc) => doc.data().role === "admin");
      const adminEmail = adminUser?.data()?.email;

      // 領収書を生成・送信
      const receiptResult = await processReceiptAfterCharge({
        companyId,
        companyName: companyData.companyName,
        adminEmail,
        amount,
        userCount,
        billingMonth,
        chargeId: charge.id,
      });

      return {
        success: true,
        chargeId: charge.id,
        amount,
        userCount,
        billingMonth,
        receiptNumber: receiptResult?.receiptNumber,
        receiptUrl: receiptResult?.receiptUrl,
      };
    } catch (error) {
      console.error("手動課金エラー:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", `課金に失敗しました: ${error.message}`);
    }
  }
);

/**
 * 課金履歴を取得
 */
exports.getBillingHistory = onCall(
  { region: "asia-northeast1", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { companyId, limit: limitParam } = request.data;
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
      const historySnapshot = await db
        .collection("companies")
        .doc(companyId)
        .collection("billingHistory")
        .orderBy("createdAt", "desc")
        .limit(limitParam || 12)
        .get();

      const history = historySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null,
        paidAt: doc.data().paidAt?.toDate?.()?.toISOString() || null,
      }));

      return { history };
    } catch (error) {
      console.error("課金履歴取得エラー:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "課金履歴の取得に失敗しました");
    }
  }
);

/**
 * 現在の料金を計算（プレビュー用）
 */
exports.calculateCurrentBilling = onCall(
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
      // アクティブなユーザー数を取得
      const usersSnapshot = await db
        .collection("companies")
        .doc(companyId)
        .collection("users")
        .where("isActive", "==", true)
        .where("role", "in", ["admin", "office", "manager", "site_manager"])
        .get();

      const userCount = usersSnapshot.size;
      const amount = calculateBillingAmount(userCount);
      const additionalUsers = Math.max(0, userCount - PRICING.FREE_USER_COUNT);

      return {
        userCount,
        amount,
        breakdown: {
          basePrice: PRICING.BASE_PRICE,
          additionalUsers,
          additionalAmount: additionalUsers * PRICING.ADDITIONAL_PRICE_PER_USER,
        },
        pricing: PRICING,
      };
    } catch (error) {
      console.error("料金計算エラー:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "料金の計算に失敗しました");
    }
  }
);

/**
 * 課金ステータスを取得
 */
exports.getBillingStatus = onCall(
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
      const companySnap = await db.collection("companies").doc(companyId).get();

      if (!companySnap.exists) {
        throw new HttpsError("not-found", "企業が見つかりません");
      }

      const companyData = companySnap.data();
      const billing = companyData.billing || {};

      // 機能制限フラグを計算
      const isRestricted = ["expired", "suspended"].includes(billing.status);

      // トライアル残り日数を計算
      let trialDaysRemaining = null;
      if (billing.status === "trial" && billing.trialEndDate) {
        const trialEndDate = billing.trialEndDate.toDate();
        const now = new Date();
        const diffTime = trialEndDate - now;
        trialDaysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
      }

      // 次回課金日
      let nextBillingDateStr = null;
      if (billing.nextBillingDate) {
        const nextDate = billing.nextBillingDate.toDate();
        nextBillingDateStr = `${nextDate.getFullYear()}/${nextDate.getMonth() + 1}/${nextDate.getDate()}`;
      }

      return {
        status: billing.status || "trial",
        paymentMethod: billing.paymentMethod,
        cardLast4: billing.cardLast4,
        cardBrand: billing.cardBrand,
        billingDay: billing.billingDay,
        nextBillingDate: nextBillingDateStr,
        trialDaysRemaining,
        retryCount: billing.retryCount || 0,
        isRestricted,
        statusLabel: getStatusLabel(billing.status),
      };
    } catch (error) {
      console.error("課金ステータス取得エラー:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "課金ステータスの取得に失敗しました");
    }
  }
);

/**
 * ステータスラベルを取得
 * @param {string} status - ステータス
 * @returns {string} - ラベル
 */
function getStatusLabel(status) {
  const labels = {
    trial: "無料トライアル中",
    active: "有効",
    past_due: "支払い遅延",
    expired: "トライアル終了",
    suspended: "サービス停止中",
    canceled: "解約済み",
  };
  return labels[status] || "不明";
}

/**
 * 日次課金処理のテスト実行（管理者用）
 * 特定企業に対して日次課金処理をシミュレート実行します。
 * - トライアル終了処理
 * - 通常課金処理
 * - リトライ処理
 * をステータスに応じて実行します。
 */
exports.testDailyBilling = onCall(
  { region: "asia-northeast1", maxInstances: 10, secrets: [payjpSecretKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "認証が必要です");
    }

    const { companyId, forceProcess } = request.data;
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
      const companyRef = db.collection("companies").doc(companyId);
      const companySnap = await companyRef.get();

      if (!companySnap.exists) {
        throw new HttpsError("not-found", "企業が見つかりません");
      }

      const companyData = companySnap.data();
      const companyName = companyData.companyName || "不明";
      const billing = companyData.billing || {};
      const status = billing.status || "trial";

      const jst = toJST(new Date());
      const billingMonth = `${jst.getFullYear()}-${String(jst.getMonth() + 1).padStart(2, "0")}`;

      const result = {
        companyName,
        previousStatus: status,
        billingMonth,
        action: null,
        success: false,
        details: {},
      };

      const payjp = getPayjp();

      // ========================================
      // ケース1: トライアル中
      // ========================================
      if (status === "trial") {
        const payjpCustomerId = billing.payjpCustomerId;

        if (payjpCustomerId) {
          // カード登録済み → 初回課金を実行
          result.action = "trial_end_with_card";

          const billingDay = calculateBillingDay(jst);

          try {
            const chargeResult = await executeCompanyBilling({
              companyId,
              companyData: {
                ...companyData,
                billing: { ...billing, billingDay },
              },
              payjp,
              billingMonth,
              isRetry: false,
            });

            // 課金日を保存
            await companyRef.update({
              "billing.billingDay": billingDay,
            });

            result.success = true;
            result.details = {
              chargeId: chargeResult.chargeId,
              amount: chargeResult.amount,
              billingDay,
              message: `トライアル終了 → 初回課金成功 (¥${chargeResult.amount})`,
            };
          } catch (chargeError) {
            // 管理者メールを取得
            const usersSnapshot = await db
              .collection("companies")
              .doc(companyId)
              .collection("users")
              .where("role", "==", "admin")
              .limit(1)
              .get();
            const adminEmail = usersSnapshot.docs[0]?.data()?.email;

            await handleBillingFailure({
              companyId,
              companyData: { ...companyData, billing: { ...billing, billingDay } },
              billingMonth,
              errorMessage: chargeError.message,
              adminEmail,
            });

            // 課金日を保存
            await companyRef.update({
              "billing.billingDay": billingDay,
            });

            result.success = false;
            result.details = {
              error: chargeError.message,
              billingDay,
              message: "トライアル終了 → 初回課金失敗（リトライ待ち）",
            };
          }
        } else {
          // カード未登録 → 機能制限
          result.action = "trial_end_no_card";

          await companyRef.update({
            "billing.status": "expired",
            "billing.expiredAt": FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });

          // 管理者に通知メール
          const usersSnapshot = await db
            .collection("companies")
            .doc(companyId)
            .collection("users")
            .where("role", "==", "admin")
            .limit(1)
            .get();
          const adminEmail = usersSnapshot.docs[0]?.data()?.email;

          if (adminEmail) {
            await sendTrialExpiredNotification({
              to: adminEmail,
              companyName,
            });
          }

          result.success = true;
          result.details = {
            newStatus: "expired",
            message: "トライアル終了（カード未登録）→ 機能制限",
          };
        }
      }
      // ========================================
      // ケース2: アクティブ（通常課金）
      // ========================================
      else if (status === "active") {
        result.action = "monthly_billing";

        const payjpCustomerId = billing.payjpCustomerId;
        if (!payjpCustomerId) {
          throw new HttpsError("failed-precondition", "カード情報が登録されていません");
        }

        // 既にこの月の課金が完了している場合はスキップ（forceProcessでオーバーライド可能）
        if (!forceProcess) {
          const existingBilling = await db
            .collection("companies")
            .doc(companyId)
            .collection("billingHistory")
            .where("billingMonth", "==", billingMonth)
            .where("status", "==", "success")
            .limit(1)
            .get();

          if (!existingBilling.empty) {
            result.success = true;
            result.details = {
              message: `${billingMonth}は既に課金済みです（forceProcess: trueで強制実行可能）`,
              skipped: true,
            };
            return result;
          }
        }

        try {
          const chargeResult = await executeCompanyBilling({
            companyId,
            companyData,
            payjp,
            billingMonth,
            isRetry: false,
          });

          result.success = true;
          result.details = {
            chargeId: chargeResult.chargeId,
            amount: chargeResult.amount,
            message: `月次課金成功 (¥${chargeResult.amount})`,
          };
        } catch (chargeError) {
          // 管理者メールを取得
          const usersSnapshot = await db
            .collection("companies")
            .doc(companyId)
            .collection("users")
            .where("role", "==", "admin")
            .limit(1)
            .get();
          const adminEmail = usersSnapshot.docs[0]?.data()?.email;

          await handleBillingFailure({
            companyId,
            companyData,
            billingMonth,
            errorMessage: chargeError.message,
            adminEmail,
          });

          result.success = false;
          result.details = {
            error: chargeError.message,
            message: "月次課金失敗 → リトライ待ち（past_due）",
          };
        }
      }
      // ========================================
      // ケース3: 支払い遅延（リトライ）
      // ========================================
      else if (status === "past_due") {
        result.action = "retry_billing";

        try {
          const chargeResult = await executeCompanyBilling({
            companyId,
            companyData,
            payjp,
            billingMonth,
            isRetry: true,
          });

          result.success = true;
          result.details = {
            chargeId: chargeResult.chargeId,
            amount: chargeResult.amount,
            message: `リトライ課金成功 (¥${chargeResult.amount})`,
          };
        } catch (chargeError) {
          // 管理者メールを取得
          const usersSnapshot = await db
            .collection("companies")
            .doc(companyId)
            .collection("users")
            .where("role", "==", "admin")
            .limit(1)
            .get();
          const adminEmail = usersSnapshot.docs[0]?.data()?.email;

          await handleBillingFailure({
            companyId,
            companyData,
            billingMonth,
            errorMessage: chargeError.message,
            adminEmail,
          });

          result.success = false;
          result.details = {
            error: chargeError.message,
            retryCount: (billing.retryCount || 0) + 1,
            message: "リトライ課金失敗",
          };
        }
      }
      // ========================================
      // ケース4: その他のステータス
      // ========================================
      else {
        result.action = "no_action";
        result.success = true;
        result.details = {
          message: `ステータス「${getStatusLabel(status)}」では課金処理は実行されません`,
        };
      }

      return result;
    } catch (error) {
      console.error("テスト課金処理エラー:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", `テスト実行に失敗しました: ${error.message}`);
    }
  }
);
