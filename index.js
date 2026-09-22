// ============================================================
// ECHIDNA BOT - بوت إيكيدنا
// مملكة أوريليا
// ============================================================

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");

const P = require("pino");
const fs = require("fs");
const path = require("path");
const CONFIG = require("./config");
const extras = require("./extras");

// ============================================================
// أدوات مساعدة
// ============================================================

function reply(text) {
  return `${CONFIG.header}\n\n${text}`;
}

function normalize(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

function jidToNumber(jid = "") {
  return String(jid).split("@")[0].split(":")[0];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function unwrap(m) {
  if (!m) return m;
  return (
    m.ephemeralMessage?.message ||
    m.viewOnceMessage?.message ||
    m.viewOnceMessageV2?.message ||
    m.viewOnceMessageV2Extension?.message ||
    m.documentWithCaptionMessage?.message ||
    m
  );
}

function getText(message) {
  const m = unwrap(message.message);
  if (!m) return "";
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ""
  );
}

// ============================================================
// قاعدة البيانات
// ============================================================

function createDatabase() {
  return {
    developer: CONFIG.developer,
    elite: [],
    groups: {},
    users: {},
    warnings: {},
    securityLogs: [],
  };
}

function loadDatabase() {
  try {
    if (!fs.existsSync(CONFIG.database)) {
      const db = createDatabase();
      fs.writeFileSync(CONFIG.database, JSON.stringify(db, null, 2));
      return db;
    }
    return JSON.parse(fs.readFileSync(CONFIG.database, "utf8"));
  } catch (err) {
    console.error("⚠️ خطأ في قاعدة البيانات:", err);
    const db = createDatabase();
    fs.writeFileSync(CONFIG.database, JSON.stringify(db, null, 2));
    return db;
  }
}

let DB = loadDatabase();

let saveTimer = null;
function saveDatabase() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const tmp = CONFIG.database + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(DB, null, 2));
      fs.renameSync(tmp, CONFIG.database);
    } catch (err) {
      console.error("⚠️ خطأ في حفظ قاعدة البيانات:", err);
    }
  }, 500);
}

function saveDatabaseNow() {
  try {
    const tmp = CONFIG.database + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(DB, null, 2));
    fs.renameSync(tmp, CONFIG.database);
  } catch (err) {
    console.error("⚠️ خطأ في حفظ قاعدة البيانات:", err);
  }
}

// ============================================================
// المستخدمون
// ============================================================

function ensureUser(id) {
  if (!DB.users[id]) {
    DB.users[id] = {
      id,
      name: "",
      points: 0,
      xp: 0,
      level: 1,
      messages: 0,
      joinedAt: Date.now(),
    };
    saveDatabase();
  }
  return DB.users[id];
}

function addPoints(id, amount) {
  const u = ensureUser(id);
  u.points += amount;
  saveDatabase();
  return u.points;
}

function addXP(id, amount) {
  const u = ensureUser(id);
  u.xp += amount;
  const newLevel = Math.floor(u.xp / 100) + 1;
  const leveled = newLevel > u.level;
  u.level = newLevel;
  saveDatabase();
  return { level: u.level, leveledUp: leveled };
}

function getRanking(limit = 10) {
  return Object.values(DB.users)
    .sort((a, b) =>
      b.points !== a.points ? b.points - a.points : b.xp - a.xp
    )
    .slice(0, limit);
}

// ============================================================
// الصلاحيات
// ============================================================

const PERMISSIONS = {
  KICK: "kick",
  WARN: "warn",
  DELETE: "delete",
  LOCK: "lock",
  UNLOCK: "unlock",
  WELCOME: "welcome",
  SECURITY: "security",
  GAMES: "games",
  SETTINGS: "settings",
};

function isDeveloper(id) {
  if (!CONFIG.developer) return false;
  const clean = String(CONFIG.developer).replace(/\D/g, "");
  if (!clean) return false;
  return jidToNumber(id) === clean;
}

function getElite(id) {
  const number = jidToNumber(id);
  return DB.elite.find((u) => u.number === number);
}

function isElite(id) {
  return Boolean(getElite(id));
}

function hasPermission(id, permission) {
  if (isDeveloper(id)) return true;
  const elite = getElite(id);
  if (!elite) return false;
  return elite.permissions.includes(permission);
}

function addElite(number, name, permissions = []) {
  const clean = String(number).replace(/\D/g, "");
  const existing = DB.elite.find((u) => u.number === clean);
  if (existing) {
    existing.name = name;
    existing.permissions = permissions;
  } else {
    DB.elite.push({
      number: clean,
      name,
      permissions,
      addedAt: Date.now(),
    });
  }
  saveDatabase();
}

function removeElite(number) {
  const clean = String(number).replace(/\D/g, "");
  DB.elite = DB.elite.filter((u) => u.number !== clean);
  saveDatabase();
}

async function isGroupAdmin(sock, groupId, userId) {
  try {
    const meta = await sock.groupMetadata(groupId);
    const p = meta.participants.find((x) => x.id === userId);
    return !!(p && (p.admin === "admin" || p.admin === "superadmin"));
  } catch {
    return false;
  }
}

async function canModerate(sock, sender, groupId, permission) {
  if (isDeveloper(sender)) return true;
  if (await isGroupAdmin(sock, groupId, sender)) return true;
  return hasPermission(sender, permission);
}// ============================================================
// المجموعات
// ============================================================

