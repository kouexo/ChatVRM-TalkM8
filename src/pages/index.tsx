import { useCallback, useContext, useEffect, useState } from "react";
import VrmViewer from "@/components/vrmViewer";
import { ViewerContext } from "@/features/vrmViewer/viewerContext";
import { Message, textsToScreenplay, Screenplay } from "@/features/messages/messages";
import { speakCharacter } from "@/features/messages/speakCharacter";
import { MessageInputContainer } from "@/components/messageInputContainer";
import { SYSTEM_PROMPT } from "@/features/constants/systemPromptConstants";
import { getChatResponseStream } from "@/features/chat/openAiChat";
import { Menu } from "@/components/menu";
import { Meta } from "@/components/meta";

export default function Home() {
  const { viewer } = useContext(ViewerContext);
  const [systemPrompt, setSystemPrompt] = useState(SYSTEM_PROMPT);

  // APIキー初期値設定箇所
  const [openAiKey, setOpenAiKey] = useState("xxxxxxxxxxxxxx");
  const [chatProcessing, setChatProcessing] = useState(false);
  const [chatLog, setChatLog] = useState<Message[]>([]);
  const [assistantMessage, setAssistantMessage] = useState("");


// WEBソケット通信
// ------------------------------------ーーーーーーーーーーーーーーーーーーーーーーーーーーーーーーー
  let wsVoice: WebSocket | null = null;
  let wsChat: WebSocket | null = null;
  
  useEffect(() => {
    function connectVoice() {
      if (wsVoice && wsVoice.readyState === WebSocket.OPEN) {
        return;
      }
  
      wsVoice = new WebSocket('ws://127.0.0.1:1880/Voice');
      
      wsVoice.onmessage = async (event) => {
        const WebSocketMessage = event.data.toString();
        // 音声を生成し口パクしながら再生
        // --------------------------------------------------------------
        const aiTalks = textsToScreenplay([WebSocketMessage]);
        handleSpeakAi(aiTalks[0], () => {
          setAssistantMessage(WebSocketMessage);
        });
        // --------------------------------------------------------------
      };
  
      wsVoice.onclose = () => {
        console.log('ws:接続が閉じました');
        // setTimeout(connectVoice, 5000);
      };
  
      wsVoice.onerror = (error) => {
        console.log(`ws:エラー: ${error}`);
      };
    }
  
    function connectChat() {
      if (wsChat && wsChat.readyState === WebSocket.OPEN) {
        return;
      }
  
      wsChat = new WebSocket('ws://127.0.0.1:1880/chatVRM');
      
      wsChat.onmessage = async (event) => {
        const receivedFromWebSocket = event.data.toString();
        // ChatGPTへ送信し音声再生（ただし会話ログが消える不具合有り）
        await handleSendChat(receivedFromWebSocket);
      };
  
      wsChat.onclose = () => {
        console.log('ws:接続が閉じました');
        setTimeout(connectChat, 5000);
      };
  
      wsChat.onerror = (error) => {
        console.log(`ws:エラー: ${error}`);
      };
    }
  
    connectVoice();
    connectChat();
  
    return () => {
      wsVoice?.close();
      wsChat?.close();
    };
  }, []);
// ------------------------------------ーーーーーーーーーーーーーーーーーーーーーーーーーーーーーーー  


// ------------------------------------ーーーーーーーーーーーーーーーーーーーーーーーーーーーーーーー
  useEffect(() => {
    if (window.localStorage.getItem("chatVRMParams")) {
      const params = JSON.parse(
        window.localStorage.getItem("chatVRMParams") as string
      );
      setSystemPrompt(params.systemPrompt);
      setChatLog(params.chatLog);
    }
  }, []);

  useEffect(() => {
    process.nextTick(() =>
      window.localStorage.setItem(
        "chatVRMParams",
        JSON.stringify({ systemPrompt, chatLog })
      )
    );
  }, [systemPrompt, chatLog]);

  const handleChangeChatLog = useCallback(
    (targetIndex: number, text: string) => {
      const newChatLog = chatLog.map((v: Message, i) => {
        return i === targetIndex ? { role: v.role, content: text } : v;
      });

      setChatLog(newChatLog);
    },
    [chatLog]
  );

  /**
   * 文ごとに音声を直列でリクエストしながら再生する
   */
  const handleSpeakAi = useCallback(
    async (
      screenplay: Screenplay,
      onStart?: () => void,
      onEnd?: () => void
    ) => {
      speakCharacter(screenplay, viewer, onStart, onEnd);
    },
    [viewer]
  );

  /**
   * アシスタントとの会話を行う
   */
  const handleSendChat = useCallback(
    async (text: string) => {
      if (!openAiKey) {
        setAssistantMessage("APIキーが入力されていません");
        return;
      }

      const newMessage = text;

      if (newMessage == null) return;

      setChatProcessing(true);
      /* 
      userのメッセージをchatlogに追加した後にchatGPTにmessageLogで今までの会話と共に送信
      */
      // ユーザーの新しいメッセージ（newMessage）を既存のチャットログ（chatLog）に追加
      let messageLog: Message[] = [
        ...chatLog,  // 既存のチャットログを展開（スプレッド構文）
        { role: "user", content: newMessage },  // 新しいユーザーメッセージを追加
      ];

      // 配列の長さが10より大きい場合、古いデータから差分だけ削除（API料金対策）
      const excessCount = messageLog.length - 10;
      if (excessCount > 0) {
        messageLog = messageLog.slice(excessCount); // 古いデータから差分だけ削除
      }

      setChatLog(messageLog);  // 更新されたチャットログを状態にセット

      // Chat GPTに送るメッセージ配列を作成
      const messages: Message[] = [
        {
          role: "system",  // システムからのプロンプトなのでroleは'system'
          content: systemPrompt,  // システムプロンプトの内容
        },
        ...messageLog,  // 既存のメッセージログ（ユーザーとAIの対話履歴）を展開。
      ];

      const stream = await getChatResponseStream(messages, openAiKey).catch(
        (e) => {
          console.error(e);
          return null;
        }
      );
      if (stream == null) {
        setChatProcessing(false);
        return;
      }

      const reader = stream.getReader();
      let receivedMessage = "";
      let aiTextLog = "";
      let tag = "";
      const sentences = new Array<string>();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          receivedMessage += value;
          aiTextLog += value;

          // 返答内容のタグ部分の検出
          const tagMatch = receivedMessage.match(/^\[(.*?)\]/); //\[(.*?)\]: 正規表現で、[ から始まり ] で終わる任意の文字列を検出。
          if (tagMatch && tagMatch[0]) {
            tag = tagMatch[0];
            receivedMessage = receivedMessage.slice(tag.length);
          }

          // 返答を一文単位で切り出して処理する（切り出しキーワード）
          const sentenceMatch = receivedMessage.match(
            /^(.+[。．！？\n]|.{10,}[、,])/
          );
          if (sentenceMatch && sentenceMatch[0]) {
            const sentence = sentenceMatch[0];
            sentences.push(sentence);
            receivedMessage = receivedMessage
              .slice(sentence.length)
              .trimStart();

            // 発話不要/不可能な文字列だった場合はスキップ
            if (
              !sentence.replace(
                /^[\s\[\(\{「［（【『〈《〔｛«‹〘〚〛〙›»〕》〉』】）］」\}\)\]]+$/g,
                ""
              )
            ) {
              continue;
            }
            
            const aiText = `${tag} ${sentence}`;
            const aiTalks = textsToScreenplay([aiText]);

            // 文ごとに音声を生成 & 再生、返答を表示
            const currentAssistantMessage = sentences.join(" ");
            handleSpeakAi(aiTalks[0], () => {
              setAssistantMessage(currentAssistantMessage);
            });
          }
        }

        // ストリームが終了した後の処理: 残ったメッセージも処理
        if (receivedMessage.trim()) {
          const aiText = `${tag} ${receivedMessage.trim()}`;
          const aiTalks = textsToScreenplay([aiText]);
          handleSpeakAi(aiTalks[0], () => {
            setAssistantMessage(receivedMessage.trim());
          });
        }

        console.log("ChatGPT応答文:", aiTextLog); // 全体のメッセージ（タグも含む）を表示
      } catch (e) {
        setChatProcessing(false);
        console.error(e);
      } finally {
        reader.releaseLock();
      }

      // アシスタントの返答をログに追加
      const messageLogAssistant: Message[] = [
        ...messageLog,
        { role: "assistant", content: aiTextLog },
      ];

      setChatLog(messageLogAssistant);
      setChatProcessing(false);
    },
    [systemPrompt, chatLog, handleSpeakAi, openAiKey]
  );

  return (
    <div className={"font-M_PLUS_2"}>
      {/* <Meta /> */}
      <VrmViewer />
      <MessageInputContainer
        isChatProcessing={chatProcessing}
        onChatProcessStart={handleSendChat}
      />
      <Menu
        openAiKey={openAiKey}
        systemPrompt={systemPrompt}
        chatLog={chatLog}
        assistantMessage={assistantMessage}
        onChangeAiKey={setOpenAiKey}
        onChangeSystemPrompt={setSystemPrompt}
        onChangeChatLog={handleChangeChatLog}
        handleClickResetChatLog={() => setChatLog([])}
        handleClickResetSystemPrompt={() => setSystemPrompt(SYSTEM_PROMPT)}
      />
    </div>
  );
}
