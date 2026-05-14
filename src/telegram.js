// src/telegram.js — интеграция с Telegram ботом

const TelegramBot = require('node-telegram-bot-api');
const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// Хранилище подписчиков: Map<chatId, { join: boolean, leave: boolean, switch: boolean }>
let subscribers = new Map();

/**
 * Загрузить подписчиков из файла
 */
function loadSubscribers() {
  try {
    const fs = require('fs');
    if (fs.existsSync('subscribers.json')) {
      const raw = JSON.parse(fs.readFileSync('subscribers.json', 'utf8'));
      if (Array.isArray(raw)) {
        // Новый формат: массив объектов
        subscribers = new Map();
        for (const s of raw) {
          const chatId = s.chatId;
          const settings = {
            join: s.join !== false,
            leave: s.leave !== false,
            switch: s.switch !== false,
          };
          subscribers.set(chatId, settings);
        }
      } else {
        console.warn('[Telegram] Старый формат subscribers.json, начинаем с чистого');
      }
      console.log(`[Telegram] Загружено ${subscribers.size} подписчиков`);
    }
  } catch (error) {
    console.error('[Telegram] Ошибка загрузки подписчиков:', error.message);
  }
}

/**
 * Сохранить подписчиков в файл
 */
function saveSubscribers() {
  try {
    const fs = require('fs');
    const data = Array.from(subscribers.entries()).map(([chatId, settings]) => ({
      chatId,
      ...settings,
    }));
    fs.writeFileSync('subscribers.json', JSON.stringify(data));
    console.log(`[Telegram] Сохранено ${subscribers.size} подписчиков`);
  } catch (error) {
    console.error('[Telegram] Ошибка сохранения подписчиков:', error.message);
  }
}

/**
 * Добавить нового подписчика (все типы уведомлений включены)
 */
function addSubscriber(chatId) {
  subscribers.set(chatId, { join: true, leave: true, switch: true });
  saveSubscribers();
  console.log(`[Telegram] Новый подписчик: ${chatId}`);
}

/**
 * Удалить подписчика полностью
 */
function removeSubscriber(chatId) {
  subscribers.delete(chatId);
  saveSubscribers();
  console.log(`[Telegram] Отписался: ${chatId}`);
}

/**
 * Установить значение конкретного флага для подписчика
 * @param {number} chatId
 * @param {'join'|'leave'|'switch'} type
 * @param {boolean} value
 */
function setSubscriberSetting(chatId, type, value) {
  if (subscribers.has(chatId)) {
    subscribers.get(chatId)[type] = value;
    saveSubscribers();
    console.log(`[Telegram] ${chatId}: ${type} = ${value}`);
  }
}

/**
 * Получить настройки подписчика
 * @param {number} chatId
 * @returns {{ join: boolean, leave: boolean, switch: boolean } | null}
 */
function getSubscriberSettings(chatId) {
  return subscribers.get(chatId) || null;
}

/**
 * Проверить, активен ли подписчик (хотя бы один тип включен)
 */
function isSubscriberActive(chatId) {
  const s = subscribers.get(chatId);
  if (!s) return false;
  return s.join || s.leave || s.switch;
}

/**
 * Получить количество подписчиков (всех)
 */
function getSubscriberCount() {
  return subscribers.size;
}

/**
 * Количество подписчиков, у которых включён указанный тип
 * @param {'join'|'leave'|'switch'} type
 */
function getActiveCountForType(type) {
  let count = 0;
  for (const settings of subscribers.values()) {
    if (settings[type]) count++;
  }
  return count;
}

/**
 * Отправить сообщение подписчикам, у которых включён указанный тип
 * @param {'join'|'leave'|'switch'} type
 * @param {string} message
 */
async function sendToSubscribersByType(type, message) {
  const targetIds = [];
  for (const [chatId, settings] of subscribers.entries()) {
    if (settings[type]) targetIds.push(chatId);
  }

  if (targetIds.length === 0) {
    console.log(`[Telegram] Нет подписчиков для типа '${type}'`);
    return;
  }

  let sent = 0, failed = 0;
  for (const chatId of targetIds) {
    try {
      await telegramBot.sendMessage(chatId, message, { parse_mode: 'HTML' });
      sent++;
    } catch (error) {
      console.error(`[Telegram] Ошибка отправки ${chatId}:`, error.message);
      if (error.response?.statusCode === 403) {
        removeSubscriber(chatId);
      }
      failed++;
    }
  }
  console.log(`[Telegram] Тип '${type}': отправлено ${sent}, ошибок ${failed}`);
}

// ── Форматирование времени ──
function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} мин`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}ч ${m}мин` : `${h}ч`;
}

// ── Уведомления, вызываемые из Discord ──
async function notifyVoiceJoin(username, channelName) {
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const message = `🔊 <b>${username}</b> зашёл в голосовой канал <b>${channelName}</b>\n⏰ ${time}`;
  await sendToSubscribersByType('join', message);
}

async function notifyVoiceLeave(username, channelName, durationMinutes) {
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const duration = formatDuration(durationMinutes);
  const message = `🔇 <b>${username}</b> вышел из голосового канала <b>${channelName}</b>\n⏱️ Был в канале: ${duration}\n⏰ ${time}`;
  await sendToSubscribersByType('leave', message);
}

async function notifyVoiceSwitch(username, fromChannel, toChannel) {
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const message = `🔄 <b>${username}</b> перешёл из <b>${fromChannel}</b> в <b>${toChannel}</b>\n⏰ ${time}`;
  await sendToSubscribersByType('switch', message);
}

// Загружаем при старте
loadSubscribers();

module.exports = {
  notifyVoiceJoin,
  notifyVoiceLeave,
  notifyVoiceSwitch,
  addSubscriber,
  removeSubscriber,
  setSubscriberSetting,
  getSubscriberSettings,
  isSubscriberActive,
  getSubscriberCount,
  getActiveCountForType,
  telegramBot,
};