function ensureGroup(groupId) {
  if (!DB.groups[groupId]) {
    DB.groups[groupId] = {
      name: "",
      welcome: {
        enabled: false,
        message:
`🎌 أهلاً وسهلاً @العضو
نورت ${CONFIG.kingdom} 🔥

من طرف مين جيت؟
اكتب لنا لقب الشخص الي عطاك رابط الانضمام 👑`,
      },
      goodbye: {
        enabled: false,
        message: `👋 وداعاً @العضو، نتمنى لك التوفيق.`,
      },
      security: {
        enabled: true,
        contactCard: true,
        swearing: true,
        spam: true,
        repeatedMessages: true,
        links: true,
      },
      locked: false,
    };
    saveDatabase();
  }
  return DB.groups[groupId];
}

// ============================================================
// التحذيرات
// ============================================================

function warnKey(groupId, userId) {
  return `${groupId}:${userId}`;
}

function getWarnings(groupId, userId) {
  return DB.warnings[warnKey(groupId, userId)] || 0;
}

function addWarning(groupId, userId) {
  const key = warnKey(groupId, userId);
  const next = (DB.warnings[key] || 0) + 1;
  DB.warnings[key] = next;
  saveDatabase();
  return {
    count: next,
    action: next >= CONFIG.limits.maxWarnings ? "kick" : "warn",
  };
}

function removeWarning(groupId, userId) {
  const key = warnKey(groupId, userId);
  const current = DB.warnings[key] || 0;
  DB.warnings[key] = Math.max(0, current - 1);
  saveDatabase();
  return DB.warnings[key];
}

function resetWarnings(groupId, userId) {
  delete DB.warnings[warnKey(groupId, userId)];
  saveDatabase();
}

// ============================================================
// الكلمات الممنوعة
// ============================================================

const PROFANITY = [
  "كس", "كسم", "كسخت", "كسختك", "قحبه", "قحبة",
  "شرموط", "شرموطة", "عرص", "متناك", "منايك",
  "منيوك", "ينيك", "نيك", "خرا", "زب", "زبي",
  "زق", "وسخ", "وسخه", "يلعن امك", "يلعن ابوك",
  "ابن الكلب", "ابن القحبة",
];

const PROFANITY_SET = new Set(
  PROFANITY.map((w) => normalize(w).replace(/\s/g, ""))
);

function containsProfanity(text) {
  const words = normalize(text).split(/\s+/);
  for (const w of words) {
    const cw = w.replace(/\s/g, "");
    if (PROFANITY_SET.has(cw)) return true;
  }
  const value = normalize(text).replace(/\s/g, "");
  for (const bad of PROFANITY_SET) {
    if (bad.includes(" ")) {
      if (value.includes(bad.replace(/\s/g, ""))) return true;
    }
  }
  return false;
}

// ============================================================
// السبام / التكرار / الروابط
// ============================================================

const activity = {};

function checkSpam(groupId, userId) {
  const key = `${groupId}:${userId}`;
  if (!activity[key]) activity[key] = [];
  const now = Date.now();
  activity[key] = activity[key].filter(
    (t) => now - t < CONFIG.limits.spamWindowMs
  );
  activity[key].push(now);
  return activity[key].length > CONFIG.limits.spamThreshold;
}

const repeated = {};

function checkRepeated(groupId, userId, text) {
  const key = `${groupId}:${userId}`;
  if (!repeated[key]) repeated[key] = [];
  const value = normalize(text);
  const now = Date.now();
  repeated[key] = repeated[key].filter(
    (i) => now - i.time < CONFIG.limits.repeatWindowMs
  );
  repeated[key].push({ text: value, time: now });
  const count = repeated[key].filter((i) => i.text === value).length;
  return count >= CONFIG.limits.repeatThreshold;
}

function clearRepeated(groupId, userId) {
  repeated[`${groupId}:${userId}`] = [];
}

const LINK_REGEX = /(https?:\/\/|www\.)[^\s]+/i;
function containsLink(text) {
  return LINK_REGEX.test(text);
}

function isContactMessage(message) {
  const m = unwrap(message.message);
  if (!m) return false;
  return Boolean(m.contactMessage || m.contactsArrayMessage);
}

// ============================================================
// عمليات المجموعة
// ============================================================

async function botIsAdmin(sock, groupId) {
  try {
    const meta = await sock.groupMetadata(groupId);
    const botId = sock.user.id;
    const p = meta.participants.find((x) => x.id === botId);
    return !!(p && (p.admin === "admin" || p.admin === "superadmin"));
  } catch {
    return false;
  }
}

async function lockGroup(sock, groupId) {
  try {
    if (!(await botIsAdmin(sock, groupId))) return false;
    await sock.groupSettingUpdate(groupId, "announcement");
    ensureGroup(groupId).locked = true;
    saveDatabase();
    return true;
  } catch (err) {
    console.error("Lock error:", err);
    return false;
  }
}

async function unlockGroup(sock, groupId) {
  try {
    if (!(await botIsAdmin(sock, groupId))) return false;
    await sock.groupSettingUpdate(groupId, "not_announcement");
    ensureGroup(groupId).locked = false;
    saveDatabase();
    return true;
  } catch (err) {
    console.error("Unlock error:", err);
    return false;
  }
}

async function kick(sock, groupId, userId) {
  try {
    if (!(await botIsAdmin(sock, groupId))) return false;
    await sock.groupParticipantsUpdate(groupId, [userId], "remove");
    return true;
  } catch (err) {
    console.error("Kick error:", err);
    return false;
  }
}

async function deleteMessage(sock, message) {
  try {
    await sock.sendMessage(message.key.remoteJid, {
      delete: message.key,
    });
    return true;
  } catch (err) {
    return false;
  }
}

