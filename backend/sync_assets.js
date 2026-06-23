const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('오류: .env 파일에 SUPABASE_URL 및 SUPABASE_SERVICE_ROLE_KEY가 설정되어 있지 않습니다.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// 대상 저장 디렉토리 정의
const publicSongsDir = path.join(__dirname, '../frontend/public/songs');
const publicCoversDir = path.join(__dirname, '../frontend/public/covers');

// 디렉토리 자동 생성
if (!fs.existsSync(publicSongsDir)) {
  fs.mkdirSync(publicSongsDir, { recursive: true });
}
if (!fs.existsSync(publicCoversDir)) {
  fs.mkdirSync(publicCoversDir, { recursive: true });
}

// 파일 다운로드 헬퍼 함수 (native fetch 사용)
async function downloadFile(url, destPath) {
  try {
    console.log(`다운로드 중: ${url} -> ${destPath}`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP 에러! 상태 코드: ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(destPath, buffer);
    return true;
  } catch (error) {
    console.error(`다운로드 실패 (${url}):`, error.message);
    return false;
  }
}

async function sync() {
  try {
    console.log('데이터베이스에서 곡 목록을 가져오는 중...');
    const { data: songs, error: fetchErr } = await supabase
      .from('songs')
      .select('*');

    if (fetchErr) {
      throw fetchErr;
    }

    console.log(`총 ${songs.length}개의 곡 정보를 조회했습니다.`);
    let syncCount = 0;

    for (const song of songs) {
      let isModified = false;
      let newAudioUrl = song.audio_url;
      let newCoverUrl = song.cover_url;
      let audioPathInBucket = null;
      let coverPathInBucket = null;

      // 1. 오디오 파일 동기화 확인
      // Supabase Storage URL 패턴 확인
      if (song.audio_url && song.audio_url.includes('/storage/v1/object/public/songs/')) {
        const parts = song.audio_url.split('/storage/v1/object/public/songs/');
        if (parts.length > 1) {
          const encodedFileName = parts[1];
          const fileName = decodeURIComponent(encodedFileName);
          const localFilePath = path.join(publicSongsDir, fileName);

          // 로컬 다운로드 실행
          const success = await downloadFile(song.audio_url, localFilePath);
          if (success) {
            newAudioUrl = `/songs/${fileName}`;
            audioPathInBucket = fileName;
            isModified = true;
          }
        }
      }

      // 2. 커버 이미지 파일 동기화 확인
      if (song.cover_url && song.cover_url.includes('/storage/v1/object/public/covers/')) {
        const parts = song.cover_url.split('/storage/v1/object/public/covers/');
        if (parts.length > 1) {
          const encodedFileName = parts[1];
          const fileName = decodeURIComponent(encodedFileName);
          const localFilePath = path.join(publicCoversDir, fileName);

          // 로컬 다운로드 실행
          const success = await downloadFile(song.cover_url, localFilePath);
          if (success) {
            newCoverUrl = `/covers/${fileName}`;
            coverPathInBucket = fileName;
            isModified = true;
          }
        }
      }

      // 3. 업데이트 대상일 경우 DB 및 스토리지 처리
      if (isModified) {
        console.log(`[${song.title}] 업데이트 진행 중...`);

        // A. 데이터베이스 레코드 업데이트
        const { error: updateErr } = await supabase
          .from('songs')
          .update({
            audio_url: newAudioUrl,
            cover_url: newCoverUrl
          })
          .eq('id', song.id);

        if (updateErr) {
          console.error(`[${song.title}] DB 업데이트 중 오류 발생:`, updateErr.message);
          continue;
        }

        console.log(`[${song.title}] DB 업데이트 완료!`);

        // B. 성공적으로 로컬 저장 및 DB 업데이트 되었으므로 Supabase 스토리지에서 파일 제거
        if (audioPathInBucket) {
          console.log(`[스토리지 제거] songs 버킷에서 삭제: ${audioPathInBucket}`);
          const { error: delAudioErr } = await supabase.storage
            .from('songs')
            .remove([audioPathInBucket]);
          if (delAudioErr) {
            console.error(`[${song.title}] 오디오 스토리지 삭제 실패:`, delAudioErr.message);
          }
        }

        if (coverPathInBucket) {
          console.log(`[스토리지 제거] covers 버킷에서 삭제: ${coverPathInBucket}`);
          const { error: delCoverErr } = await supabase.storage
            .from('covers')
            .remove([coverPathInBucket]);
          if (delCoverErr) {
            console.error(`[${song.title}] 커버 이미지 스토리지 삭제 실패:`, delCoverErr.message);
          }
        }

        syncCount++;
      }
    }

    console.log('\n==================================================');
    console.log(`동기화 완료! 총 ${syncCount}개의 곡 자산을 로컬로 옮겼습니다.`);
    console.log('이후 다음 명령어로 변경 사항을 깃허브에 커밋 & 푸시하세요:');
    console.log('  git add .');
    console.log('  git commit -m "sync: 수파베이스 음원 로컬 동기화"');
    console.log('  git push origin main');
    console.log('==================================================\n');

  } catch (error) {
    console.error('동기화 처리 과정 중 예기치 못한 오류 발생:', error);
  }
}

sync();
