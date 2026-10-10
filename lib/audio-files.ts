export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const bytesPerSample = 2;
  const dataLength = buffer.length * channels * bytesPerSample;
  const output = new ArrayBuffer(44 + dataLength);
  const view = new DataView(output);
  const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, "RIFF"); view.setUint32(4, 36 + dataLength, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, dataLength, true);
  const channelData = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < buffer.length; frame += 1) for (let channel = 0; channel < channels; channel += 1) {
    const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true); offset += 2;
  }
  return new Blob([output], { type: "audio/wav" });
}