async function isMember(sock, groupId, userId) {
  try {
    const meta = await sock.groupMetadata(groupId);
    return meta.participants.some((p) => p.id === userId);
  } catch {
    return false;
  }
}

// ============================================================
// الترحيب / الوداع
// ============================================================

async function sendWelcome(sock, groupId, userId) {
  const group = ensureGroup(groupId);
  if (!group.welcome.enabled) return;
  let message = group.welcome.message.replace(
    /@العضو/g,
    `@${jidToNumber(userId)}`
  );
  await sock.sendMessage(groupId, {
    text: message,
    mentions: [userId],
  });
}

async function sendGoodbye(sock, groupId, userId) {
  const group = ensureGroup(groupId);
  if (!group.goodbye.enabled) return;
  let message = group.goodbye.message.replace(
    /@العضو/g,
    `@${jidToNumber(userId)}`
  );
  await sock.sendMessage(groupId, {
    text: message,
    mentions: [userId],
  });
}

// ============================================================
// استخراج العضو المذكور (منشن أو رد)
// ============================================================

function getMentioned(message) {
  const m = unwrap(message.message);
  const ctx = m?.extendedTextMessage?.contextInfo;
  // أولاً: منشن مباشر
  if (ctx?.mentionedJid?.length) {
    return ctx.mentionedJid[0];
  }
  // ثانياً: الرد على رسالة عضو
  if (ctx?.participant) {
    return ctx.participant;
  }
  return null;
  }// ============================================================
// الألعاب
// ============================================================

// -------------------------
// حجر ورقة مقص
// -------------------------
const RPS = ["حجر", "ورق", "مقص"];

function rpsWinner(user, bot) {
  if (user === bot) return "draw";
  if (
    (user === "حجر" && bot === "مقص") ||
    (user === "ورق" && bot === "حجر") ||
    (user === "مقص" && bot === "ورق")
  )
    return "win";
  return "lose";
}

async function playRPS(sender, choice) {
  choice = normalize(choice);
  if (!RPS.includes(choice)) {
    return reply(`🎮 استخدم:\n\n.حجر\n.ورق\n.مقص`);
  }
  const bot = RPS[Math.floor(Math.random() * RPS.length)];
  const result = rpsWinner(choice, bot);

  if (result === "win") {
    addPoints(sender, 10);
    addXP(sender, 15);
    return reply(
`🎮 أنت: ${choice}
🫖 إيكيدنا: ${bot}

🏆 فزت!
+10 نقاط
+15 XP`
    );
  }
  if (result === "draw") {
    addPoints(sender, 3);
    addXP(sender, 5);
    return reply(
`🎮 أنت: ${choice}
🫖 إيكيدنا: ${bot}

🤝 تعادل!
+3 نقاط
+5 XP`
    );
  }
  return reply(
`🎮 أنت: ${choice}
🫖 إيكيدنا: ${bot}

💀 خسرت.`
  );
}

// -------------------------
// تخمين الشخصيات
// -------------------------
const CHARACTERS = [
  { name: "إيكيدنا", anime: "Re:Zero", hints: ["شخصية مرتبطة بالمعرفة.", "تحب الشاي.", "ظهرت في Re:Zero."] },
  { name: "ناروتو", anime: "Naruto", hints: ["نينجا.", "يحلم بأن يصبح هوكاغي.", "من قرية الورق."] },
  { name: "لوفي", anime: "One Piece", hints: ["قرصان.", "يحب اللحم.", "يحلم بأن يصبح ملك القراصنة."] },
  { name: "ليفاي", anime: "Attack on Titan", hints: ["جندي قوي.", "يهتم بالنظافة.", "من فيلق الاستطلاع."] },
  { name: "غوكو", anime: "Dragon Ball", hints: ["سايان.", "يحب القتال.", "يبحث عن الكرات السحرية."] },
  { name: "زورو", anime: "One Piece", hints: ["سياف.", "يستخدم 3 سيوف.", "يضيع دائماً."] },
  { name: "كاكاشي", anime: "Naruto", hints: ["نينجا منسوخ.", "يغطي عينه.", "يحب روايات جيرايا."] },
  { name: "إرين", anime: "Attack on Titan", hints: ["يحلم بالحرية.", "لديه قوة العمالقة.", "من الجدار."] },
  { name: "تانجيرو", anime: "Demon Slayer", hints: ["قاتل شياطين.", "يحمل سيفاً أسود.", "يبحث عن علاج لأخته."] },
  { name: "نيزوكو", anime: "Demon Slayer", hints: ["أخت تانجيرو.", "تحمل صندوقاً خشبياً.", "تضع قطعة قماش في فمها."] },
];

const characterGames = {};

function startCharacterGame(groupId) {
  if (characterGames[groupId]) {
    return { success: false, message: "❌ هناك لعبة جارية بالفعل." };
  }
  const character = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
  const game = {
    character,
    hints: 0,
    startedAt: Date.now(),
    timer: null,
  };
  game.timer = setTimeout(() => {
    if (characterGames[groupId]) {
      delete characterGames[groupId];
    }
  }, CONFIG.limits.characterGameTimeoutMs);
  characterGames[groupId] = game;
  return { success: true, character };
}

function answerCharacter(groupId, sender, answer) {
  const game = characterGames[groupId];
  if (!game) return null;
  const correct = normalize(answer) === normalize(game.character.name);
  if (!correct) return { correct: false };
  addPoints(sender, 20);
  addXP(sender, 30);
  const name = game.character.name;
  clearTimeout(game.timer);
  delete characterGames[groupId];
  return { correct: true, answer: name };
}

