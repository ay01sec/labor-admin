import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../contexts/AuthContext';

export function useNotifications() {
  const { companyId } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) return;

    const reportsRef = collection(db, 'companies', companyId, 'dailyReports');

    // submitted + rejected の日報をリアルタイム監視
    const q = query(
      reportsRef,
      where('status', 'in', ['submitted', 'rejected'])
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          type: data.status === 'submitted' ? 'submitted' : 'rejected',
          siteName: data.siteName || '',
          createdByName: data.createdByName || '',
          reportDate: data.reportDate,
          updatedAt: data.updatedAt || data.submittedAt || data.createdAt,
        };
      });

      // 更新日時の降順でソート
      items.sort((a, b) => {
        const dateA = a.updatedAt?.toDate ? a.updatedAt.toDate() : new Date(0);
        const dateB = b.updatedAt?.toDate ? b.updatedAt.toDate() : new Date(0);
        return dateB - dateA;
      });

      setNotifications(items);
      setLoading(false);
    }, (error) => {
      console.error('通知データ取得エラー:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [companyId]);

  const badgeCount = notifications.length;

  return { notifications, badgeCount, loading };
}
