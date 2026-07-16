import { BellRing, Megaphone, Sparkles, Wrench, X } from 'lucide-react';
import './LoginNoticeModal.css';

const NOTICE_META = {
  update: { label: '업데이트', icon: Sparkles },
  maintenance: { label: '점검 안내', icon: Wrench },
  announcement: { label: '공지사항', icon: Megaphone },
};

function formatNoticeDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function LoginNoticeModal({ notice, onClose }) {
  if (!notice) return null;
  const meta = NOTICE_META[notice.notice_type] || NOTICE_META.announcement;
  const NoticeIcon = meta.icon;

  return (
    <div className="login-notice-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`login-notice-modal login-notice-${notice.notice_type || 'announcement'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-notice-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="login-notice-close" onClick={onClose} aria-label="공지사항 닫기">
          <X size={19} />
        </button>
        <div className="login-notice-glow" aria-hidden="true" />
        <header className="login-notice-header">
          <span className="login-notice-icon"><BellRing size={25} /></span>
          <div>
            <span className="login-notice-eyebrow">Musicdrive notice</span>
            <p><NoticeIcon size={13} /> {meta.label}</p>
          </div>
        </header>
        <div className="login-notice-body">
          <h2 id="login-notice-title">{notice.title}</h2>
          <time>{formatNoticeDate(notice.published_at)}</time>
          <div className="login-notice-content">{notice.content}</div>
        </div>
        <footer>
          <span>다음 로그인 때 다시 확인할 수 있습니다.</span>
          <button type="button" onClick={onClose}>확인했어요</button>
        </footer>
      </section>
    </div>
  );
}