function getHint(groupId) {
  const game = characterGames[groupId];
  if (!game) return null;
  game.hints++;
  const idx = Math.min(game.hints, game.character.hints.length - 1);
  return game.character.hints[idx];
}

// -------------------------
// لعبة XO
// -------------------------
const xoGames = {};

function startXO(groupId, sender, opponent) {
  if (xoGames[groupId]) return { success: false, message: "❌ هناك لعبة XO جارية." };
  xoGames[groupId] = {
    board: Array(9).fill(null),
    x: sender,
    o: opponent,
    turn: sender,
    startedAt: Date.now(),
  };
  return { success: true };
}

function renderXO(board) {
  const cell = (i) => board[i] || "➖";
  return (
`1️⃣ ${cell(0)} | ${cell(1)} | ${cell(2)}
2️⃣ ${cell(3)} | ${cell(4)} | ${cell(5)}
3️⃣ ${cell(6)} | ${cell(7)} | ${cell(8)}

اكتب رقم الخانة (1-9)`
  );
}

function xoCheck(board) {
  const wins = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6],
  ];
  for (const [a,b,c] of wins) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  if (board.every((c) => c)) return "draw";
  return null;
}

function playXOMove(groupId, sender, index) {
  const game = xoGames[groupId];
  if (!game) return null;
  if (game.turn !== sender) return { error: "ليس دورك." };
  if (index < 1 || index > 9) return { error: "اختر رقماً من 1 إلى 9." };
  const i = index - 1;
  if (game.board[i]) return { error: "الخانة محجوزة." };
  const mark = sender === game.x ? "❌" : "⭕";
  game.board[i] = mark;
  const result = xoCheck(game.board);
  if (result) {
    const xId = game.x;
    const oId = game.o;
    delete xoGames[groupId];
    return { finished: true, result, board: game.board, x: xId, o: oId };
  }
  game.turn = game.turn === game.x ? game.o : game.x;
  return { board: game.board, next: game.turn };
}

// ============================================================
// محلل الأوامر
// ============================================================

function parseCommand(text) {
  if (!text.startsWith(CONFIG.prefix)) return null;
  const raw = text.slice(CONFIG.prefix.length).trim();
  if (!raw) return null;
  const parts = raw.split(/\s+/);
  let command = parts.shift();
  const first = normalize(command);

  // الأوامر المركبة
  if (first === "elite" && parts.length) {
    command = command + " " + parts.shift();
  }
  if (first === "نخبه" && parts.length) {
    command = command + " " + parts.shift();
  }
  if (first === "تفعيل" && parts.length) {
    command = command + " " + parts.shift();
  }
  if (first === "تعطيل" && parts.length) {
    command = command + " " + parts.shift();
  }
  if (first === "رساله" && parts.length) {
    command = command + " " + parts.shift();
  }
  if (first === "رسالة" && parts.length) {
    command = command + " " + parts.shift();
  }
  if (first === "لعبه" && parts.length) {
    command = command + " " + parts.shift();
  }
  if (first === "لعبة" && parts.length) {
    command = command + " " + parts.shift();
  }

  return { command: normalize(command), args: parts, raw };
      }
// ============================================================
// معالجة أوامر الإدارة
// ============================================================

