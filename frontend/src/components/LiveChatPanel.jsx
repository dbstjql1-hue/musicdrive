import { useEffect, useRef, useState } from 'react';
import { AtSign, Check, GripHorizontal, LoaderCircle, LogIn, LogOut, Maximize2, MessageCircle, Monitor, Pencil, Send, ShieldCheck, SlidersHorizontal, Smile, Smartphone, Users, X } from 'lucide-react';
import { apiFetch } from '../apiClient';
import { supabase } from '../supabaseClient';

const CHAT_PANEL_WIDTH = 400;
const CHAT_PANEL_HEIGHT = 560;
const PLAYER_SAFE_SPACE = 104;
const DESKTOP_CHAT_OPACITY_STORAGE_KEY = 'musicdrive_chat_opacity_desktop_v1';
const MOBILE_CHAT_OPACITY_STORAGE_KEY = 'musicdrive_chat_opacity_mobile_v1';
const EMOJI_CATEGORIES = [
  {
    id: 'faces',
    label: '표정',
    icon: '😀',
    emojis: ['😀', '😂', '😊', '😍', '🥰', '😎', '🤣', '🥹', '😭', '😅', '🤔', '😴'],
  },
  {
    id: 'cheer',
    label: '응원',
    icon: '👏',
    emojis: ['👍', '👏', '🙌', '💪', '🔥', '🎉', '✨', '💯', '🫶', '🤝', '🥳', '🙏'],
  },
  {
    id: 'music',
    label: '음악',
    icon: '🎵',
    emojis: ['🎵', '🎶', '🎧', '🎤', '🎸', '🥁', '🎹', '🎷', '🕺', '💃', '🔊', '🎼'],
  },
  {
    id: 'hearts',
    label: '마음',
    icon: '💜',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🩷', '🤍', '💖', '💕', '💓', '💗'],
  },
];

function getDefaultPosition() {
  if (typeof window === 'undefined') return { x: 24, y: 130 };
  return {
    x: Math.max(16, window.innerWidth - CHAT_PANEL_WIDTH - 28),
    y: Math.max(16, Math.min(130, window.innerHeight - CHAT_PANEL_HEIGHT - PLAYER_SAFE_SPACE)),
  };
}

function getDefaultPanelSize() {
  if (typeof window === 'undefined') return { width: CHAT_PANEL_WIDTH, height: CHAT_PANEL_HEIGHT };
  const isMobile = window.innerWidth <= 768;
  return clampPanelSize({
    width: isMobile ? Math.max(280, window.innerWidth - 24) : CHAT_PANEL_WIDTH,
    height: isMobile ? 520 : CHAT_PANEL_HEIGHT,
  });
}

