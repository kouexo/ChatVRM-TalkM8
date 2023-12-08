import axios from 'axios';
import { TalkStyle } from "../messages/messages";

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = '';
  let bytes = new Uint8Array(buffer);
  let len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export async function synthesizeVoice(message: string, style: TalkStyle) {
  let speaker = 23;

  // 適当な話者ID、要調整
  // console.log('トークスタイル:', style);
  switch(style) {
    case "talk": // 普通
    default:
        // speaker = 23; // WhiteCUL(ノーマル)
        speaker = 58; // 猫使ビィ(ノーマル)
      break;
    case "happy": // 嬉しい
    case "surprised": // 驚いた
        // speaker = 24; // WhiteCUL(たのしい)
        speaker = 58; // 猫使ビィ(ノーマル)
      break;
    case "angry": // 怒り
      // speaker = 25; // WhiteCUL(かなしい)
      speaker = 59; // 猫使ビィ(おちつき)
      break;
    case "sad": // 悲しい
    case "fear": // 恐れ
      // speaker = 26; // WhiteCUL(びえーん)
      speaker = 60; // 猫使ビィ(かなしい)
      break;
  }

  // VOICEVOXエンジンでクエリ作成
  const queryResponse = await axios.post(`http://127.0.0.1:50021/audio_query?text=${encodeURIComponent(message)}&speaker=${speaker}`, {}, {
    headers: {
      'accept': 'application/json',
    },
  });
  const query = queryResponse.data;

  // 音声合成
  const synthesisResponse = await axios.post(`http://127.0.0.1:50021/synthesis?speaker=${speaker}`, query, {
    headers: {
      'Content-Type': 'application/json',
      'accept': 'audio/mpeg',
    },
    responseType: 'arraybuffer'
  });

  // audio/mpegテスト再生
//   const audioBlob = new Blob([synthesisResponse.data], { type: 'audio/mpeg' }); // ファイル形式に合わせてください
//   const audioUrl = URL.createObjectURL(audioBlob);
//   const audioElement = new Audio(audioUrl);
//   audioElement.play();

  const base64Audio = arrayBufferToBase64(synthesisResponse.data);

  return { audio: `data:audio/mpeg;base64,${base64Audio}` };
}