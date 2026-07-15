import { useEffect, useRef, useState } from 'react';
import { GripHorizontal, LogIn, MessageCircle, Send, ShieldCheck, SlidersHorizontal, Smile, Users, X } from 'lucide-react';
import { apiFetch } from '../apiClient';
import { supabase } from '../supabaseClient';

const CHAT_PANEL_WIDTH = 400;
const CHAT_PANEL_HEIGHT = 560;
const PLAYER_SAFE_SPACE = 104;

function getDefaultPosition() {
  if (typeof window === 'undefined') return { x: 24, y: 80 };
  return {
    x: Math.max(16, window.innerWidth - CHAT_PANEL_WIDTH - 28),
    y: Math.max(16, Math.min(90, window.innerHeight - CHAT_PANEL_HEIGHT - PLAYER_SAFE_SPACE)),
  };
}

function clampPosition(position, panelElement) {
  if (typeof window === 'undefined') return position;
  const rect = panelElement?.getBoundingClientRect();
  const width = rect?.width || CHAT_PANEL_WIDTH;
  const height = rect?.height || CHAT_PANEL_HEIGHT;
  return {
    x: Math.min(Math.max(12, position.x), Math.max(12, window.innerWidth - width - 12)),
    y: Math.min(Math.max(12, position.y), Math.max(12, window.innerHeight - height - PLAYER_SAFE_SPACE)),
  };
}

function formatChatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function appendUniqueMessage(messages, nextMessage) {
  if (!nextMessage?.id || messages.some((message) => message.id === nextMessage.id)) return messages;
  return [...messages, nextMessage].slice(-100);
}

function getSavedOpacity() {
  const saved = Number.parseInt(localStorage.getItem('musicdrive_chat_opacity') || '', 10);
  return Number.isFinite(saved) ? Math.min(100, Math.max(65, saved)) : 94;
}

