// ============================================================
// CONFIG - إعدادات البوت
// ============================================================

const path = require("path");

const CONFIG = {
  name: "إيكيدنا",
  kingdom: "مملكة أوريليا",
  prefix: ".",

  developer: "967734232923",

  botPhone: "967715338589",

  authDir:
    process.env.AUTH_DIR ||
    path.join(process.cwd(), "auth_info_baileys"),

  database: path.join(process.cwd(), "database.json"),

  limits: {
    maxWarnings: 3,
    spamWindowMs: 10000,
    spamThreshold: 6,
    repeatWindowMs: 15000,
    repeatThreshold: 3,
    characterGameTimeoutMs: 60000,
  },

  features: {
    autoReply: true,
    aiChat: false,
    animeImages: true,
    downloads: false,
    azkar: true,
  },

  api: {
    openrouterKey: "",
  },

  autoReplies: [
    { trigger: "السلام عليكم", reply: "وعليكم السلام ورحمة الله وبركاته 🌸" },
    { trigger: "صباح الخير", reply: "صباح النور والسرور ☀️" },
    { trigger: "مساء الخير", reply: "مساء الأنوار 🌙" },
    { trigger: "كيفك", reply: "بخير الحمدلله، وأنت؟ 🫖" },
  ],

  header: `⟦ 🫖 𝑬𝒄𝒉𝒊𝒅𝒏𝒂 ⟧
『 بوت إيكيدنا 』
╰─━━━━━━⊱♕⊰━━━━━━─╯`,
};

module.exports = CONFIG;
