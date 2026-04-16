// src/shop.js — обработка покупок из магазина

const { admin, db, getUser, updateUser, getConfig, writeLog, sendNotification } = require('./firebase');

/**
 * Обработать новую покупку из Firestore (триггер на коллекцию purchases)
 * Вызывается при появлении нового документа в purchases
 * @param {object} purchase — данные документа покупки
 * @param {string} purchaseId — ID документа
 * @param {import('discord.js').Guild} guild
 */
async function handlePurchase(purchase, purchaseId, guild) {
  const { userId, itemType, itemData, price } = purchase;

  console.log(`[🛒] Покупка: ${itemType} от ${userId} за ${price} монет`);

  switch (itemType) {
    case 'discord_role':
      await handleDiscordRole(userId, itemData, guild);
      break;
    case 'custom_role':
      await handleCustomRole(userId, itemData, guild);
      break;
    case 'double_xp':
      await handleXpBoost(userId, 2, 7);
      break;
    case 'triple_xp':
      await handleXpBoost(userId, 3, 7);
      break;
    case 'lootbox':
      await handleLootbox(userId, 'common', guild);
      break;
    case 'lootbox_rare':
      await handleLootbox(userId, 'rare', guild);
      break;
    case 'create_event':
      await updateUser(userId, { canCreateEvents: true });
      await sendNotification(userId, {
        type: 'purchase', title: '📅 Право создавать ивенты!',
        message: 'Теперь вы можете создавать ивенты на сайте.',
      });
      break;
    case 'custom_color':
      await updateUser(userId, { customColor: itemData?.color || null });
      break;
    case 'title':
      await updateUser(userId, { title: itemData?.title || null });
      break;
    case 'nick_change':
      // Ник меняется только на сайте, бот не трогает Discord-ник
      break;
  }

  // Отметить покупку как обработанную
  await db.collection('purchases').doc(purchaseId).update({ processed: true, processedAt: admin.firestore.FieldValue.serverTimestamp() });
}

// ── Выдать готовую Discord роль ──────────────────────────────
async function handleDiscordRole(userId, itemData, guild) {
  if (!itemData?.roleId) { console.warn('[Shop] discord_role: нет roleId'); return; }
  try {
    const member = await guild.members.fetch(userId);
    await member.roles.add(itemData.roleId);
    await sendNotification(userId, {
      type: 'purchase', title: '🎭 Роль выдана!',
      message: `Роль добавлена на Discord сервере.`,
    });
    console.log(`[Shop] Роль ${itemData.roleId} → ${member.user.username}`);
  } catch (e) {
    console.error('[Shop] Ошибка выдачи роли:', e.message);
  }
}

// ── Создать кастомную роль ───────────────────────────────────
async function handleCustomRole(userId, itemData, guild) {
  const config      = await getConfig();
  const forbidden   = config.forbiddenRoleWords || [];
  const roleName    = (itemData?.name || 'Custom Role').trim();
  const roleColor   = itemData?.color || '#99AAB5';

  // Проверка запрещённых слов
  const lower = roleName.toLowerCase();
  const hasF  = forbidden.some(w => lower.includes(w.toLowerCase()));
  if (hasF) {
    await sendNotification(userId, {
      type: 'purchase_failed', title: '❌ Покупка отклонена',
      message: `Название роли содержит запрещённое слово. Обратитесь к администратору.`,
    });
    // Вернуть монеты
    const user = await getUser(userId);
    if (user) {
      // Получить цену из последней покупки
      const snap = await db.collection('purchases').where('userId','==',userId).where('itemType','==','custom_role').where('processed','==',false).limit(1).get();
      if (!snap.empty) {
        const price = snap.docs[0].data().price || 0;
        await updateUser(userId, { currency: admin.firestore.FieldValue.increment(price) });
      }
    }
    return;
  }

  try {
    const member = await guild.members.fetch(userId);
    // Создать роль
    const newRole = await guild.roles.create({
      name:        roleName,
      color:       roleColor,
      reason:      `Куплено пользователем ${member.user.username}`,
      permissions: [],
    });
    // Выдать роль
    await member.roles.add(newRole);
    // Сохранить roleId в профиле
    await updateUser(userId, { customRoleId: newRole.id });
    await sendNotification(userId, {
      type: 'purchase', title: `👑 Роль «${roleName}» создана!`,
      message: `Ваша эксклюзивная роль добавлена на сервере.`,
    });
    console.log(`[Shop] Кастомная роль "${roleName}" → ${member.user.username}`);
  } catch (e) {
    console.error('[Shop] Ошибка создания кастомной роли:', e.message);
  }
}