async function handleAdminCommand(sock, message, command, args) {
  const sender = message.key.participant || message.key.remoteJid;
  const groupId = message.key.remoteJid;

  if (command === "قفل") {
    if (!(await canModerate(sock, sender, groupId, PERMISSIONS.LOCK))) {
      return "❌ ليس لديك صلاحية قفل المجموعة.";
    }
    const ok = await lockGroup(sock, groupId);
    return ok ? "🔒 تم قفل المجموعة." : "❌ فشل القفل (تأكد أن البوت مشرف).";
  }

  if (command === "فتح") {
    if (!(await canModerate(sock, sender, groupId, PERMISSIONS.UNLOCK))) {
      return "❌ ليس لديك صلاحية فتح المجموعة.";
    }
    const ok = await unlockGroup(sock, groupId);
    return ok ? "🔓 تم فتح المجموعة." : "❌ فشل الفتح (تأكد أن البوت مشرف).";
  }

  if (command === "تحذير") {
    if (!(await canModerate(sock, sender, groupId, PERMISSIONS.WARN))) {
      return "❌ ليس لديك صلاحية التحذير.";
    }
    const target = getMentioned(message);
    if (!target) return "❌ منشن العضو أو رد على رسالته.";
    if (!(await isMember(sock, groupId, target))) {
      return "❌ العضو ليس في المجموعة.";
    }
    const result = addWarning(groupId, target);
    if (result.action === "kick") {
      await kick(sock, groupId, target);
      resetWarnings(groupId, target);
      return `🚪 العضو وصل إلى ${CONFIG.limits.maxWarnings} تحذيرات وتم طرده.`;
    }
    return `⚠️ تم تحذير العضو.\nعدد التحذيرات: ${result.count}/${CONFIG.limits.maxWarnings}`;
  }

  if (command === "تحذيرات") {
    if (!(await canModerate(sock, sender, groupId, PERMISSIONS.WARN))) {
      return "❌ ليس لديك صلاحية.";
    }
    const target = getMentioned(message);
    if (!target) return "❌ منشن العضو أو رد على رسالته.";
    return `⚠️ تحذيرات العضو: ${getWarnings(groupId, target)}/${CONFIG.limits.maxWarnings}`;
  }

  if (command === "ازاله تحذير" || command === "إزالة تحذير") {
    if (!(await canModerate(sock, sender, groupId, PERMISSIONS.WARN))) {
      return "❌ ليس لديك صلاحية.";
    }
    const target = getMentioned(message);
    if (!target) return "❌ منشن العضو أو رد على رسالته.";
    const count = removeWarning(groupId, target);
    return `✅ عدد التحذيرات الآن: ${count}/${CONFIG.limits.maxWarnings}`;
  }

  if (command === "طرد") {
    if (!(await canModerate(sock, sender, groupId, PERMISSIONS.KICK))) {
      return "❌ ليس لديك صلاحية الطرد.";
    }
    const target = getMentioned(message);
    if (!target) return "❌ منشن العضو أو رد على رسالته.";
    if (!(await isMember(sock, groupId, target))) {
      return "❌ العضو ليس في المجموعة.";
    }
    const ok = await kick(sock, groupId, target);
    return ok ? "🚪 تم طرد العضو." : "❌ فشل الطرد (تأكد أن البوت مشرف).";
  }

  if (command === "تفعيل ترحيب") {
    if (!(await canModerate(sock, sender, groupId, PERMISSIONS.WELCOME))) {
      return "❌ ليس لديك صلاحية.";
    }
    ensureGroup(groupId).welcome.enabled = true;
    saveDatabase();
    return "✅ تم تفعيل الترحيب.";
  }

  if (command === "تعطيل ترحيب") {
    if (!(await canModerate(sock, sender, groupId, PERMISSIONS.WELCOME))) {
      return "❌ ليس لديك صلاحية.";
    }
    ensureGroup(groupId).welcome.enabled = false;
    saveDatabase();
    return "✅ تم تعطيل الترحيب.";
  }

  if (command === "رساله ترحيب" || command === "رسالة ترحيب") {
    if (!(await canModerate(sock, sender, groupId, PERMISSIONS.WELCOME))) {
      return "❌ ليس لديك صلاحية.";
    }
    const text = args.join(" ");
    if (!text) return "❌ اكتب رسالة الترحيب.";
    const g = ensureGroup(groupId);
    g.welcome.message = text;
    g.welcome.enabled = true;
    saveDatabase();
    return "✅ تم حفظ رسالة الترحيب.";
  }

  if (command === "تفعيل وداع") {
    if (!(await canModerate(sock, sender, groupId, PERMISSIONS.WELCOME))) {
      return "❌ ليس لديك صلاحية.";
    }
    ensureGroup(groupId).goodbye.enabled = true;
    saveDatabase();
    return "✅ تم تفعيل الوداع.";
  }

  if (command === "تعطيل وداع") {
    if (!(await canModerate(sock, sender, groupId, PERMISSIONS.WELCOME))) {
      return "❌ ليس لديك صلاحية.";
    }
    ensureGroup(groupId).goodbye.enabled = false;
    saveDatabase();
    return "✅ تم تعطيل الوداع.";
  }

  if (command === "رساله وداع" || command === "رسالة وداع") {
    if (!(await canModerate(sock, sender, groupId, PERMISSIONS.WELCOME))) {
      return "❌ ليس لديك صلاحية.";
    }
    const text = args.join(" ");
    if (!text) return "❌ اكتب رسالة الوداع.";
    const g = ensureGroup(groupId);
    g.goodbye.message = text;
    g.goodbye.enabled = true;
    saveDatabase();
    return "✅ تم حفظ رسالة الوداع.";
  }

  return null;
}

// ============================================================
// أوامر النخبة (Elite) والمطور
// ============================================================

async function handleElite(sock, message, command, args) {
  const sender = message.key.participant || message.key.remoteJid;
  const groupId = message.key.remoteJid;
  if (!isDeveloper(sender)) return "❌ هذا الأمر للمطور فقط.";

  // -------------------------
  // elite add (بالإنجليزية - الرقم)
  // -------------------------
  if (command === "elite add") {
    const number = args[0];
    const name = args.slice(1).join(" ") || "Elite";
    if (!number) return "❌ استخدم: .elite add الرقم الاسم";
    addElite(number, name, Object.values(PERMISSIONS));
    return "👑 تم إضافة العضو إلى Elite بكل الصلاحيات.";
  }

  // -------------------------
  // elite remove
  // -------------------------
  if (command === "elite remove") {
    const number = args[0];
    if (!number) return "❌ اكتب الرقم.";
    removeElite(number);
    return "✅ تم إزالة العضو من Elite.";
  }

  // -------------------------
  // elite list
  // -------------------------
  if (command === "elite list") {
    if (!DB.elite.length) return "لا يوجد أعضاء في Elite.";
    let text = "👑 أعضاء Elite:\n\n";
    DB.elite.forEach((e, i) => {
      text += `${i + 1}. ${e.name} — ${e.number}\n`;
    });
    return text;
  }

  // -------------------------
  // نخبه اضف (بالمنشن أو الرد)
  // -------------------------
  if (command === "نخبه اضف") {
    const target = getMentioned(message);
    if (!target) return "❌ منشن العضو أو رد على رسالته.";
    if (!(await isMember(sock, groupId, target))) {
      return "❌ العضو ليس في المجموعة.";
    }
    const number = jidToNumber(target);
    const name = `عضو ${number.slice(-4)}`;
    addElite(number, name, Object.values(PERMISSIONS));
    return {
      text: reply(
`👑 تم إضافة العضو إلى النخبة

📱 الرقم: ${number}
✨ الصلاحيات: كاملة`
      ),
      mentions: [target],
    };
  }

  // -------------------------
  // نخبه ازل
  // -------------------------
  if (command === "نخبه ازل") {
    const target = getMentioned(message);
    if (!target) return "❌ منشن العضو أو رد على رسالته.";
    const number = jidToNumber(target);
    const existed = DB.elite.find((u) => u.number === number);
    if (!existed) return "❌ هذا العضو ليس في النخبة.";
    removeElite(number);
    return {
      text: reply(`✅ تم إزالة العضو من النخبة\n📱 الرقم: ${number}`),
      mentions: [target],
    };
  }

  // -------------------------
  // نخبه قائمه (عرض القائمة)
  // -------------------------
  if (command === "نخبه قائمه") {
    if (!DB.elite.length) return "لا يوجد أعضاء في النخبة.";
    let text = "👑 أعضاء النخبة:\n\n";
    DB.elite.forEach((e, i) => {
      text += `${i + 1}. ${e.name} — ${e.number}\n`;
    });
    return text;
  }

  return null;
}