function clampPanelSize(size) {
  if (typeof window === 'undefined') return size;
  const isMobile = window.innerWidth <= 768;
  const playerHeight = Number.parseFloat(
    window.getComputedStyle(document.documentElement).getPropertyValue('--player-height')
  ) || (isMobile ? 112 : 88);
  const maxWidth = Math.max(280, window.innerWidth - 24);
  const maxHeight = Math.max(300, window.innerHeight - playerHeight - (isMobile ? 82 : 32));
  const minWidth = Math.min(isMobile ? 280 : 320, maxWidth);
  const minHeight = Math.min(isMobile ? 300 : 410, maxHeight);
  return {
    width: isMobile ? maxWidth : Math.min(maxWidth, Math.max(minWidth, size.width)),
    height: Math.min(maxHeight, Math.max(minHeight, size.height)),
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

function getPrivateFallbackNickname(userId) {
  const suffix = String(userId || '').replace(/[^a-f0-9]/gi, '').slice(0, 8).toLowerCase() || 'listener';
  return `음악친구_${suffix}`;
}

function normalizeMentionKey(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('ko-KR');
}

function getCurrentDeviceType() {
  if (typeof navigator === 'undefined') return 'pc';
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'pc';
}

function createPresenceNotice(eventType, presence, presenceKey) {
  const nickname = String(presence?.nickname || '음악친구').slice(0, 20);
  return {
    id: `presence-${eventType}-${presence?.presence_ref || presenceKey}-${Date.now()}`,
    type: 'presence',
    presence_event: eventType,
    content: eventType === 'join'
      ? `${nickname}님이 접속했습니다.`
      : `${nickname}님이 로그아웃했습니다.`,
    created_at: new Date().toISOString(),
  };
}

function getSavedOpacity() {
  const isMobile = window.innerWidth <= 768;
  const storageKey = isMobile
    ? MOBILE_CHAT_OPACITY_STORAGE_KEY
    : DESKTOP_CHAT_OPACITY_STORAGE_KEY;
  const saved = Number.parseInt(localStorage.getItem(storageKey) || '', 10);
  return Number.isFinite(saved) ? Math.min(100, Math.max(15, saved)) : (isMobile ? 40 : 18);
}

export function LiveChatPanel({
  id,
  isOpen,
  onClose,
  session,
  onLoginRequest,
  onPresenceChange,
  onActivity,
  onMention,
  onNicknameChange,
  activityActive = false,
  mentionActive = false,
}) {
  const fallbackNickname = getPrivateFallbackNickname(session?.user?.id);
  const currentDeviceType = getCurrentDeviceType();
  const [chatNickname, setChatNickname] = useState(fallbackNickname);
  const [nicknameDraft, setNicknameDraft] = useState(fallbackNickname);
  const [isNicknameEditing, setIsNicknameEditing] = useState(false);
  const [isNicknameSaving, setIsNicknameSaving] = useState(false);
  const [messages, setMessages] = useState([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [connectionState, setConnectionState] = useState(session?.user?.id ? 'connecting' : 'login');
  const [systemNotice, setSystemNotice] = useState('');
  const [position, setPosition] = useState(getDefaultPosition);
  const [panelSize, setPanelSize] = useState(getDefaultPanelSize);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [chatOpacity, setChatOpacity] = useState(getSavedOpacity);
  const [isOpacityOpen, setIsOpacityOpen] = useState(false);
  const [isEmojiOpen, setIsEmojiOpen] = useState(false);
  const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState(EMOJI_CATEGORIES[0].id);
  const panelRef = useRef(null);
  const messagesEndRef = useRef(null);
  const dragStateRef = useRef(null);
  const resizeStateRef = useRef(null);
  const inputRef = useRef(null);
  const emojiButtonRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const participantsButtonRef = useRef(null);
  const participantsPopoverRef = useRef(null);
  const callbackRef = useRef({ onPresenceChange, onActivity, onMention });
  const activeEmojiCategory = EMOJI_CATEGORIES.find((category) => category.id === emojiCategory)
    || EMOJI_CATEGORIES[0];

  useEffect(() => {
    callbackRef.current = { onPresenceChange, onActivity, onMention };
  }, [onActivity, onMention, onPresenceChange]);

  useEffect(() => {
    if (!session?.access_token) return undefined;

    let active = true;
    const fetchChatProfile = async () => {
      try {
        const response = await apiFetch('/api/chat/profile', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '채팅 닉네임을 불러오지 못했습니다.');
        if (!active) return;
        setChatNickname(data.nickname || fallbackNickname);
        setNicknameDraft(data.nickname || fallbackNickname);
        onNicknameChange?.(data.nickname || fallbackNickname);
      } catch (error) {
        if (active) setSystemNotice(error.message || '채팅 닉네임을 불러오지 못했습니다.');
      }
    };

    fetchChatProfile();
    return () => { active = false; };
  }, [fallbackNickname, onNicknameChange, session?.access_token]);

  useEffect(() => {
    if (!session?.user?.id) return undefined;

    let active = true;
    let channel = null;
    let hasSyncedPresence = false;

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
            const connectedUsers = Object.entries(presenceState)
              .flatMap(([userId, presences]) => {
                if (!Array.isArray(presences) || presences.length === 0) return [];
                const latestPresence = presences[presences.length - 1];
                return [{
                  id: userId,
                  nickname: String(latestPresence?.nickname || '음악친구').slice(0, 20),
                  device_type: latestPresence?.device_type === 'mobile' ? 'mobile' : 'pc',
                  is_me: userId === session.user.id,
                }];
              })
              .sort((first, second) => Number(second.is_me) - Number(first.is_me)
                || first.nickname.localeCompare(second.nickname, 'ko'));
            setOnlineUsers(connectedUsers);
            setOnlineCount(connectedUsers.length);
            callbackRef.current.onPresenceChange?.(connectedUsers.length);
            hasSyncedPresence = true;
          })
          .on('presence', { event: 'join' }, ({ key, currentPresences, newPresences }) => {
            if (!active || !hasSyncedPresence || (currentPresences?.length || 0) > 0) return;
            const nextNotice = createPresenceNotice('join', newPresences?.[0], key);
            setMessages((current) => appendUniqueMessage(current, nextNotice));
          })
          .on('presence', { event: 'leave' }, ({ key, currentPresences, leftPresences }) => {
            if (!active || !hasSyncedPresence || (currentPresences?.length || 0) > 0) return;
            const nextNotice = createPresenceNotice('leave', leftPresences?.[0], key);
            setMessages((current) => appendUniqueMessage(current, nextNotice));
          })
          .on('broadcast', { event: 'chat_message' }, ({ payload: nextMessage }) => {
            if (!active) return;
            setMessages((current) => appendUniqueMessage(current, nextMessage));
            if (nextMessage?.user_id === session.user.id) return;
            const isMentioned = Array.isArray(nextMessage?.mentions)
              && nextMessage.mentions.includes(normalizeMentionKey(chatNickname));
            callbackRef.current.onActivity?.(nextMessage);
            if (isMentioned) callbackRef.current.onMention?.(nextMessage);
          })
          .subscribe(async (status) => {
            if (!active || !channel) return;
            if (status === 'SUBSCRIBED') {
              setConnectionState('connected');
              await channel.track({
                online_at: new Date().toISOString(),
                nickname: chatNickname,
                device_type: currentDeviceType,
              });
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
      callbackRef.current.onPresenceChange?.(0);
    };
  }, [chatNickname, currentDeviceType, session?.access_token, session?.user?.id]);

  useEffect(() => {
    if (!isOpen) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [isOpen, messages]);

  useEffect(() => {
    const handleResize = () => {
      setPanelSize((current) => clampPanelSize(current));
      setPosition((current) => clampPosition(current, panelRef.current));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const storageKey = window.innerWidth <= 768
      ? MOBILE_CHAT_OPACITY_STORAGE_KEY
      : DESKTOP_CHAT_OPACITY_STORAGE_KEY;
    localStorage.setItem(storageKey, String(chatOpacity));
  }, [chatOpacity]);

  useEffect(() => {
    if (!isEmojiOpen) return undefined;

    const handleOutsidePointer = (event) => {
      if (
        emojiPickerRef.current?.contains(event.target)
        || emojiButtonRef.current?.contains(event.target)
      ) return;
      setIsEmojiOpen(false);
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') setIsEmojiOpen(false);
    };

    document.addEventListener('pointerdown', handleOutsidePointer);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isEmojiOpen]);

  useEffect(() => {
    if (!isParticipantsOpen) return undefined;

    const handleOutsidePointer = (event) => {
      if (
        participantsPopoverRef.current?.contains(event.target)
        || participantsButtonRef.current?.contains(event.target)
      ) return;
      setIsParticipantsOpen(false);
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') setIsParticipantsOpen(false);
    };

    document.addEventListener('pointerdown', handleOutsidePointer);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isParticipantsOpen]);

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

  const handleResizeStart = (event) => {
    event.stopPropagation();
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originWidth: panelRef.current?.getBoundingClientRect().width || panelSize.width,
      originHeight: panelRef.current?.getBoundingClientRect().height || panelSize.height,
      isMobile: window.innerWidth <= 768,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
  };

  const handleResizeMove = (event) => {
    const resize = resizeStateRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - resize.startX;
    const deltaY = event.clientY - resize.startY;
    const nextSize = clampPanelSize({
      width: resize.isMobile ? resize.originWidth : resize.originWidth + deltaX,
      height: resize.originHeight + (resize.isMobile ? -deltaY : deltaY),
    });
    setPanelSize(nextSize);

    if (!resize.isMobile) {
      setPosition((current) => ({
        x: Math.min(current.x, Math.max(12, window.innerWidth - nextSize.width - 12)),
        y: Math.min(current.y, Math.max(12, window.innerHeight - nextSize.height - PLAYER_SAFE_SPACE)),
      }));
    }
  };

  const stopResizing = (event) => {
    if (resizeStateRef.current?.pointerId !== event.pointerId) return;
    resizeStateRef.current = null;
    setIsResizing(false);
  };

  const handleEmojiSelect = (emoji) => {
    const input = inputRef.current;
    const selectionStart = input?.selectionStart ?? draft.length;
    const selectionEnd = input?.selectionEnd ?? selectionStart;
    const nextDraft = `${draft.slice(0, selectionStart)}${emoji}${draft.slice(selectionEnd)}`;
    if (nextDraft.length > 200) return;

    setDraft(nextDraft);
    window.requestAnimationFrame(() => {
      input?.focus();
      const nextCursor = selectionStart + emoji.length;
      input?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleMentionUser = (nickname) => {
    const mention = `@${nickname}`;
    setDraft((current) => {
      const separator = current && !current.endsWith(' ') ? ' ' : '';
      return `${current}${separator}${mention} `.slice(0, 200);
    });
    setIsParticipantsOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleNicknameSave = async (event) => {
    event.preventDefault();
    if (!session?.access_token || isNicknameSaving) return;

    setIsNicknameSaving(true);
    setSystemNotice('');
    try {
      const response = await apiFetch('/api/chat/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ nickname: nicknameDraft }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '닉네임을 변경하지 못했습니다.');
      setChatNickname(data.nickname);
      setNicknameDraft(data.nickname);
      setIsNicknameEditing(false);
      onNicknameChange?.(data.nickname);
      setSystemNotice(`채팅 닉네임이 @${data.nickname}(으)로 변경되었습니다.`);
    } catch (error) {
      setSystemNotice(error.message || '닉네임을 변경하지 못했습니다.');
    } finally {
      setIsNicknameSaving(false);
    }
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
      callbackRef.current.onActivity?.(data);
      setDraft('');
      setIsEmojiOpen(false);
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
      className={`live-chat-panel ${isDragging ? 'is-dragging' : ''} ${isResizing ? 'is-resizing' : ''} ${onlineCount > 0 ? 'has-presence' : ''} ${activityActive ? 'has-activity' : ''} ${mentionActive ? 'has-mention' : ''}`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        '--chat-panel-width': `${panelSize.width}px`,
        '--chat-panel-height': `${panelSize.height}px`,
        '--chat-panel-opacity': chatOpacity / 100,
        '--chat-panel-blur': `${Math.max(0, Math.round((chatOpacity - 15) * 0.16))}px`,
        '--chat-chrome-opacity': Math.max(0.08, (chatOpacity / 100) * 0.58),
      }}
      aria-label="실시간 대화창"
    >
      <button
        type="button"
        className="live-chat-resize-handle"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={stopResizing}
        onPointerCancel={stopResizing}
        aria-label="대화창 크기 조절"
        title="드래그해서 대화창 크기 조절"
      >
        <Maximize2 size={13} />
      </button>
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
          <button
            ref={participantsButtonRef}
            type="button"
            className={`live-chat-online ${isParticipantsOpen ? 'active' : ''}`}
            onClick={() => {
              setIsParticipantsOpen((open) => !open);
              setIsOpacityOpen(false);
              setIsEmojiOpen(false);
            }}
            aria-label={`현재 접속자 ${onlineCount}명 보기`}
            aria-expanded={isParticipantsOpen}
            aria-haspopup="dialog"
          >
            <Users size={14} /> 현재 {onlineCount}명
          </button>
          <GripHorizontal className="live-chat-grip" size={19} aria-hidden="true" />
          <button
            type="button"
            className={`live-chat-opacity-toggle ${isOpacityOpen ? 'active' : ''}`}
            onClick={() => {
              setIsOpacityOpen((open) => !open);
              setIsEmojiOpen(false);
              setIsParticipantsOpen(false);
            }}
            aria-label="대화창 투명도 설정"
            aria-expanded={isOpacityOpen}
          >
            <SlidersHorizontal size={16} />
            <span>투명도 {chatOpacity}%</span>
          </button>
          <button type="button" className="live-chat-close" onClick={onClose} aria-label="대화창 닫기">
            <X size={18} />
          </button>
        </div>
        {isParticipantsOpen && (
          <div
            ref={participantsPopoverRef}
            className="live-chat-participants-popover"
            role="dialog"
            aria-label="현재 접속자 목록"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="live-chat-participants-head">
              <strong>현재 접속자</strong>
              <span>{onlineUsers.length}명</span>
            </div>
            <div className="live-chat-participants-list">
              {onlineUsers.length > 0 ? onlineUsers.map((user) => {
                const isMobileDevice = user.device_type === 'mobile';
                const DeviceIcon = isMobileDevice ? Smartphone : Monitor;
                return (
                  <button
                    type="button"
                    className="live-chat-participant"
                    key={user.id}
                    onClick={() => !user.is_me && handleMentionUser(user.nickname)}
                    disabled={user.is_me}
                    title={user.is_me ? '내 닉네임' : `@${user.nickname}님 호출하기`}
                  >
                    <span className="live-chat-participant-avatar">
                      {String(user.nickname || '음').slice(0, 1)}
                    </span>
                    <div className="live-chat-participant-copy">
                      <strong>
                        {user.nickname}
                        {user.is_me && <em>나</em>}
                      </strong>
                      <span><DeviceIcon size={10} /> {isMobileDevice ? '모바일' : 'PC'}</span>
                    </div>
                    {user.is_me
                      ? <i className="live-chat-participant-dot" title="접속 중" />
                      : <AtSign className="live-chat-participant-mention" size={14} aria-hidden="true" />}
                  </button>
                );
              }) : (
                <div className="live-chat-participants-empty">접속 정보를 불러오는 중입니다.</div>
              )}
            </div>
            <small>접속 정보는 저장되지 않습니다.</small>
          </div>
        )}
        {isOpacityOpen && (
          <div className="live-chat-opacity-popover" onPointerDown={(event) => event.stopPropagation()}>
            <div><strong>대화창 투명도</strong><span>{chatOpacity}%</span></div>
            <input
              type="range"
              min="15"
              max="100"
              step="1"
              value={chatOpacity}
              onChange={(event) => setChatOpacity(Number(event.target.value))}
              aria-label="대화창 투명도"
            />
            <div className="live-chat-opacity-scale" aria-hidden="true">
              <span>뒤 화면 선명</span>
              <span>대화창 선명</span>
            </div>
            <small>15~35%로 낮추면 뒤의 재생·플레이리스트 버튼이 잘 보입니다.</small>
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

      {session && (
        <div className="live-chat-identity">
          {isNicknameEditing ? (
            <form onSubmit={handleNicknameSave}>
              <AtSign size={14} aria-hidden="true" />
              <input
                value={nicknameDraft}
                onChange={(event) => setNicknameDraft(event.target.value.slice(0, 16))}
                minLength={2}
                maxLength={16}
                pattern="[가-힣A-Za-z0-9_]{2,16}"
                placeholder="채팅 닉네임"
                aria-label="채팅 닉네임"
                autoFocus
                required
              />
              <button type="submit" disabled={isNicknameSaving} aria-label="닉네임 저장">
                {isNicknameSaving ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setNicknameDraft(chatNickname);
                  setIsNicknameEditing(false);
                }}
                aria-label="닉네임 변경 취소"
              >
                <X size={14} />
              </button>
            </form>
          ) : (
            <>
              <span><AtSign size={14} aria-hidden="true" /><small>채팅 닉네임</small><strong>{chatNickname}</strong></span>
              <button type="button" onClick={() => setIsNicknameEditing(true)}><Pencil size={12} /> 변경</button>
            </>
          )}
        </div>
      )}

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
              if (message.type === 'presence') {
                const PresenceIcon = message.presence_event === 'join' ? LogIn : LogOut;
                return (
                  <div className={`live-chat-presence-notice ${message.presence_event}`} key={message.id}>
                    <PresenceIcon size={12} />
                    <span>{message.content}</span>
                    <time>{formatChatTime(message.created_at)}</time>
                  </div>
                );
              }

              const isMine = message.user_id === session.user.id;
              const isMobileDevice = message.device_type === 'mobile';
              const DeviceIcon = isMobileDevice ? Smartphone : Monitor;
              const mentionsMe = !isMine && Array.isArray(message.mentions)
                && message.mentions.includes(normalizeMentionKey(chatNickname));
              return (
                <article className={`live-chat-message ${isMine ? 'mine' : ''} ${mentionsMe ? 'mentions-me' : ''}`} key={message.id}>
                  <div className="live-chat-avatar">{String(message.nickname || '음').slice(0, 1)}</div>
                  <div className="live-chat-message-body">
                    <div className="live-chat-message-meta">
                      <strong>{message.nickname || '음악친구'}</strong>
                      <span
                        className={`live-chat-device ${isMobileDevice ? 'mobile' : 'pc'}`}
                        title={isMobileDevice ? '모바일에서 접속' : 'PC에서 접속'}
                        aria-label={isMobileDevice ? '모바일 사용자' : 'PC 사용자'}
                      >
                        <DeviceIcon size={9} />
                        {isMobileDevice ? '모바일' : 'PC'}
                      </span>
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
            {isEmojiOpen && (
              <div className="live-chat-emoji-picker" ref={emojiPickerRef} role="dialog" aria-label="이모티콘 선택">
                <div className="live-chat-emoji-picker-head">
                  <strong>이모티콘</strong>
                  <span>대화에 바로 추가됩니다</span>
                </div>
                <div className="live-chat-emoji-tabs" role="tablist" aria-label="이모티콘 카테고리">
                  {EMOJI_CATEGORIES.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      role="tab"
                      className={emojiCategory === category.id ? 'active' : ''}
                      aria-selected={emojiCategory === category.id}
                      onClick={() => setEmojiCategory(category.id)}
                    >
                      <span>{category.icon}</span>{category.label}
                    </button>
                  ))}
                </div>
                <div className="live-chat-emoji-grid">
                  {activeEmojiCategory.emojis.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => handleEmojiSelect(emoji)}
                      aria-label={`${emoji} 이모티콘 추가`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <form className="live-chat-compose" onSubmit={handleSubmit}>
              <button
                ref={emojiButtonRef}
                type="button"
                className={`live-chat-emoji ${isEmojiOpen ? 'active' : ''}`}
                onClick={() => {
                  setIsEmojiOpen((open) => !open);
                  setIsOpacityOpen(false);
                  setIsParticipantsOpen(false);
                }}
                aria-label="이모티콘 선택"
                aria-expanded={isEmojiOpen}
              >
                <Smile size={18} />
              </button>
              <input
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value.slice(0, 200))}
                placeholder="메시지 입력 · @닉네임으로 호출"
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
