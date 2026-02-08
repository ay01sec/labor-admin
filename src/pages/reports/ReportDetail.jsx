// src/pages/reports/ReportDetail.jsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../services/firebase';
import {
  ArrowLeft,
  FileText,
  Calendar,
  MapPin,
  User,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  QrCode,
  ExternalLink,
  Edit,
  Plus,
  Trash2,
  Save,
  RefreshCw,
} from 'lucide-react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import toast from 'react-hot-toast';

// ステータスバッジ
function StatusBadge({ status }) {
  const config = {
    draft: { label: '下書き', color: 'bg-gray-100 text-gray-600' },
    signed: { label: 'サイン済み', color: 'bg-yellow-100 text-yellow-700' },
    submitted: { label: '送信完了', color: 'bg-blue-100 text-blue-700' },
    approved: { label: '承認済み', color: 'bg-green-100 text-green-700' },
    rejected: { label: '差戻し', color: 'bg-red-100 text-red-700' },
  };

  const { label, color } = config[status] || { label: status, color: 'bg-gray-100 text-gray-600' };

  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${color}`}>
      {label}
    </span>
  );
}

export default function ReportDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { companyId, currentUser, userInfo, isOfficeOrAbove } = useAuth();

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);

  // 編集機能用
  const [showEditModal, setShowEditModal] = useState(false);
  const [editData, setEditData] = useState(null);
  const [saving, setSaving] = useState(false);

  // データ取得
  useEffect(() => {
    if (!companyId || !id) return;

    const fetchReport = async () => {
      try {
        const reportRef = doc(db, 'companies', companyId, 'dailyReports', id);
        const snapshot = await getDoc(reportRef);

        if (snapshot.exists()) {
          setReport({
            id: snapshot.id,
            ...snapshot.data(),
          });
        } else {
          toast.error('日報が見つかりません');
          navigate('/reports');
        }
      } catch (error) {
        console.error('日報取得エラー:', error);
        toast.error('日報の取得に失敗しました');
      } finally {
        setLoading(false);
      }
    };

    fetchReport();
  }, [companyId, id, navigate]);

  // 日付フォーマット
  const formatDate = (timestamp) => {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return format(date, 'yyyy年M月d日(E)', { locale: ja });
  };

  const formatDateTime = (timestamp) => {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return format(date, 'yyyy年M月d日 HH:mm', { locale: ja });
  };

  // 承認処理
  const handleApprove = async () => {
    if (!confirm('この日報を承認しますか？')) return;

    setProcessing(true);
    try {
      const reportRef = doc(db, 'companies', companyId, 'dailyReports', id);
      await updateDoc(reportRef, {
        status: 'approved',
        'approval.approvedBy': currentUser.uid,
        'approval.approvedByName': userInfo?.displayName || userInfo?.email || '',
        'approval.approvedAt': serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setReport((prev) => ({
        ...prev,
        status: 'approved',
        approval: {
          approvedBy: currentUser.uid,
          approvedByName: userInfo?.displayName || userInfo?.email || '',
          approvedAt: new Date(),
        },
      }));

      toast.success('日報を承認しました');
    } catch (error) {
      console.error('承認エラー:', error);
      toast.error('承認に失敗しました');
    } finally {
      setProcessing(false);
    }
  };

  // 差戻し処理
  const handleReject = async () => {
    if (!rejectReason.trim()) {
      toast.error('差戻し理由を入力してください');
      return;
    }

    setProcessing(true);
    try {
      const reportRef = doc(db, 'companies', companyId, 'dailyReports', id);
      await updateDoc(reportRef, {
        status: 'rejected',
        'rejection.rejectedBy': currentUser.uid,
        'rejection.rejectedByName': userInfo?.displayName || userInfo?.email || '',
        'rejection.rejectedAt': serverTimestamp(),
        'rejection.reason': rejectReason,
        // 署名をクリア（再署名が必要）
        'clientSignature.imageUrl': null,
        'clientSignature.signedAt': null,
        'clientSignature.signerName': null,
        updatedAt: serverTimestamp(),
      });

      setReport((prev) => ({
        ...prev,
        status: 'rejected',
        rejection: {
          rejectedBy: currentUser.uid,
          rejectedByName: userInfo?.displayName || userInfo?.email || '',
          rejectedAt: new Date(),
          reason: rejectReason,
        },
        clientSignature: {
          imageUrl: null,
          signedAt: null,
          signerName: null,
        },
      }));

      setShowRejectModal(false);
      setRejectReason('');
      toast.success('日報を差戻しました');
    } catch (error) {
      console.error('差戻しエラー:', error);
      toast.error('差戻しに失敗しました');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!report) {
    return null;
  }

  const canApprove = report.status === 'submitted';
  const canEdit = isOfficeOrAbove && isOfficeOrAbove() && ['approved', 'submitted'].includes(report.status);

  // 編集モーダルを開く
  const openEditModal = () => {
    const reportDate = report.reportDate?.toDate
      ? report.reportDate.toDate()
      : new Date(report.reportDate);

    setEditData({
      reportDate: format(reportDate, 'yyyy-MM-dd'),
      weather: report.weather || '',
      workers: report.workers?.map(w => ({ ...w })) || [],
      notes: report.notes || '',
    });
    setShowEditModal(true);
  };

  // 作業員の追加
  const addWorker = () => {
    setEditData(prev => ({
      ...prev,
      workers: [
        ...prev.workers,
        { name: '', startTime: '08:00', endTime: '17:00', noLunchBreak: false, remarks: '' }
      ]
    }));
  };

  // 作業員の削除
  const removeWorker = (index) => {
    setEditData(prev => ({
      ...prev,
      workers: prev.workers.filter((_, i) => i !== index)
    }));
  };

  // 作業員情報の更新
  const updateWorker = (index, field, value) => {
    setEditData(prev => ({
      ...prev,
      workers: prev.workers.map((w, i) =>
        i === index ? { ...w, [field]: value } : w
      )
    }));
  };

  // 保存してPDF再生成
  const handleSaveAndRegenerate = async () => {
    if (!editData.workers.length) {
      toast.error('作業員を1名以上登録してください');
      return;
    }

    setSaving(true);
    try {
      // 1. Firestoreを更新
      const reportRef = doc(db, 'companies', companyId, 'dailyReports', id);
      await updateDoc(reportRef, {
        reportDate: Timestamp.fromDate(new Date(editData.reportDate)),
        weather: editData.weather,
        workers: editData.workers,
        notes: editData.notes,
        updatedAt: serverTimestamp(),
        lastEditedBy: currentUser.uid,
        lastEditedByName: userInfo?.displayName || userInfo?.email || '',
        lastEditedAt: serverTimestamp(),
      });

      // 2. PDF再生成（承認済みの場合のみ）
      if (report.status === 'approved') {
        const functions = getFunctions(undefined, 'asia-northeast1');
        const regeneratePdf = httpsCallable(functions, 'generateReportPdfWithQR');
        const result = await regeneratePdf({ companyId, reportId: id });

        // ローカルstate更新（PDF URL含む）
        setReport(prev => ({
          ...prev,
          reportDate: Timestamp.fromDate(new Date(editData.reportDate)),
          weather: editData.weather,
          workers: editData.workers,
          notes: editData.notes,
          pdfUrl: result.data.pdfUrl,
          qrCodeUrl: result.data.qrCodeUrl,
        }));

        toast.success('日報を更新し、PDFを再生成しました');
      } else {
        // 送信完了の場合はPDF再生成なし
        setReport(prev => ({
          ...prev,
          reportDate: Timestamp.fromDate(new Date(editData.reportDate)),
          weather: editData.weather,
          workers: editData.workers,
          notes: editData.notes,
        }));

        toast.success('日報を更新しました');
      }

      setShowEditModal(false);
    } catch (error) {
      console.error('保存エラー:', error);
      toast.error('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate('/reports')}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center space-x-2">
            <FileText className="text-blue-500" />
            <span>日報詳細</span>
          </h1>
        </div>
        <div className="flex items-center space-x-3">
          {canEdit && (
            <button
              onClick={openEditModal}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors flex items-center space-x-2"
            >
              <Edit size={18} />
              <span>編集</span>
            </button>
          )}
          <StatusBadge status={report.status} />
        </div>
      </div>

      {/* 承認/差戻しボタン */}
      {canApprove && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <AlertCircle className="text-blue-600" size={20} />
              <span className="font-medium text-blue-800">この日報は承認待ちです</span>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowRejectModal(true)}
                disabled={processing}
                className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 flex items-center space-x-2"
              >
                <XCircle size={18} />
                <span>差戻し</span>
              </button>
              <button
                onClick={handleApprove}
                disabled={processing}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center space-x-2"
              >
                <CheckCircle size={18} />
                <span>承認する</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 承認済み情報 */}
      {report.status === 'approved' && report.approval?.approvedAt && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center space-x-2 text-green-800">
                <CheckCircle size={20} />
                <span className="font-medium">承認済み</span>
              </div>
              <div className="mt-2 text-sm text-green-700">
                <p>承認者: {report.approval.approvedByName}</p>
                <p>承認日時: {formatDateTime(report.approval.approvedAt)}</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              {report.pdfUrl ? (
                <>
                  <a
                    href={report.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2 text-sm"
                  >
                    <ExternalLink size={16} />
                    <span>PDF表示</span>
                  </a>
                  {report.qrCodeUrl && (
                    <button
                      onClick={() => setShowQrModal(true)}
                      className="px-3 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center space-x-2 text-sm"
                    >
                      <QrCode size={16} />
                      <span>QRコード</span>
                    </button>
                  )}
                </>
              ) : (
                <span className="text-sm text-gray-500">
                  PDF/QRは承認時に自動生成されます
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 差戻し情報 */}
      {report.status === 'rejected' && report.rejection?.rejectedAt && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center space-x-2 text-red-800">
            <XCircle size={20} />
            <span className="font-medium">差戻し</span>
          </div>
          <div className="mt-2 text-sm text-red-700">
            <p>差戻し者: {report.rejection.rejectedByName}</p>
            <p>差戻し日時: {formatDateTime(report.rejection.rejectedAt)}</p>
            {report.rejection.reason && (
              <p className="mt-2 p-2 bg-red-100 rounded">
                理由: {report.rejection.reason}
              </p>
            )}
          </div>
        </div>
      )}

      {/* 元請サイン */}
      {report.clientSignature?.imageUrl && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4">元請確認サイン</h2>
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <img
              src={report.clientSignature.imageUrl}
              alt="元請サイン"
              className="max-w-xs mx-auto bg-white rounded border"
            />
            {report.clientSignature.signedAt && (
              <p className="text-center text-sm text-gray-500 mt-2">
                署名日時: {formatDateTime(report.clientSignature.signedAt)}
              </p>
            )}
          </div>
        </div>
      )}

      {/* 基本情報 */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-4">基本情報</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex items-start space-x-3">
            <Calendar className="text-gray-400 mt-1" size={20} />
            <div>
              <p className="text-sm text-gray-500">実施日</p>
              <p className="font-medium">{formatDate(report.reportDate)}</p>
            </div>
          </div>
          <div className="flex items-start space-x-3">
            <MapPin className="text-gray-400 mt-1" size={20} />
            <div>
              <p className="text-sm text-gray-500">現場名</p>
              <p className="font-medium">{report.siteName || '-'}</p>
            </div>
          </div>
          <div className="flex items-start space-x-3">
            <User className="text-gray-400 mt-1" size={20} />
            <div>
              <p className="text-sm text-gray-500">作成者</p>
              <p className="font-medium">{report.createdByName || '-'}</p>
            </div>
          </div>
          <div className="flex items-start space-x-3">
            <Clock className="text-gray-400 mt-1" size={20} />
            <div>
              <p className="text-sm text-gray-500">送信日時</p>
              <p className="font-medium">{formatDateTime(report.submittedAt)}</p>
            </div>
          </div>
          {report.weather && (
            <div className="flex items-start space-x-3">
              <span className="text-xl mt-0.5">
                {{ sunny: '\u2600\uFE0F', cloudy: '\u2601\uFE0F', rainy: '\uD83C\uDF27\uFE0F', snowy: '\u2744\uFE0F' }[report.weather] || report.weather}
              </span>
              <div>
                <p className="text-sm text-gray-500">天候</p>
                <p className="font-medium">
                  {{ sunny: '\u6674\u308C', cloudy: '\u66C7\u308A', rainy: '\u96E8', snowy: '\u96EA' }[report.weather] || report.weather}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 写真 */}
      {report.photos?.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4">
            添付写真 ({report.photos.length}枚)
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {report.photos.map((photo, index) => (
              <a
                key={index}
                href={photo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block aspect-square rounded-lg overflow-hidden bg-gray-100 hover:opacity-80 transition-opacity"
              >
                <img
                  src={photo.url}
                  alt={photo.name || `写真 ${index + 1}`}
                  className="w-full h-full object-cover"
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* 作業員情報 */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-4">
          作業員 ({report.workers?.length || 0}名)
        </h2>
        {report.workers?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    氏名
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    開始時間
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    終了時間
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    昼休憩
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    備考/作業内容
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {report.workers.map((worker, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap font-medium">
                      {worker.name || '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                      {worker.startTime || '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                      {worker.endTime || '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {worker.noLunchBreak ? (
                        <span className="text-orange-600 text-sm">なし</span>
                      ) : (
                        <span className="text-gray-400 text-sm">あり</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-sm">
                      {worker.remarks || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-500">作業員情報がありません</p>
        )}
      </div>

      {/* 連絡事項 */}
      {report.notes && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4">連絡事項</h2>
          <p className="text-gray-700 whitespace-pre-wrap">{report.notes}</p>
        </div>
      )}

      {/* 差戻しモーダル */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl">
            <div className="p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">日報の差戻し</h3>
              <p className="text-sm text-gray-600 mb-4">
                差戻し理由を入力してください。作成者に通知されます。
              </p>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="差戻し理由を入力..."
                rows={4}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 focus:border-red-500"
              />
              <div className="flex justify-end space-x-3 mt-4">
                <button
                  onClick={() => {
                    setShowRejectModal(false);
                    setRejectReason('');
                  }}
                  disabled={processing}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleReject}
                  disabled={processing || !rejectReason.trim()}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {processing ? '処理中...' : '差戻しする'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QRコードモーダル */}
      {showQrModal && report.qrCodeUrl && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm shadow-xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-800">QRコード</h3>
                <button
                  onClick={() => setShowQrModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle size={24} />
                </button>
              </div>
              <div className="flex flex-col items-center">
                <img
                  src={report.qrCodeUrl}
                  alt="QRコード"
                  className="w-64 h-64 border border-gray-200 rounded-lg"
                />
                <p className="text-sm text-gray-500 mt-4 text-center">
                  このQRコードをスキャンすると日報PDFが表示されます
                </p>
                <a
                  href={report.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
                >
                  <ExternalLink size={16} />
                  <span>PDFを開く</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 編集モーダル */}
      {showEditModal && editData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-xl my-8">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-gray-800 flex items-center space-x-2">
                  <Edit size={20} className="text-orange-600" />
                  <span>日報の編集</span>
                </h3>
                <button
                  onClick={() => setShowEditModal(false)}
                  disabled={saving}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle size={24} />
                </button>
              </div>

              {/* 基本情報 */}
              <div className="space-y-4 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      実施日
                    </label>
                    <input
                      type="date"
                      value={editData.reportDate}
                      onChange={(e) => setEditData(prev => ({ ...prev, reportDate: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      天候
                    </label>
                    <select
                      value={editData.weather}
                      onChange={(e) => setEditData(prev => ({ ...prev, weather: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    >
                      <option value="">選択してください</option>
                      <option value="sunny">晴れ</option>
                      <option value="cloudy">曇り</option>
                      <option value="rainy">雨</option>
                      <option value="snowy">雪</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* 作業員情報 */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-gray-700">
                    作業員情報
                  </label>
                  <button
                    type="button"
                    onClick={addWorker}
                    className="text-sm text-orange-600 hover:text-orange-700 flex items-center space-x-1"
                  >
                    <Plus size={16} />
                    <span>作業員を追加</span>
                  </button>
                </div>

                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {editData.workers.map((worker, index) => (
                    <div key={index} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-600">作業員 {index + 1}</span>
                        <button
                          type="button"
                          onClick={() => removeWorker(index)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">氏名</label>
                          <input
                            type="text"
                            value={worker.name || ''}
                            onChange={(e) => updateWorker(index, 'name', e.target.value)}
                            placeholder="氏名"
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-orange-500"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">開始</label>
                            <input
                              type="time"
                              value={worker.startTime || ''}
                              onChange={(e) => updateWorker(index, 'startTime', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-orange-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">終了</label>
                            <input
                              type="time"
                              value={worker.endTime || ''}
                              onChange={(e) => updateWorker(index, 'endTime', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-orange-500"
                            />
                          </div>
                        </div>
                        <div className="flex items-center">
                          <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={worker.noLunchBreak || false}
                              onChange={(e) => updateWorker(index, 'noLunchBreak', e.target.checked)}
                              className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                            />
                            <span className="text-sm text-gray-700">昼休憩なし</span>
                          </label>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">備考</label>
                          <input
                            type="text"
                            value={worker.remarks || ''}
                            onChange={(e) => updateWorker(index, 'remarks', e.target.value)}
                            placeholder="備考・作業内容"
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-orange-500"
                          />
                        </div>
                      </div>
                    </div>
                  ))}

                  {editData.workers.length === 0 && (
                    <div className="text-center py-4 text-gray-500 text-sm">
                      作業員を追加してください
                    </div>
                  )}
                </div>
              </div>

              {/* 連絡事項 */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  連絡事項
                </label>
                <textarea
                  value={editData.notes}
                  onChange={(e) => setEditData(prev => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                  placeholder="連絡事項があれば入力..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                />
              </div>

              {/* 注意事項 */}
              {report.status === 'approved' && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-6">
                  <p className="text-sm text-orange-700">
                    <strong>注意:</strong> 保存するとPDFが再生成されます。QRコードのURLも更新されます。
                  </p>
                </div>
              )}

              {/* ボタン */}
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowEditModal(false)}
                  disabled={saving}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSaveAndRegenerate}
                  disabled={saving}
                  className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50 flex items-center space-x-2"
                >
                  {saving ? (
                    <>
                      <RefreshCw size={18} className="animate-spin" />
                      <span>{report.status === 'approved' ? 'PDF再生成中...' : '保存中...'}</span>
                    </>
                  ) : (
                    <>
                      <Save size={18} />
                      <span>{report.status === 'approved' ? '保存してPDF再生成' : '保存'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