export function LiveChatPanel({ id, isOpen, onClose, session, onLoginRequest }) {
  const [messages, setMessages] = useState([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [connectionState, setConnectionState] = useState(session?.user?.id ? 'connecting' : 'login');
  const [systemNotice, setSystemNotice] = useState('');
  const [position, setPosition] = useState(getDefaultPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [chatOpacity, setChatOpacity] = useState(getSavedOpacity);
  const [isOpacityOpen, setIsOpacityOpen] = useState(false);
  const panelRef = useRef(null);
  const messagesEndRef = useRef(null);
  const dragStateRef = useRef(null);

  useEffect(() => {
    if (!session?.user?.id) return undefined;

    let active = true;
    let channel = null;

    const connectRealtime = async () => {
      try {
        await supabase.realtime.setAuth(session.access_token);
        if (!active) return;

        channel = supabase
          .channel('room:musicdrive:lobby', {
            config: {
              private: true,
              // 같은 계정의 여러 탭은 한 명의 접속자로 집계합니다.
              presence: { key: session.user.id },
            },
          })
          .on('presence', { event: 'sync' }, () => {
            if (!active || !channel) return;
            const presenceState = channel.presenceState();
            const connectedVisitors = Object.values(presenceState)
              .filter((presences) => Array.isArray(presences) && presences.length > 0)
              .length;
            setOnlineCount(connectedVisitors);
          })
          .on('broadcast', { event: 'chat_message' }, ({ payload: nextMessage }) => {
            if (!active) return;
            setMessages((current) => appendUniqueMessage(current, nextMessage));
          })
          .subscribe(async (status) => {
            if (!active || !channel) return;
            if (status === 'SUBSCRIBED') {
              setConnectionState('connected');
              await channel.track({ online_at: new Date().toISOString() });
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              setConnectionState('error');
              setSystemNotice('실시간 연결이 잠시 불안정합니다. 자동으로 다시 연결합니다.');
            }
          });
      } catch (error) {
        if (active) {
          setConnectionState('error');
          setSystemNotice(error.message || '실시간 연결을 시작하지 못했습니다.');
        }
      }
    };

    connectRealtime();

    return () => {
      active = false;
      if (channel) {
        channel.untrack();
        supabase.removeChannel(channel);
      }
    };
  }, [session?.access_token, session?.user?.id]);

  useEffect(() => {
    if (!isOpen) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [isOpen, messages]);

  useEffect(() => {
    const handleResize = () => setPosition((current) => clampPosition(current, panelRef.current));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    localStorage.setItem('musicdrive_chat_opacity', String(chatOpacity));
  }, [chatOpacity]);

  const handlePointerDown = (event) => {
    if (window.innerWidth <= 768 || event.target.closest('button, input')) return;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  };

  const handlePointerMove = (event) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextPosition = {
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    };
    setPosition(clampPosition(nextPosition, panelRef.current));
  };

  const stopDragging = (event) => {
    if (dragStateRef.current?.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    setIsDragging(false);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!session?.access_token) {
      onLoginRequest();
      return;
    }

    const content = draft.trim();
    if (!content || isSending) return;

    setIsSending(true);
    setSystemNotice('');
    try {
      const response = await apiFetch('/api/chat/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ content }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '메시지를 전송하지 못했습니다.');
      setMessages((current) => appendUniqueMessage(current, data));
      setDraft('');
    } catch (error) {
      setSystemNotice(error.message || '메시지를 전송하지 못했습니다.');
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <section
      id={id}
      ref={panelRef}
      className={`live-chat-panel ${isDragging ? 'is-dragging' : ''}`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        '--chat-panel-opacity': chatOpacity / 100,
      }}
      aria-label="실시간 대화창"
    >
      <header
        className="live-chat-header"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <div className="live-chat-heading">
          <span className="live-chat-icon"><MessageCircle size={18} /></span>
          <div>
            <h2>실시간 대화</h2>
            <span className={`live-chat-status ${connectionState}`}>
              <i /> {connectionState === 'connected' ? '실시간 연결됨' : connectionState === 'login' ? '로그인 필요' : '연결 중'}
            </span>
          </div>
        </div>
        <div className="live-chat-header-actions">
          <span className="live-chat-online"><Users size={14} /> 현재 {onlineCount}명</span>
          <GripHorizontal className="live-chat-grip" size={19} aria-hidden="true" />
          <button
            type="button"
            className={`live-chat-opacity-toggle ${isOpacityOpen ? 'active' : ''}`}
            onClick={() => setIsOpacityOpen((open) => !open)}
            aria-label="대화창 투명도 설정"
            aria-expanded={isOpacityOpen}
          >
            <SlidersHorizontal size={16} />
          </button>
          <button type="button" className="live-chat-close" onClick={onClose} aria-label="대화창 닫기">
            <X size={18} />
          </button>
        </div>
        {isOpacityOpen && (
          <div className="live-chat-opacity-popover" onPointerDown={(event) => event.stopPropagation()}>
            <div><strong>대화창 투명도</strong><span>{chatOpacity}%</span></div>
            <input
              type="range"
              min="65"
              max="100"
              step="1"
              value={chatOpacity}
              onChange={(event) => setChatOpacity(Number(event.target.value))}
              aria-label="대화창 투명도"
            />
          </div>
        )}
      </header>

      <div className="live-chat-safety">
        <ShieldCheck size={16} />
        <div className="live-chat-safety-copy">
          <strong>대화 내용은 저장되지 않습니다</strong>
          <span>안전한 대화를 위해 자동 필터가 작동 중입니다.</span>
        </div>
      </div>

      {session ? (
        <>
          <div className="live-chat-messages" aria-live="polite">
            {messages.length === 0 && connectionState !== 'error' && (
              <div className="live-chat-empty">
                <MessageCircle size={28} />
                <strong>첫 대화를 시작해 보세요</strong>
                <span>지금 듣는 음악 이야기를 나눠보세요.</span>
              </div>
            )}
            {messages.map((message) => {
              const isMine = message.user_id === session.user.id;
              return (
                <article className={`live-chat-message ${isMine ? 'mine' : ''}`} key={message.id}>
                  <div className="live-chat-avatar">{String(message.nickname || '음').slice(0, 1)}</div>
                  <div className="live-chat-message-body">
                    <div className="live-chat-message-meta">
                      <strong>{message.nickname || '음악친구'}</strong>
                      <time>{formatChatTime(message.created_at)}</time>
                    </div>
                    <p>{message.content}</p>
                  </div>
                </article>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          <div className="live-chat-compose-wrap">
            {systemNotice && (
              <div className="live-chat-notice"><ShieldCheck size={14} /> {systemNotice}</div>
            )}
            <div className="live-chat-policy">욕설·음란·혐오·도배는 자동 차단됩니다.</div>
            <form className="live-chat-compose" onSubmit={handleSubmit}>
              <button type="button" className="live-chat-emoji" aria-label="이모지"><Smile size={18} /></button>
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value.slice(0, 200))}
                placeholder="메시지를 입력하세요"
                maxLength={200}
                aria-label="실시간 대화 메시지"
              />
              <span className="live-chat-count">{draft.length}/200</span>
              <button type="submit" className="live-chat-send" disabled={!draft.trim() || isSending} aria-label="보내기">
                <Send size={17} />
              </button>
            </form>
          </div>
        </>
      ) : (
        <div className="live-chat-login">
          <div className="live-chat-login-icon"><MessageCircle size={30} /></div>
          <strong>접속자 전용 실시간 대화</strong>
          <p>로그인한 회원끼리 안전하게 대화할 수 있습니다.</p>
          <button type="button" onClick={onLoginRequest}><LogIn size={17} /> 구글 로그인</button>
        </div>
      )}
    </section>
  );
}
