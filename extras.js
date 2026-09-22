// ============================================================
// EXTRAS - الميزات الإضافية
// ============================================================

const axios = require("axios");
const CONFIG = require("./config");

// ============================================================
// ردود تلقائية
// ============================================================

function getAutoReply(text) {
  if (!CONFIG.features.autoReply) return null;
  const norm = text.trim();
  for (const r of CONFIG.autoReplies) {
    if (norm.includes(r.trigger)) {
      return r.reply;
    }
  }
  return null;
}

// ============================================================
// أذكار وأدعية
// ============================================================

const AZKAR = [
  "سبحان الله وبحمده، سبحان الله العظيم 🌸",
  "لا إله إلا الله وحده لا شريك له 🌙",
  "اللهم صل وسلم على نبينا محمد ﷺ",
  "أستغفر الله العظيم وأتوب إليه",
  "الحمد لله على كل حال 🤍",
  "لا حول ولا قوة إلا بالله",
  "اللهم إني أسألك الجنة وأعوذ بك من النار",
  "حسبي الله ونعم الوكيل",
  "اللهم اجعلنا من أهل القرآن",
  "اللهم اغفر لنا ولوالدينا وللمسلمين",
];

function getRandomZikr() {
  return AZKAR[Math.floor(Math.random() * AZKAR.length)];
}

// ============================================================
// صور أنمي
// ============================================================

async function getAnimeImage(category = "waifu") {
  try {
    const res = await axios.get(
      `https://api.waifu.pics/sfw/${category}`
    );
    return res.data.url;
  } catch (err) {
    console.error("Anime image error:", err.message);
    return null;
  }
}

// ============================================================
// بحث يوتيوب
// ============================================================

async function searchYoutube(query) {
  try {
    const yts = require("yt-search");
    const r = await yts(query);
    const video = r.videos[0];
    if (!video) return null;
    return {
      title: video.title,
      url: video.url,
      duration: video.timestamp,
      thumbnail: video.thumbnail,
      views: video.views,
      author: video.author.name,
    };
  } catch (err) {
    console.error("YouTube search error:", err.message);
    return null;
  }
}

// ============================================================
// ذكاء اصطناعي - OpenRouter
// ============================================================

async function askAI(prompt) {
  if (!CONFIG.features.aiChat) return null;
  if (!CONFIG.api.openrouterKey) {
    return "❌ لم يتم ضبط مفتاح الذكاء الاصطناعي.";
  }

  try {
    const res = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "meta-llama/llama-3.1-8b-instruct:free",
        messages: [
          {
            role: "system",
            content:
              "أنت بوت اسمه إيكيدنا من مملكة أوريليا. تجيب بالعربية بشكل مختصر ومفيد وودود.",
          },
          { role: "user", content: prompt },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${CONFIG.api.openrouterKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );
    return res.data?.choices?.[0]?.message?.content || "❌ لم أستطع الرد.";
  } catch (err) {
    console.error("AI error:", err.response?.data || err.message);
    return "❌ حدث خطأ في الاتصال بالذكاء الاصطناعي.";
  }
}

// ============================================================
// تصدير
// ============================================================

module.exports = {
  getAutoReply,
  getRandomZikr,
  getAnimeImage,
  searchYoutube,
  askAI,
  AZKAR,
};
