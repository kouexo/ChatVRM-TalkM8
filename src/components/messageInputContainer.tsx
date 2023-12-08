/* 
https://github.com/pixiv/ChatVRM
*/

import { MessageInput } from "@/components/messageInput";
import { useState, useEffect, useCallback } from "react";

type Props = {
  isChatProcessing: boolean;
  onChatProcessStart: (text: string) => void;
};

/**
 * テキスト入力と音声入力を提供する
 *
 * 音声認識の完了時は自動で送信し、返答文の生成中は入力を無効化する
 *
 */
export const MessageInputContainer = ({
  isChatProcessing,
  onChatProcessStart,
}: Props) => {
  const [userMessage, setUserMessage] = useState("");
  const [speechRecognition, setSpeechRecognition] = useState<SpeechRecognition>();
  const [isMicRecording, setIsMicRecording] = useState(false);

  

  // 音声認識の結果を処理する
  const handleRecognitionResult = useCallback(
    (event: SpeechRecognitionEvent) => {
      const text = event.results[0][0].transcript;
      setUserMessage(text);

      // 発言の終了時
      if (event.results[0].isFinal) {
        setUserMessage(text);
        // 返答文の生成を開始
        onChatProcessStart(text);
      }
    },
    [onChatProcessStart]
  );

  // 無音が続いた場合も終了する
  const handleRecognitionEnd = useCallback(() => {
    setIsMicRecording(false);
  }, []);

  const handleClickMicButton = useCallback(() => {
    if (isMicRecording) {
      speechRecognition?.abort();
      setIsMicRecording(false);

      return;
    }
    // 音声認識スタート
    speechRecognition?.start();
    setIsMicRecording(true);
  }, [isMicRecording, speechRecognition]);

  const handleClickSendButton = useCallback(() => {
    onChatProcessStart(userMessage);
  }, [onChatProcessStart, userMessage]);

  

  /*----------------------------------------
  2023/09/19追加
  setupAudioAnalyserで音声解析の準備をし、
  次にuseEffectで解析データに基づいて音声認識のスタートを行う
  ------------------------------------------*/
  const [audioData, setAudioData] = useState(new Uint8Array(0));

  // 音声解析の設定を行う非同期関数です。
  const setupAudioAnalyser = async () => {
    // マイクから音声データを取得します。
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // AudioContextとAnalyserNodeを作成します。
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    
    // マイクの音声データをソースとしています。
    const microphone = audioContext.createMediaStreamSource(stream);
    
    // JavaScriptノードを作成。ここでデータ処理が行われます。
    const javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);
    
    // Analyserの設定を行います。
    analyser.smoothingTimeConstant = 0.8;
    analyser.fftSize = 1024;
    
    // 各ノードを接続します。
    microphone.connect(analyser);
    analyser.connect(javascriptNode);
    javascriptNode.connect(audioContext.destination);
    
    // onaudioprocessで解析データを取得してaudioDataステートを更新します。
    javascriptNode.onaudioprocess = () => {
      const array = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(array);
      setAudioData(array);
    };
  };


  
  /* 
  2023/10/02追加
  someThreshold音声認識閾値をwebソケットで受信し、変更する機能
  閾値の送信はnode-redのダッシュボードから送信
  */

  // -------------------------------------------------------------
  // 音声認識開始の閾値0~255
  const [someThreshold, setSomeThreshold] = useState(255); //

  // コンポーネントがマウントされたときにsetupAudioAnalyserを実行します。
  useEffect(() => {
    setupAudioAnalyser();

      // WebSocketで閾値を受け取る設定
    const ws = new WebSocket('ws://127.0.0.1:1880/THRESHOLD');
 
    ws.addEventListener('message', (event) => {
      const receivedData = event.data;
      // console.log('Raw received:', receivedData);
      
      // 受け取ったデータが数値か数値に変換可能かどうかを判定
      if (!isNaN(Number(receivedData))) {
        // 受け取った閾値でSOME_THRESHOLDを更新
        setSomeThreshold(Number(receivedData));
        
      } else {
        console.error('Received data is not a number:', receivedData);
      }
    });
  
    // WebSocketのクリーンアップ
    return () => {
      ws.close();
    };
  }, []);

  // 新しい useEffect でsomeThresholdの変更を監視する
  // useEffect(() => {
  //   console.log('after Updated someThreshold:', someThreshold);
  // }, [someThreshold]);
  
// --------------------------------------------------------------------
  // audioDataが更新されたときに音量をチェックして、一定以上なら音声認識をスタートします。
  useEffect(() => {
    const volume = audioData.reduce((a, b) => a + b, 0) / audioData.length;
    if (volume > someThreshold && !isMicRecording && !isChatProcessing) {
      // 音声認識スタート
      speechRecognition?.start();
      setIsMicRecording(true);
    }
  }, [audioData]);
    // -----------------------------------------------------------
  
    useEffect(() => {
    const SpeechRecognition =
      window.webkitSpeechRecognition || window.SpeechRecognition;

    // FirefoxなどSpeechRecognition非対応環境対策
    if (!SpeechRecognition) {
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "ja-JP";
    recognition.interimResults = true; // 認識の途中結果を返す
    recognition.continuous = false; // 発言の終了時に認識を終了する

    recognition.addEventListener("result", handleRecognitionResult);
    recognition.addEventListener("end", handleRecognitionEnd);

    setSpeechRecognition(recognition);
  }, [handleRecognitionResult, handleRecognitionEnd]);

  useEffect(() => {
    if (!isChatProcessing) {
      setUserMessage("");
    }
  }, [isChatProcessing]);

  return (
    <MessageInput
      userMessage={userMessage}
      isChatProcessing={isChatProcessing}
      isMicRecording={isMicRecording}
      onChangeUserMessage={(e) => setUserMessage(e.target.value)}
      onClickMicButton={handleClickMicButton}
      onClickSendButton={handleClickSendButton}
    />
  );
};
