// functions/index.js

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

admin.initializeApp();
const db = admin.database();

const OPENAI_API_KEY = "";
const MAX_HISTORY = 10;

const SYSTEM_PROMPT = `
あなたは「DeepDive」という名前のコーチングAIです。
日本語で会話しながら、ユーザーのキャリアや仕事のモヤモヤを整理し、
本音・価値観・選択肢を一緒に言語化します。

出力フォーマットは必ず次の3ブロックにしてください：

【事実】
- ユーザーの発言から、事実ベースで言えることを箇条書きで整理する

【仮説】
- 事実から推測される可能性を箇条書きで整理する
- 推測であることを前提に、言い切りすぎない表現にする

【問い】
- ユーザーが自分で考えを深められるような質問を1〜2個だけ投げかける
- 質問は具体的にしすぎず、「考える余白」を残す

トーンは落ち着いてフラットに。
相手を評価したり決めつけたりせず、「一緒に考える相棒」として振る舞ってください。
`;

exports.replyWithGPT = functions
  .database.ref("/chat/{pushId}")
  .onCreate(async (snapshot, context) => {
    const data = snapshot.val();

    // Bot 側の書き込みなど、user じゃないものは無視
    if (!data || data.role !== "user") {
      console.log("ユーザーメッセージではないのでスキップします");
      return null;
    }

    if (!OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY が設定されていません");
      return null;
    }

    try {
      // 直近 MAX_HISTORY 件をキー順で取得（createdAt なしでも動く）
      const historySnap = await db
        .ref("chat")
        .orderByKey()
        .limitToLast(MAX_HISTORY)
        .once("value");

      const historyMessages = [];

      historySnap.forEach((child) => {
        const msg = child.val();
        if (!msg || !msg.text) return;

        const role = msg.role === "assistant" ? "assistant" : "user";

        historyMessages.push({
          role: role,
          content: msg.text,
        });
      });

      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...historyMessages,
      ];

      console.log(
        "OpenAI に送るメッセージ:",
        JSON.stringify(messages, null, 2)
      );

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          messages: messages,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("OpenAI API エラー:", response.status, errorText);
        return null;
      }

      const result = await response.json();
      const reply =
        result &&
        result.choices &&
        result.choices[0] &&
        result.choices[0].message &&
        result.choices[0].message.content
          ? result.choices[0].message.content
          : "うまく返答を生成できませんでした。もう一度試してもらえますか？";

      console.log("OpenAI からの返答:", reply);

      const botRef = db.ref("chat").push();
      await botRef.set({
        uname: "DeepDive Bot",
        text: reply,
        role: "assistant",
        createdAt: admin.database.ServerValue.TIMESTAMP,
      });

      return null;
    } catch (err) {
      console.error("OpenAI 呼び出し中にエラー:", err);
      return null;
    }
  });