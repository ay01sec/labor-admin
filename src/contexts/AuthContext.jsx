// src/contexts/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import { 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
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

  // ログイン
  async function login(email, password) {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return userCredential.user;
  }

  // ログアウト
  async function logout() {
    setUserInfo(null);
    setCompanyId(null);
    setCompanyInfo(null);
    await signOut(auth);
  }

  // ユーザー情報を取得（どの企業に所属しているか）
  async function fetchUserInfo(uid) {
    try {
      // 全企業からこのユーザーを検索
      const companiesRef = collection(db, 'companies');
      const companiesSnapshot = await getDocs(companiesRef);

      for (const companyDoc of companiesSnapshot.docs) {
        const userDocRef = doc(db, 'companies', companyDoc.id, 'users', uid);
        const userDocSnap = await getDoc(userDocRef);
        
        if (userDocSnap.exists()) {
          const userData = userDocSnap.data();
          
          // アカウントが無効な場合
          if (!userData.isActive) {
            throw new Error('このアカウントは無効化されています');
          }

          // 最終ログイン日時を更新
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

  // オペレーター以上かどうか
  function isOperatorOrAbove() {
    return userInfo?.role === 'admin' || userInfo?.role === 'operator';
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
    isAdmin,
    isOperatorOrAbove,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}
