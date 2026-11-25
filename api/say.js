// 文字を「ななみ」の声の音声にして返す、Vercel用のサーバー関数。
// 使い方: GET /api/say?text=こんにちは  または  POST /api/say {"text":"こんにちは"}
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");

const VOICE = "ja-JP-NanamiNeural";
const MAX_LENGTH = 300; // 一度に読み上げる文字数の上限
const TIMEOUT_MS = 25000; // これ以上かかったら諦めてエラーを返す

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function getText(req) {
  if (req.method === "POST") {
    const raw = await readBody(req);
    if (!raw) return "";
    try {
      const data = JSON.parse(raw);
      return typeof data.text === "string" ? data.text : "";
    } catch {
      return "";
    }
  }
  const url = new URL(req.url, "http://localhost");
  return url.searchParams.get("text") || "";
}

async function synthesize(text) {
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 15000 });
  try {
    await tts.setMetadata(
      VOICE,
      OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3
    );
    const { audioStream } = tts.toStream(text);
    const chunks = [];
    await new Promise((resolve, reject) => {
      audioStream.on("data", (chunk) => chunks.push(chunk));
      audioStream.on("end", resolve);
      audioStream.on("error", reject);
    });
    const audio = Buffer.concat(chunks);
    if (audio.length === 0) throw new Error("音声が空でした");
    return audio;
  } finally {
    try {
      tts.close();
    } catch {
      // 閉じる時の小さなエラーは無視する
    }
  }
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return sendJson(res, 405, { error: "GETかPOSTで送ってください" });
  }

  let text;
  try {
    text = (await getText(req)).trim();
  } catch {
    return sendJson(res, 400, { error: "送られた内容が読めませんでした" });
  }
  if (!text) {
    return sendJson(res, 400, { error: "読み上げる文字が入っていません" });
  }
  if (text.length > MAX_LENGTH) {
    return sendJson(res, 400, {
      error: `文字が長すぎます（${MAX_LENGTH}文字まで）`,
    });
  }

  try {
    const audio = await Promise.race([
      synthesize(text),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("時間がかかりすぎました")), TIMEOUT_MS)
      ),
    ]);
    res.statusCode = 200;
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audio.length);
    res.setHeader("Cache-Control", "no-store");
    res.end(audio);
  } catch (err) {
    console.error("synthesis failed:", err && err.message);
    return sendJson(res, 502, {
      error:
        "今、声の元に届きませんでした。少し待ってから、もう一度試してください。",
    });
  }
};
