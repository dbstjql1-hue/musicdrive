import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAudioSourceIfChanged } from './audioSource.js';

test('같은 음원 URL이면 오디오를 다시 로드하지 않는다', () => {
  let loadCount = 0;
  const audio = {
    src: '/songs/example.mp3',
    getAttribute: () => '/songs/example.mp3',
    load: () => { loadCount += 1; }
  };

  assert.equal(loadAudioSourceIfChanged(audio, '/songs/example.mp3'), false);
  assert.equal(loadCount, 0);
});

test('다른 곡으로 바뀐 경우에만 새 음원을 로드한다', () => {
  let loadCount = 0;
  const audio = {
    src: '/songs/old.mp3',
    getAttribute: () => '/songs/old.mp3',
    load: () => { loadCount += 1; }
  };

  assert.equal(loadAudioSourceIfChanged(audio, '/songs/new.mp3'), true);
  assert.equal(audio.src, '/songs/new.mp3');
  assert.equal(loadCount, 1);
});
