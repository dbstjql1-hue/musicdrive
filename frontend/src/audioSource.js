export function loadAudioSourceIfChanged(audio, audioUrl) {
  if (!audioUrl || audio.getAttribute('src') === audioUrl) return false;

  audio.src = audioUrl;
  audio.load();
  return true;
}
