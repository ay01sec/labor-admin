// src/contexts/AuthContext.jsx
import { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  sendEmailVerification,
  multiFactor,
  getMultiFactorResolver,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  TotpMultiFactorGenerator,
  RecaptchaVerifier
} from 'firebase/auth';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp
} from 'firebase/firestore';
import { auth, db, functions } from '../services/firebase';
import { httpsCallable } from 'firebase/functions';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [companyId, setCompanyId] = useState(null);
  const [companyInfo, setCompanyInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  // MFA関連の状態
  const [mfaResolver, setMfaResolver] = useState(null);
  const [pendingCompany, setPendingCompany] = useState(null);
  const [recaptchaVerifier, setRecaptchaVerifier] = useState(null);

  // カスタム2FA関連の状態
  const [requires2FA, setRequires2FA] = useState(false);
  const [pending2FAUser, setPending2FAUser] = useState(null);
  const [pending2FACompany, setPending2FACompany] = useState(null);
  const [twoFAVerified, setTwoFAVerified] = useState(false);
  const is2FAPendingRef = useRef(false); // refでも追跡
  const loginInProgressRef = useRef(false); // ログイン処理中フラグ（ref）
  const [loginInProgress, setLoginInProgress] = useState(false); // ログイン処理中フラグ（state - ルーティング用）
  const [twoFACodeSent, setTwoFACodeSent] = useState(false); // コード送信済み
  const [twoFADevCode, setTwoFADevCode] = useState(null); // 開発用コード

  // 企業コードで企業を検索（未認証でも可能）
  async function findCompanyByCode(companyCode) {
    const companiesRef = collection(db, 'companies');
    const q = query(companiesRef, where('companyCode', '==', companyCode));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      throw new Error('企業IDが見つかりません');
    }

    const companyDoc = snapshot.docs[0];
    return {
      id: companyDoc.id,
      ...companyDoc.data()
    };
  }

  // 企業コード + メールアドレス + パスワードでログイン
  async function login(companyCode, email, password) {
    // ログイン処理開始（onAuthStateChangedの干渉を防ぐ）
    loginInProgressRef.current = true;
    setLoginInProgress(true);
    console.log('Login started, loginInProgress set to true');

    try {
      // 1. 先に企業コードで企業を検索（未認証状態で検証）
      const company = await findCompanyByCode(companyCode);

      // 2. Firebase Authenticationでログイン
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // 3. ログイン後の処理
      return await completeLogin(user, company);
    } catch (error) {
      // MFA認証が必要な場合
      if (error.code === 'auth/multi-factor-auth-required') {
        const resolver = getMultiFactorResolver(auth, error);
        setMfaResolver(resolver);
        setPendingCompany(company);
        // MFA必要フラグを含むエラーを投げる
        const mfaError = new Error('MFA認証が必要です');
        mfaError.code = 'mfa-required';
        mfaError.resolver = resolver;
        throw mfaError;
      }
      // 2FAエラーの場合はフラグを維持（Login.jsxで処理継続）
      if (error.code === 'custom-2fa-required') {
        throw error;
      }
      // その他のエラーの場合はフラグをリセット
      loginInProgressRef.current = false;
      setLoginInProgress(false);
      throw error;
    }
  }

  // ログイン完了処理（通常ログインとMFA後の両方で使用）
  async function completeLogin(user, company) {
    try {
      // その企業にユーザーが存在するか確認
      const userDocRef = doc(db, 'companies', company.id, 'users', user.uid);
      const userDocSnap = await getDoc(userDocRef);

      if (!userDocSnap.exists()) {
        await signOut(auth);
        throw new Error('この企業IDに登録されていないユーザーです');
      }

      const userData = userDocSnap.data();

      if (!userData.isActive) {
        await signOut(auth);
        throw new Error('このアカウントは無効化されています');
      }

      // 管理画面はadmin/office（manager互換）のみアクセス可能
      if (!['admin', 'office', 'manager'].includes(userData.role)) {
        await signOut(auth);
        throw new Error('管理画面へのアクセス権限がありません');
      }

      // 最終ログイン日時を更新
      await updateDoc(userDocRef, {
        lastLoginAt: serverTimestamp()
      });

      // 管理者の場合は2FA認証を要求（企業コード00000000は除外）
      if (needs2FA(userData) && company.companyCode !== '00000000') {
        const pending2FAData = {
          user: { id: user.uid, ...userData },
          company: company
        };
        is2FAPendingRef.current = true; // refを先に更新
        setPending2FAUser(pending2FAData.user);
        setPending2FACompany(pending2FAData.company);
        setRequires2FA(true);

        // 2FA必要エラーを投げる（データを含める）
        const twoFAError = new Error('2段階認証が必要です');
        twoFAError.code = 'custom-2fa-required';
        twoFAError.pending2FAData = pending2FAData;
        throw twoFAError;
      }

      // 2FA不要の場合は通常通りログイン完了
      setCompanyId(company.id);
      setCompanyInfo(company);
      setUserInfo({
        id: user.uid,
        ...userData
      });

      // 企業コードをローカルストレージに保存
      localStorage.setItem('lastCompanyCode', company.companyCode);

      // MFA状態をクリア
      setMfaResolver(null);
      setPendingCompany(null);

      return user;
    } catch (error) {
      // 2FAエラーの場合はログアウトしない
      if (error.code === 'custom-2fa-required') {
        throw error;
      }
      await signOut(auth);
      throw error;
    }
  }

  // MFA: SMS認証コード送信
  async function sendMfaSmsCode(phoneHint, recaptchaVerifier) {
    if (!mfaResolver) throw new Error('MFAセッションがありません');

    const phoneAuthProvider = new PhoneAuthProvider(auth);
    const verificationId = await phoneAuthProvider.verifyPhoneNumber({
      multiFactorHint: phoneHint,
      session: mfaResolver.session
    }, recaptchaVerifier);

    return verificationId;
  }

  // MFA: SMS認証コードで認証完了
  async function verifyMfaSmsCode(verificationId, verificationCode) {
    if (!mfaResolver || !pendingCompany) throw new Error('MFAセッションがありません');

    const credential = PhoneAuthProvider.credential(verificationId, verificationCode);
    const assertion = PhoneMultiFactorGenerator.assertion(credential);
    const userCredential = await mfaResolver.resolveSignIn(assertion);

    return await completeLogin(userCredential.user, pendingCompany);
  }

  // MFA: TOTP認証コードで認証完了
  async function verifyMfaTotpCode(factorUid, verificationCode) {
    if (!mfaResolver || !pendingCompany) throw new Error('MFAセッションがありません');

    const assertion = TotpMultiFactorGenerator.assertionForSignIn(factorUid, verificationCode);
    const userCredential = await mfaResolver.resolveSignIn(assertion);

    return await completeLogin(userCredential.user, pendingCompany);
  }

  // MFA: SMS登録用コード送信
  async function enrollSmsMfa(phoneNumber, recaptchaVerifier) {
    if (!currentUser) throw new Error('ログインが必要です');

    const session = await multiFactor(currentUser).getSession();
    const phoneAuthProvider = new PhoneAuthProvider(auth);
    const verificationId = await phoneAuthProvider.verifyPhoneNumber({
      phoneNumber,
      session
    }, recaptchaVerifier);

    return verificationId;
  }

  // MFA: SMS登録完了
  async function completeSmsMfaEnrollment(verificationId, verificationCode, displayName = 'SMS認証') {
    if (!currentUser) throw new Error('ログインが必要です');

    const credential = PhoneAuthProvider.credential(verificationId, verificationCode);
    const assertion = PhoneMultiFactorGenerator.assertion(credential);
    await multiFactor(currentUser).enroll(assertion, displayName);
  }

  // MFA: TOTP登録開始（シークレット生成）
  async function startTotpEnrollment() {
    if (!currentUser) throw new Error('ログインが必要です');

    const session = await multiFactor(currentUser).getSession();
    const totpSecret = await TotpMultiFactorGenerator.generateSecret(session);

    return totpSecret;
  }

  // MFA: TOTP登録完了
  async function completeTotpEnrollment(totpSecret, verificationCode, displayName = '認証アプリ') {
    if (!currentUser) throw new Error('ログインが必要です');

    const assertion = TotpMultiFactorGenerator.assertionForEnrollment(totpSecret, verificationCode);
    await multiFactor(currentUser).enroll(assertion, displayName);
  }

  // MFA: 登録済みMFA一覧取得
  function getEnrolledMfaFactors() {
    if (!currentUser) return [];
    return multiFactor(currentUser).enrolledFactors;
  }

  // MFA: MFA登録解除
  async function unenrollMfa(factorUid) {
    if (!currentUser) throw new Error('ログインが必要です');

    const factors = multiFactor(currentUser).enrolledFactors;
    const factor = factors.find(f => f.uid === factorUid);
    if (factor) {
      await multiFactor(currentUser).unenroll(factor);
    }
  }

  // MFA: 管理者の2FA必須チェック
  // TODO: 本番環境では true を返すように修正する
  function requiresMfaSetup() {
    // 一時的に無効化（TOTP設定完了後に有効化する）
    return false;

    // if (!userInfo || !currentUser) return false;
    // // 管理者で2FA未設定の場合はtrue
    // if (userInfo.role === 'admin') {
    //   const factors = multiFactor(currentUser).enrolledFactors;
    //   return factors.length === 0;
    // }
    // return false;
  }

  // メール確認メールを送信
  async function sendVerificationEmail() {
    if (!currentUser) throw new Error('ログインが必要です');
    await sendEmailVerification(currentUser);
  }

  // メールが確認済みかチェック
  function isEmailVerified() {
    return currentUser?.emailVerified ?? false;
  }

  // カスタム2FA: コード送信
  async function send2FACode(companyIdOverride = null) {
    const companyId = companyIdOverride || pending2FACompany?.id;
    if (!companyId) {
      throw new Error('2FA認証セッションがありません');
    }
    const send2FACodeFn = httpsCallable(functions, 'send2FACode');
    const result = await send2FACodeFn({ companyId });

    // コンテキストに状態を保存
    setTwoFACodeSent(true);
    if (result.data.devCode) {
      setTwoFADevCode(result.data.devCode);
    }

    return result.data;
  }

  // カスタム2FA: コード検証
  async function verify2FACode(code) {
    if (!pending2FAUser || !pending2FACompany) {
      throw new Error('2FA認証セッションがありません');
    }
    const verify2FACodeFn = httpsCallable(functions, 'verify2FACode');
    await verify2FACodeFn({ code });

    // 検証成功 - ログイン完了処理
    loginInProgressRef.current = false; // ログイン処理完了
    setLoginInProgress(false);
    is2FAPendingRef.current = false; // refをリセット
    setTwoFAVerified(true);
    setRequires2FA(false);
    setTwoFACodeSent(false); // コード送信状態もリセット
    setTwoFADevCode(null);

    // ユーザー情報を設定
    setCompanyId(pending2FACompany.id);
    setCompanyInfo(pending2FACompany);
    setUserInfo(pending2FAUser);

    // 企業コードをローカルストレージに保存
    localStorage.setItem('lastCompanyCode', pending2FACompany.companyCode);

    // pending状態をクリア
    setPending2FAUser(null);
    setPending2FACompany(null);

    return true;
  }

  // カスタム2FA: キャンセル（ログアウト）
  async function cancel2FA() {
    loginInProgressRef.current = false; // ログイン処理終了
    setLoginInProgress(false);
    is2FAPendingRef.current = false; // refをリセット
    setPending2FAUser(null);
    setPending2FACompany(null);
    setRequires2FA(false);
    setTwoFACodeSent(false);
    setTwoFADevCode(null);
    await signOut(auth);
  }

  // 2FA が必要かチェック（管理者のみ）
  function needs2FA(userData) {
    return userData?.role === 'admin';
  }

  // パスワードリセットメールを送信
  async function resetPassword(email) {
    await sendPasswordResetEmail(auth, email);
  }

  // ログアウト
  async function logout() {
    setUserInfo(null);
    setCompanyId(null);
    setCompanyInfo(null);
    await signOut(auth);
  }

  // ユーザー情報を取得（セッション復元用）
  async function fetchUserInfo(uid) {
    try {
      const companiesRef = collection(db, 'companies');
      const companiesSnapshot = await getDocs(companiesRef);

      for (const companyDoc of companiesSnapshot.docs) {
        const userDocRef = doc(db, 'companies', companyDoc.id, 'users', uid);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
          const userData = userDocSnap.data();

          if (!userData.isActive) {
            throw new Error('このアカウントは無効化されています');
          }

          // 管理画面はadmin/office（manager互換）のみ
          if (!['admin', 'office', 'manager'].includes(userData.role)) {
            throw new Error('管理画面へのアクセス権限がありません');
          }

          await updateDoc(userDocRef, {
            lastLoginAt: serverTimestamp()
          });

          setCompanyId(companyDoc.id);
          setCompanyInfo({
            id: companyDoc.id,
            ...companyDoc.data()
          });
          setUserInfo({
            id: uid,
            ...userData
          });

          return {
            companyId: companyDoc.id,
            companyInfo: companyDoc.data(),
            userInfo: userData
          };
        }
      }

      throw new Error('ユーザー情報が見つかりません');
    } catch (error) {
      console.error('ユーザー情報取得エラー:', error);
      throw error;
    }
  }

  // 管理者かどうか
  function isAdmin() {
    return userInfo?.role === 'admin';
  }

  // 事務員以上かどうか（管理システムアクセス可能）
  // manager（旧名称）との互換性を維持
  function isOfficeOrAbove() {
    return ['admin', 'office', 'manager'].includes(userInfo?.role);
  }

  // 現場管理者以上かどうか（日報アプリ使用可能）
  function isSiteManagerOrAbove() {
    return ['admin', 'office', 'manager', 'site_manager'].includes(userInfo?.role);
  }

  // マネージャー以上かどうか（後方互換性のため残す）
  function isManagerOrAbove() {
    return isOfficeOrAbove();
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log('onAuthStateChanged fired, user:', !!user, 'loginInProgress:', loginInProgressRef.current, 'is2FAPending:', is2FAPendingRef.current);
      setCurrentUser(user);

      if (user) {
        // ログイン処理中または2FA認証待ちの場合はfetchUserInfoをスキップ
        // ログイン処理中はloadingもそのまま（login関数で制御）
        if (loginInProgressRef.current) {
          console.log('Login in progress, skipping fetchUserInfo and keeping loading state');
          return; // loadingをfalseにしない
        }

        if (is2FAPendingRef.current) {
          console.log('2FA pending, skipping fetchUserInfo');
          setLoading(false);
          return;
        }

        try {
          await fetchUserInfo(user.uid);
        } catch (error) {
          console.error('ユーザー情報の取得に失敗:', error);
          await logout();
        }
      }

      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const value = {
    currentUser,
    userInfo,
    companyId,
    companyInfo,
    login,
    logout,
    resetPassword,
    isAdmin,
    isOfficeOrAbove,
    isSiteManagerOrAbove,
    isManagerOrAbove,
    loading,
    // MFA関連
    mfaResolver,
    sendMfaSmsCode,
    verifyMfaSmsCode,
    verifyMfaTotpCode,
    enrollSmsMfa,
    completeSmsMfaEnrollment,
    startTotpEnrollment,
    completeTotpEnrollment,
    getEnrolledMfaFactors,
    unenrollMfa,
    requiresMfaSetup,
    sendVerificationEmail,
    isEmailVerified,
    // カスタム2FA関連
    requires2FA,
    pending2FAUser,
    send2FACode,
    verify2FACode,
    cancel2FA,
    twoFACodeSent,
    twoFADevCode,
    loginInProgress
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}