// ============================================================
// معالج الأوامر الرئيسي
// ============================================================

async function handleCommand(sock, message, parsed) {
  const sender = message.key.participant || message.key.remoteJid;
  const groupId = message.key.remoteJid;
  const isGroup = groupId.endsWith("@g.us");
  const { command, args } = parsed;

  // أوامر عامة مسموحة للجميع
  const publicCommands = [
    "قوانين", "نقاط", "مستوى", "ترتيب", "بوت",
    "حجر", "ورق", "مقص", "المطور", "اوامر", "أوامر",
    "ذكر", "انمي", "نيكو", "ايديت",
  ];

  const isPrivileged =
    isDeveloper(sender) ||
    isElite(sender) ||
    (isGroup && (await isGroupAdmin(sock, groupId, sender)));

  if (!isPrivileged && !publicCommands.includes(command)) {
    return null;
  }

  // -------------------------
  // أمر تست (للمطور والنخبة فقط)
  // -------------------------
  if (command === "تست") {
    if (!isDeveloper(sender) && !isElite(sender)) {
      return "❌ هذا الأمر للمطور أو النخبة فقط.";
    }

    await sock.sendMessage(groupId, {
      text: reply(CONFIG.testMessage),
    });

    if (CONFIG.testImageUrl) {
      try {
        await sock.sendMessage(groupId, {
          image: { url: CONFIG.testImageUrl },
          caption: reply("🍵 إيكيدنا"),
        });
      } catch (err) {
        console.error("Test image error:", err.message);
      }
    }

    return null;
  }

  // -------------------------
  // أوامر الإدارة
  // -------------------------
  const adminResult = await handleAdminCommand(sock, message, command, args);
  if (adminResult) return adminResult;

  // -------------------------
  // أوامر النخبة
  // -------------------------
  const eliteResult = await handleElite(sock, message, command, args);
  if (eliteResult) return eliteResult;

  // -------------------------
  // قوانين
  // -------------------------
  if (command === "قوانين") {
    return reply(
`📜 قوانين ${CONFIG.kingdom}

1️⃣ الاحترام المتبادل.
2️⃣ ممنوع السب والإهانة.
3️⃣ ممنوع السبام.
4️⃣ ممنوع نشر الروابط بدون إذن.
5️⃣ ممنوع إرسال بطاقات جهات الاتصال.
6️⃣ مخالفة القوانين تؤدي إلى تحذير أو طرد.`
    );
  }

  // -------------------------
  // نقاط / مستوى
  // -------------------------
  if (command === "نقاط") {
    const u = ensureUser(sender);
    return reply(
`🏆 نقاطك: ${u.points}
⭐ XP: ${u.xp}
📈 المستوى: ${u.level}`
    );
  }

  if (command === "مستوى") {
    const u = ensureUser(sender);
    return reply(`📈 مستواك: ${u.level}\n⭐ XP: ${u.xp}`);
  }

  if (command === "ترتيب") {
    const ranking = getRanking(10);
    if (!ranking.length) return reply("لا يوجد ترتيب حتى الآن.");
    let text = `🏆 ترتيب ${CONFIG.kingdom}\n\n`;
    ranking.forEach((u, i) => {
      text += `${i + 1}. @${jidToNumber(u.id)} — ${u.points} نقطة\n`;
    });
    return {
      text: reply(text),
      mentions: ranking.map((u) => u.id),
    };
  }

  // -------------------------
  // حجر ورق مقص
  // -------------------------
  if (["حجر", "ورق", "مقص"].includes(command)) {
    return playRPS(sender, command);
  }

  // -------------------------
  // ذكر
  // -------------------------
  if (command === "ذكر" || command === "ذكرني") {
    return reply(`🕌 ${extras.getRandomZikr()}`);
  }

  // -------------------------
  // صور أنمي
  // -------------------------
  if (command === "انمي") {
    const url = await extras.getAnimeImage("waifu");
    if (!url) return reply("❌ تعذر جلب الصورة.");
    return {
      image: { url },
      caption: reply("🌸 صورة أنمي عشوائية"),
    };
  }

  if (command === "نيكو") {
    const url = await extras.getAnimeImage("neko");
    if (!url) return reply("❌ تعذر جلب الصورة.");
    return {
      image: { url },
      caption: reply("🐱 صورة نيكو"),
    };
  }

  // -------------------------
  // بوت / المطور / أوامر
  // -------------------------
  if (command === "بوت") {
    return reply(
`🫖 ${CONFIG.name}
مملكة: ${CONFIG.kingdom}
الحالة: متصل 🟢`
    );
  }

  if (command === "المطور") {
    return reply(`👑 المطور: ${CONFIG.developer}`);
  }

  if (command === "اوامر" || command === "أوامر") {
    return reply(
`📖 قائمة الأوامر

🔒 الإدارة:
.قفل / .فتح
.طرد
.تحذير / .تحذيرات
.ازالة تحذير

👑 النخبة (للمطور):
.نخبه اضف @عضو
.نخبه ازل @عضو
.نخبه قائمه

🎌 الترحيب:
.تفعيل ترحيب / .تعطيل ترحيب
.رسالة ترحيب <النص>
.تفعيل وداع / .تعطيل وداع
.رسالة وداع <النص>

🎮 الألعاب:
.حجر / .ورق / .مقص
.لعبة شخصيات
.تلميح
.xo @عضو

📊 الإحصائيات:
.نقاط / .مستوى / .ترتيب

🕌 إسلامي:
.ذكر

🌸 أنمي:
.انمي / .نيكو

🧪 اختبار:
.تست

ℹ️ عام:
.قوانين / .بوت / .المطور`
    );
  }

  // -------------------------
  // لعبة الشخصيات
  // -------------------------
  if (command === "لعبه شخصيات" || command === "لعبة شخصيات") {
    if (!isPrivileged) return "❌ ليس لديك صلاحية بدء الألعاب.";
    const game = startCharacterGame(groupId);
    if (!game.success) return reply(game.message);
    return reply(
`🎌 بدأت لعبة تخمين الشخصية!

🎭 الأنمي: ${game.character.anime}

💡 التلميح الأول:
${game.character.hints[0]}

⏱️ الوقت: 60 ثانية

اكتب اسم الشخصية.`
    );
  }

  if (command === "تلميح") {
    const hint = getHint(groupId);
    if (!hint) return reply("❌ لا توجد لعبة جارية.");
    return reply(`💡 ${hint}`);
  }

  // -------------------------
  // XO
  // -------------------------
  if (command === "xo") {
    const opponent = getMentioned(message);
    if (!opponent) return "❌ منشن الخصم: .xo @عضو";
    if (opponent === sender) return "❌ لا يمكنك اللعب ضد نفسك.";
    const r = startXO(groupId, sender, opponent);
    if (!r.success) return reply(r.message);
    return {
      text: reply(
`🎮 بدأت لعبة XO!

❌ @${jidToNumber(sender)}
⭕ @${jidToNumber(opponent)}

${renderXO(Array(9).fill(null))}`
      ),
      mentions: [sender, opponent],
    };
  }

  // -------------------------
  // ايديت (بحث صور)
  // -------------------------
  if (command === "ايديت") {
    const query = args.join(" ");
    if (!query) return reply("❌ مثال:\n.ايديت ايكيدنا");
    const search = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(
      query + " anime edit"
    )}`;
    return reply(`✨ بحث إيديت:\n${search}\n\n🔎 البحث: ${query}`);
  }

  return null;
      }
// ============================================================
// معالجة الرسائل الواردة
// ============================================================

async function processMessage(sock, message) {
  if (!message.message) return;
  const jid = message.key.remoteJid;
  if (jid === "status@broadcast") return;
  if (message.key.fromMe) return;

  const sender = message.key.participant || jid;
  const text = getText(message);
  const isGroup = jid.endsWith("@g.us");

  ensureUser(sender);
  DB.users[sender].messages++;
  saveDatabase();

  // -------------------------
  // بطاقة جهة اتصال
  // -------------------------
  if (isGroup && isContactMessage(message)) {
    if (isDeveloper(sender)) return;
    const group = ensureGroup(jid);
    if (!group.security.enabled || !group.security.contactCard) return;

    const botAdmin = await botIsAdmin(sock, jid);
    if (botAdmin) {
      await lockGroup(sock, jid);
      await kick(sock, jid, sender);
    }
    await deleteMessage(sock, message);

    DB.securityLogs.push({
      type: "contact_card",
      groupId: jid,
      userId: sender,
      time: Date.now(),
    });
    saveDatabase();
    return;
  }

  // -------------------------
  // الأمر
  // -------------------------
  const parsed = parseCommand(text);
  if (parsed) {
    try {
      const result = await handleCommand(sock, message, parsed);
      if (!result) return;
      if (typeof result === "string") {
        await sock.sendMessage(jid, { text: result });
      } else {
        await sock.sendMessage(jid, result);
      }
    } catch (err) {
      console.error("Command error:", err);
    }
    return;
  }

  // -------------------------
  // إجابة لعبة الشخصيات (قبل الفلاتر)
  // -------------------------
  if (isGroup && characterGames[jid] && text) {
    const result = answerCharacter(jid, sender, text);
    if (result?.correct) {
      await sock.sendMessage(jid, {
        text: reply(
`🏆 إجابة صحيحة!

👑 الفائز: @${jidToNumber(sender)}

🎭 الشخصية: ${result.answer}

+20 نقطة
+30 XP`
        ),
        mentions: [sender],
      });
      return;
    }
  }

  // -------------------------
  // XO - حركة
  // -------------------------
  if (isGroup && xoGames[jid] && /^[1-9]$/.test(text.trim())) {
    const move = playXOMove(jid, sender, parseInt(text.trim(), 10));
    if (move?.error) {
      await sock.sendMessage(jid, { text: reply(move.error) });
      return;
    }
    if (move?.finished) {
      let msg;
      if (move.result === "draw") {
        msg = "🤝 تعادل!";
      } else {
        const winnerJid = move.result === "❌" ? move.x : move.o;
        msg = `🏆 الفائز: @${jidToNumber(winnerJid)}`;
      }
      await sock.sendMessage(jid, {
        text: reply(msg),
        mentions: [move.x, move.o],
      });
      return;
    }
    if (move?.board) {
      await sock.sendMessage(jid, {
        text: reply(
`${renderXO(move.board)}

دور: @${jidToNumber(move.next)}`
        ),
        mentions: [move.next],
      });
      return;
    }
  }

  // -------------------------
  // ردود تلقائية
  // -------------------------
  if (isGroup) {
    const auto = extras.getAutoReply(text);
    if (auto) {
      await sock.sendMessage(jid, { text: auto });
      return;
    }
  }

  // -------------------------
  // خارج المجموعات: XP فقط
  // -------------------------
  if (!isGroup) {
    addXP(sender, 1);
    return;
  }

  // -------------------------
  // فلاتر الأمان
  // -------------------------
  if (isDeveloper(sender)) {
    addXP(sender, 1);
    return;
  }

  const group = ensureGroup(jid);

  // سب
  if (group.security.swearing && containsProfanity(text)) {
    await deleteMessage(sock, message);
    const w = addWarning(jid, sender);
    if (w.action === "kick") {
      await kick(sock, jid, sender);
      resetWarnings(jid, sender);
      await sock.sendMessage(jid, {
        text: reply(`🚪 تم طرد العضو بعد ${CONFIG.limits.maxWarnings} تحذيرات.`),
      });
      return;
    }
    await sock.sendMessage(jid, {
      text: reply(
`⚠️ تم حذف الرسالة بسبب السب.

تحذيراتك: ${w.count}/${CONFIG.limits.maxWarnings}`
      ),
    });
    return;
  }

  // سبام
  if (group.security.spam && checkSpam(jid, sender)) {
    await deleteMessage(sock, message);
    const w = addWarning(jid, sender);
    if (w.action === "kick") {
      await kick(sock, jid, sender);
      resetWarnings(jid, sender);
    }
    await sock.sendMessage(jid, {
      text: reply(
`🚨 سبام!

تحذيراتك: ${w.count}/${CONFIG.limits.maxWarnings}`
      ),
    });
    return;
  }

  // تكرار
  if (
    group.security.repeatedMessages &&
    checkRepeated(jid, sender, text)
  ) {
    clearRepeated(jid, sender);
    await deleteMessage(sock, message);
    const w = addWarning(jid, sender);
    if (w.action === "kick") {
      await kick(sock, jid, sender);
      resetWarnings(jid, sender);
    }
    await sock.sendMessage(jid, {
      text: reply(
`🔁 تكرار الرسائل!

تحذيراتك: ${w.count}/${CONFIG.limits.maxWarnings}`
      ),
    });
    return;
  }

  // روابط
  if (group.security.links && containsLink(text)) {
    await deleteMessage(sock, message);
    const w = addWarning(jid, sender);
    if (w.action === "kick") {
      await kick(sock, jid, sender);
      resetWarnings(jid, sender);
      await sock.sendMessage(jid, {
        text: reply(`🚪 تم طرد العضو بعد ${CONFIG.limits.maxWarnings} تحذيرات.`),
      });
      return;
    }
    await sock.sendMessage(jid, {
      text: reply(
`🔗 تم حذف الرابط.

تحذيراتك: ${w.count}/${CONFIG.limits.maxWarnings}`
      ),
    });
    return;
  }

  addXP(sender, 1);
}

// ============================================================
// أحداث المجموعة (دخول / خروج)
// ============================================================

async function handleParticipants(sock, update) {
  const { id, participants, action } = update;
  if (action === "add") {
    for (const userId of participants) {
      await sendWelcome(sock, id, userId);
    }
  } else if (action === "remove") {
    for (const userId of participants) {
      await sendGoodbye(sock, id, userId);
    }
  }
}

// ============================================================
// الاتصال
// ============================================================

let sock;

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(CONFIG.authDir);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    browser: Browsers.appropriate("Chrome"),
    markOnlineOnConnect: false,
    logger: P({ level: "silent" }),
    syncFullHistory: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      console.log("================================");
      console.log(`🟢 ${CONFIG.name} متصل بواتساب`);
      console.log(`👑 ${CONFIG.kingdom}`);
      console.log("================================");
      return;
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log("🔴 تم إغلاق الاتصال:", code);
      if (code !== DisconnectReason.loggedOut) {
        console.log("🔄 إعادة الاتصال...");
        await sleep(3000);
        connect();
      } else {
        console.log("⚠️ الحساب خرج من الجلسة.");
      }
    }
  });

  if (!state.creds.registered) {
    const number = CONFIG.botPhone.replace(/\D/g, "");
    if (!number) {
      console.log("⚠️ WHATSAPP_PHONE_NUMBER غير مضبوط.");
    } else {
      await sleep(3000);
      try {
        const code = await sock.requestPairingCode(number);
        console.log("================================");
        console.log("🔑 كود الاقتران:", code);
        console.log("================================");
      } catch (err) {
        console.error("❌ فشل طلب كود الاقتران:", err.message);
      }
    }
  }

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const message of messages) {
      try {
        await processMessage(sock, message);
      } catch (err) {
        console.error("⚠️ خطأ في معالجة الرسالة:", err);
      }
    }
  });

  sock.ev.on("group-participants.update", async (update) => {
    try {
      await handleParticipants(sock, update);
    } catch (err) {
      console.error("⚠️ خطأ في أحداث الأعضاء:", err);
    }
  });
}

// ============================================================
// بدء التشغيل
// ============================================================

console.log(CONFIG.header);
console.log("🚀 جاري تشغيل البوت...");

process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("uncaughtException:", err));
process.on("SIGINT", () => { saveDatabaseNow(); process.exit(0); });
process.on("SIGTERM", () => { saveDatabaseNow(); process.exit(0); });

connect().catch((err) => {
  console.error("❌ خطأ في الاتصال:", err);
  process.exit(1);
});
