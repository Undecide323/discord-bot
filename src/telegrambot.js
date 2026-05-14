// src/telegramBot.js — обработчик команд Telegram бота

const TelegramBot = require('node-telegram-bot-api');
const telegram = require('./telegram');

// Создаем отдельного бота с polling для приема сообщений
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

console.log('[Telegram Bot] Запущен с polling...');

// Команда /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  telegram.addSubscriber(chatId);
  
  const message = `👋 Привет, ${msg.from.first_name}!\n\n` +
    `Теперь ты будешь получать уведомления когда <b>Андрій</b> заходит или выходит из голосовых каналов Discord сервера Gray Squad!\n\n` +
    `Команды:\n` +
    `/status — статистика подписчиков\n` +
    `/stop — отписаться от уведомлений`;
  
  bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
});

// Команда /stop
bot.onText(/\/stop/, (msg) => {
  const chatId = msg.chat.id;
  telegram.removeSubscriber(chatId);
  bot.sendMessage(chatId, '❌ Ты отписался от уведомлений. Чтобы снова подписаться, отправь /start');
});

// Команда /status
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const count = telegram.getSubscriberCount();
  bot.sendMessage(chatId, `📊 Количество подписчиков: <b>${count}</b>`, { parse_mode: 'HTML' });
});

// Обработка ошибок polling
bot.on('polling_error', (error) => {
  console.error('[Telegram Bot] Polling error:', error.message);
});

module.exports = bot;