// ── XP-буст ──────────────────────────────────────────────────
async function handleXpBoost(userId, multiplier, days) {
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  await updateUser(userId, { xpMultiplier: multiplier, xpMultiplierExpiresAt: expiresAt });
  await sendNotification(userId, {
    type: 'purchase', title: `⚡ ×${multiplier} XP активирован!`,
    message: `Множитель опыта ×${multiplier} активен на ${days} дней.`,
  });
  console.log(`[Shop] XP ×${multiplier} → ${userId} (${days}д)`);
}

// ── Лутбокс ──────────────────────────────────────────────────
const LOOTBOX_POOLS = {
  common: [
    { type: 'currency', value: 50,   weight: 30, label: '+50 монет' },
    { type: 'currency', value: 100,  weight: 25, label: '+100 монет' },
    { type: 'currency', value: 200,  weight: 15, label: '+200 монет' },
    { type: 'xp',       value: 100,  weight: 20, label: '+100 XP' },
    { type: 'xp',       value: 250,  weight: 8,  label: '+250 XP' },
    { type: 'boost',    value: 2,    weight: 2,  label: '×2 XP на 24ч' },
  ],
  rare: [
    { type: 'currency', value: 300,  weight: 25, label: '+300 монет' },
    { type: 'currency', value: 700,  weight: 15, label: '+700 монет' },
    { type: 'currency', value: 1500, weight: 5,  label: '+1500 монет' },
    { type: 'xp',       value: 500,  weight: 25, label: '+500 XP' },
    { type: 'xp',       value: 1000, weight: 15, label: '+1000 XP' },
    { type: 'boost',    value: 2,    weight: 10, label: '×2 XP на 3д' },
    { type: 'boost',    value: 3,    weight: 5,  label: '×3 XP на 1д' },
  ],
};

function rollLootbox(rarity) {
  const pool  = LOOTBOX_POOLS[rarity] || LOOTBOX_POOLS.common;
  const total = pool.reduce((s, i) => s + i.weight, 0);
  let rand    = Math.random() * total;
  for (const item of pool) {
    rand -= item.weight;
    if (rand <= 0) return item;
  }
  return pool[0];
}

async function handleLootbox(userId, rarity, guild) {
  const reward = rollLootbox(rarity);
  const user   = await getUser(userId);
  if (!user) return;

  let msg = '';
  if (reward.type === 'currency') {
    await updateUser(userId, { currency: admin.firestore.FieldValue.increment(reward.value) });
    msg = `+${reward.value} монет`;
  } else if (reward.type === 'xp') {
    const { addXpAndCurrency } = require('./xp');
    await addXpAndCurrency(userId, { xpBase: reward.value, currencyBase: 0, reason: 'lootbox', guild });
    msg = `+${reward.value} XP`;
  } else if (reward.type === 'boost') {
    const days = rarity === 'rare' ? (reward.value === 3 ? 1 : 3) : 1;
    await handleXpBoost(userId, reward.value, days);
    msg = `×${reward.value} XP на ${days}д`;
  }

  await sendNotification(userId, {
    type: 'purchase', title: `📦 Лутбокс открыт!`,
    message: `Вам выпало: ${reward.label || msg}`,
  });

  console.log(`[Shop] Лутбокс (${rarity}): ${user.username} → ${reward.label}`);
}

/**
 * Слушатель Firestore на новые покупки
 * Вызывать один раз при запуске бота
 */
function listenToPurchases(guild) {
  db.collection('purchases')
    .where('processed', '==', false)
    .onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const purchase = change.doc.data();
          handlePurchase(purchase, change.doc.id, guild).catch(e => {
            console.error('[Shop] Ошибка обработки покупки:', e.message);
          });
        }
      });
    });
  console.log('[Shop] 🎧 Слушаем новые покупки...');
}

module.exports = { handlePurchase, listenToPurchases };
