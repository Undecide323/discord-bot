// src/telegramBot.js — обработчик команд Telegram бота с Reply-кнопками

const TelegramBot = require('node-telegram-bot-api');
const telegram = require('./telegram');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

console.log('[Telegram Bot] Запущен с polling...');

// ── /start ──
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  telegram.addSubscriber(chatId);

  bot.sendMessage(chatId,
    `👋 Привет, ${msg.from.first_name}!\n\n` +
    `Ты подписан на уведомления о заходах в голосовые каналы Discord сервера Gray Squad.\n` +
    `Уведомления сейчас <b>включены</b>.\n\n` +
    `Используй команды:\n` +
    `/status — общая статистика\n` +
    `/settings — настроить уведомления\n` +
    `/stop — отписаться`,
    { parse_mode: 'HTML' }
  );
});

// ── /stop ──
bot.onText(/\/stop/, (msg) => {
  const chatId = msg.chat.id;
  telegram.removeSubscriber(chatId);
  bot.sendMessage(chatId, '❌ Ты отписался от уведомлений. Чтобы снова подписаться, отправь /start');
});

// ── /status (просто статистика) ──
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const total = telegram.getSubscriberCount();
  const active = telegram.getActiveSubscriberCount();

  await bot.sendMessage(chatId,
    `📊 <b>Статистика подписчиков</b>\n` +
    `Всего: ${total}\n` +
    `Активных (с включёнными уведомлениями): ${active}`,
    { parse_mode: 'HTML' }
  );
});

// ── /settings (Reply-кнопки для управления уведомлениями) ──
bot.onText(/\/settings/, async (msg) => {
  const chatId = msg.chat.id;
  if (!telegram.isSubscriberActive(chatId) && !telegram.getSubscriberCount()) {
    return bot.sendMessage(chatId, 'Вы не подписаны. Отправьте /start чтобы начать.');
  }

  const isActive = telegram.isSubscriberActive(chatId);

  // Reply-клавиатура
  const keyboard = {
    keyboard: [
      [{ text: isActive ? '🔕 Выключить уведомления' : '🔔 Включить уведомления' }],
      [{ text: '📊 Статус' }] // дополнительная кнопка для удобства
    ],
    resize_keyboard: true,
    one_time_keyboard: false // клавиатура остаётся до следующей смены
  };

  await bot.sendMessage(chatId,
    `⚙️ <b>Настройки уведомлений</b>\n\n` +
    `Ваш статус: ${isActive ? '🟢 Включены' : '🔴 Выключены'}\n\n` +
    `Нажмите кнопку ниже, чтобы переключить.`,
    {
      parse_mode: 'HTML',
      reply_markup: keyboard
    }
  );
});

// ── Обработка Reply-кнопок (обычные сообщения) ──
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Игнорируем команды, чтобы не было двойной обработки
  if (!text || text.startsWith('/')) return;

  // Проверяем, подписан ли пользователь
  if (!telegram.getSubscriberCount() || !telegram.isSubscriberActive(chatId) && text !== '🔔 Включить уведомления') {
    // Если не подписан, можно предложить /start
    if (text === '🔕 Выключить уведомления' || text === '🔔 Включить уведомления') {
      return bot.sendMessage(chatId, 'Вы не подписаны. Отправьте /start');
    }
    return;
  }

  if (text === '🔕 Выключить уведомления') {
    telegram.setSubscriberActive(chatId, false);
    // Обновляем клавиатуру
    const keyboard = {
      keyboard: [
        [{ text: '🔔 Включить уведомления' }],
        [{ text: '📊 Статус' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    };
    return bot.sendMessage(chatId,
      '🔴 Уведомления <b>выключены</b>. Вы не будете получать сообщения о голосовых каналах.',
      {
        parse_mode: 'HTML',
        reply_markup: keyboard
      }
    );
  }

  if (text === '🔔 Включить уведомления') {
    telegram.setSubscriberActive(chatId, true);
    const keyboard = {
      keyboard: [
        [{ text: '🔕 Выключить уведомления' }],
        [{ text: '📊 Статус' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    };
    return bot.sendMessage(chatId,
      '🟢 Уведомления <b>включены</b>! Теперь вы будете получать оповещения о заходах в голосовые каналы.',
      {
        parse_mode: 'HTML',
        reply_markup: keyboard
      }
    );
  }

  if (text === '📊 Статус') {
    // Быстрый вызов /status
    const total = telegram.getSubscriberCount();
    const active = telegram.getActiveSubscriberCount();
    return bot.sendMessage(chatId,
      `📊 <b>Статистика подписчиков</b>\nВсего: ${total}\nАктивных: ${active}`,
      { parse_mode: 'HTML' }
    );
  }
});

// Обработка ошибок polling
bot.on('polling_error', (error) => {
  console.error('[Telegram Bot] Polling error:', error.message);
});

module.exports = bot;