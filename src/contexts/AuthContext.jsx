// src/contexts/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
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
import { auth, db } from '../services/firebase';

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
    // 1. 先に企業コードで企業を検索（未認証状態で検証）
    const company = await findCompanyByCode(companyCode);

    try {
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

      // 管理画面はadmin/managerのみアクセス可能
      if (!['admin', 'manager'].includes(userData.role)) {
        await signOut(auth);
        throw new Error('管理画面へのアクセス権限がありません');
      }

      // 最終ログイン日時を更新
      await updateDoc(userDocRef, {
        lastLoginAt: serverTimestamp()
      });

      // 状態を更新
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
  function requiresMfaSetup() {
    if (!userInfo || !currentUser) return false;
    // 管理者で2FA未設定の場合はtrue
    if (userInfo.role === 'admin') {
      const factors = multiFactor(currentUser).enrolledFactors;
      return factors.length === 0;
    }
    return false;
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

          // 管理画面はadmin/managerのみ
          if (!['admin', 'manager'].includes(userData.role)) {
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

  // マネージャー以上かどうか
  function isManagerOrAbove() {
    return ['admin', 'manager'].includes(userInfo?.role);
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      
      if (user) {
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
    requiresMfaSetup
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}
