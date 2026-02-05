import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';
import { DEFAULT_EMPLOYMENT_TYPES } from '../constants/employmentTypes';

/**
 * 会社の雇用形態設定を取得するフック
 * 未設定の場合はデフォルト値を返す
 */
export function useEmploymentTypes() {
  const { companyId } = useAuth();
  const [employmentTypes, setEmploymentTypes] = useState(DEFAULT_EMPLOYMENT_TYPES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      return;
    }

    const docRef = doc(db, 'companies', companyId);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.employmentTypes && Array.isArray(data.employmentTypes) && data.employmentTypes.length > 0) {
          setEmploymentTypes(data.employmentTypes);
        } else {
          setEmploymentTypes(DEFAULT_EMPLOYMENT_TYPES);
        }
      } else {
        setEmploymentTypes(DEFAULT_EMPLOYMENT_TYPES);
      }
      setLoading(false);
    }, (error) => {
      console.error('雇用形態の取得に失敗しました:', error);
      setEmploymentTypes(DEFAULT_EMPLOYMENT_TYPES);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [companyId]);

  return { employmentTypes, loading };
}
