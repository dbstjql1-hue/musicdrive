const GMAIL_COMPOSE_URL = 'https://mail.google.com/mail/';

export function buildGmailComposeUrl({ recipient, requestTitle }) {
  const title = requestTitle?.trim();
  const songLabel = title ? `"${title}" 곡` : '요청하신 곡';
  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: recipient?.trim() || '',
    su: `[musicdrive] ${title ? `${title} 곡` : '요청하신 곡'} 파일을 보내드립니다`,
    body: `안녕하세요.\n\n${songLabel} 파일을 보내드립니다.\n첨부 파일을 확인해 주세요.\n\n감사합니다.`
  });

  return `${GMAIL_COMPOSE_URL}?${params.toString()}`;
}
