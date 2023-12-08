import { Message } from "../messages/messages";
// --------
import { synthesizeVoice } from '../messages/voicevox'; // synthesizeVoice関数が含まれるファイルからインポート
// --------

// getChatResponseStreamという非同期関数を定義。引数としてmessages（Message型の配列）とapiKey（文字列）を受け取る。
export async function getChatResponseStream(messages: Message[], apiKey: string) {
  
  // APIキーが存在しない場合はエラーを投げる
  if (!apiKey) {
    throw new Error("Invalid API Key");
  }

  // HTTPヘッダーの設定
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  console.log("ChatGPT送信メッセージ", messages);  // コンソールに送信メッセージを出力

  // OpenAIのAPIエンドポイントに対してfetchを使ってPOSTリクエストを送る
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    headers: headers,
    method: "POST",
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      // model: "gpt-4",
      messages: messages,
      stream: true,  // ストリーミングを有効にする
      max_tokens: 200, // 最大トークン数を指定
    }),
  });
  
  // レスポンスからストリームリーダーを取得
  const reader = res.body?.getReader();
  
  // HTTPステータスが200以外、またはreaderがnullの場合はエラーを投げる
  if (res.status !== 200 || !reader) {
    // ---------------------
    // 2023/10/20
    // chatGPT　APIエラー時にアナウンス
    // 音声でエラーメッセージを出力
    const synthesizedData = await synthesizeVoice("チャットジーピーティと接続できない不具合が発生しています", "angry"); // トークスタイルは"angry"としていますが、変更可能です
    const audioElement = new Audio(synthesizedData.audio);
    audioElement.play();
    // -----------------------
    throw new Error("ChatGPT APIエラー");
  }

  // ReadableStreamオブジェクトを作成
  const stream = new ReadableStream({
    async start(controller: ReadableStreamDefaultController) {
      const decoder = new TextDecoder("utf-8"); // UTF-8デコーダーを作成
      try {
        while (true) {
          const { done, value } = await reader.read(); // データを読み込む
          if (done) break; // 読み込みが完了したらループを抜ける
          
          // バイナリデータをテキストに変換
          const data = decoder.decode(value);
          
          // データを分割して不要な部分を除去
          const chunks = data
            .split("data:")
            .filter((val) => !!val && val.trim() !== "[DONE]");
          
          // 各チャンクを処理
          for (const chunk of chunks) {
            const json = JSON.parse(chunk); // JSONに変換
            const messagePiece = json.choices[0].delta.content; // メッセージ部分を取得
            if (!!messagePiece) {
              controller.enqueue(messagePiece); // ストリームにメッセージを追加
            }
          }
        }
      } catch (error) {
        controller.error(error); // エラーが発生した場合はストリームにエラーを追加
      } finally {
        reader.releaseLock(); // リーダーのロックを解除
        controller.close();    // ストリームを閉じる
      }
    },
  });

  // ReadableStreamオブジェクトを返す
  return stream;
}
