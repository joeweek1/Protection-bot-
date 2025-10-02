const { 
  Client, 
  GatewayIntentBits, 
  Collection, 
  SlashCommandBuilder, 
  REST, 
  Routes, 
  ActivityType, 
  Events, 
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

// تحميل الإعدادات من config.json
let config;
try {
  config = require('./config.json');
  console.log(chalk.green('✅ تم تحميل الإعدادات من config.json'));
} catch (error) {
  console.log(chalk.red('❌ خطأ في تحميل config.json:'), error.message);
  console.log(chalk.yellow('⚠️ تأكد من وجود ملف config.json في نفس المجلد'));
  process.exit(1);
}

// التحقق من التوكن
if (!config.client.token || config.client.token === "YOUR_BOT_TOKEN_HERE") {
  console.log(chalk.red('❌ لم تقم بإعداد التوكن في config.json'));
  console.log(chalk.yellow('📝 يرجى تعديل config.json وإضافة التوكن الصحيح'));
  process.exit(1);
}

// إنشاء العميل
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildIntegrations
  ]
});

// المجموعات
client.commands = new Collection();
client.protection = new Collection();
client.warnings = new Collection();
client.backups = new Collection();
client.deletedItems = new Collection();

// نظام التحذيرات
const warningSystem = {
  addWarning: (userId, reason = 'غير محدد', moderator = 'System') => {
    if (!client.warnings.has(userId)) {
      client.warnings.set(userId, []);
    }
    const warnings = client.warnings.get(userId);
    warnings.push({
      reason,
      timestamp: Date.now(),
      moderator: moderator
    });
    
    // تطبيق العقوبات التلقائية
    const warningCount = warnings.length;
    const actionConfig = config.warnings.actions.find(a => a.warnings === warningCount);
    
    if (actionConfig) {
      warningSystem.applyAction(userId, actionConfig);
    }
    
    // حفظ في ملف
    warningSystem.saveWarnings();
    return warningCount;
  },
  
  applyAction: async (userId, actionConfig) => {
    try {
      const guild = client.guilds.cache.get(config.client.guildId);
      if (!guild) return;
      
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return;
      
      switch (actionConfig.action) {
        case 'timeout':
          await member.timeout(actionConfig.duration, `تلقائي بعد ${actionConfig.warnings} تحذيرات`);
          break;
        case 'kick':
          await member.kick(`تلقائي بعد ${actionConfig.warnings} تحذيرات`);
          break;
        case 'ban':
          await member.ban({ reason: `تلقائي بعد ${actionConfig.warnings} تحذيرات` });
          break;
      }
    } catch (error) {
      console.log(chalk.yellow(`⚠️ تعذر تطبيق العقوبة: ${error.message}`));
    }
  },
  
  getWarnings: (userId) => {
    return client.warnings.get(userId) || [];
  },
  
  clearWarnings: (userId) => {
    const result = client.warnings.delete(userId);
    warningSystem.saveWarnings();
    return result;
  },
  
  getWarningCount: (userId) => {
    return client.warnings.has(userId) ? client.warnings.get(userId).length : 0;
  },
  
  saveWarnings: () => {
    if (!config.settings.autoSave) return;
    
    try {
      if (!fs.existsSync('./data')) {
        fs.mkdirSync('./data');
      }
      
      const warningsData = {};
      client.warnings.forEach((warns, userId) => {
        warningsData[userId] = warns;
      });
      fs.writeFileSync('./data/warnings.json', JSON.stringify(warningsData, null, 2));
    } catch (error) {
      console.log(chalk.yellow('⚠️ تعذر حفظ التحذيرات في الملف'));
    }
  },
  
  loadWarnings: () => {
    try {
      if (fs.existsSync('./data/warnings.json')) {
        const data = fs.readFileSync('./data/warnings.json', 'utf8');
        const warningsData = JSON.parse(data);
        Object.entries(warningsData).forEach(([userId, warns]) => {
          client.warnings.set(userId, warns);
        });
        console.log(chalk.green('✅ تم تحميل التحذيرات من الملف'));
      }
    } catch (error) {
      console.log(chalk.yellow('⚠️ تعذر تحميل التحذيرات من الملف'));
    }
  }
};

// نظام النسخ الاحتياطي
const backupSystem = {
  createBackup: async (guild) => {
    const backup = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      guild: {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL(),
        description: guild.description,
        features: guild.features,
        verificationLevel: guild.verificationLevel,
        roles: [],
        channels: [],
        emojis: [],
        stickers: []
      }
    };

    // حفظ الأدوار
    if (config.backup.saveRoles) {
      guild.roles.cache.forEach(role => {
        if (role.managed || role.id === guild.id) return;
        backup.guild.roles.push({
          id: role.id,
          name: role.name,
          color: role.color,
          permissions: role.permissions.bitfield.toString(),
          position: role.position,
          mentionable: role.mentionable,
          hoist: role.hoist,
          icon: role.iconURL(),
          unicodeEmoji: role.unicodeEmoji
        });
      });
    }

    // حفظ القنوات
    if (config.backup.saveChannels) {
      guild.channels.cache.forEach(channel => {
        backup.guild.channels.push({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          parent: channel.parentId,
          position: channel.position,
          topic: channel.topic,
          nsfw: channel.nsfw,
          bitrate: channel.bitrate,
          userLimit: channel.userLimit,
          rateLimitPerUser: channel.rateLimitPerUser,
          permissions: channel.permissionOverwrites.cache.map(perm => ({
            id: perm.id,
            type: perm.type,
            allow: perm.allow.bitfield.toString(),
            deny: perm.deny.bitfield.toString()
          }))
        });
      });
    }

    // حفظ الإيموجي
    if (config.backup.saveEmojis) {
      guild.emojis.cache.forEach(emoji => {
        backup.guild.emojis.push({
          id: emoji.id,
          name: emoji.name,
          animated: emoji.animated,
          url: emoji.url
        });
      });
    }

    // حفظ الاستيكر
    if (config.backup.saveStickers) {
      guild.stickers.cache.forEach(sticker => {
        backup.guild.stickers.push({
          id: sticker.id,
          name: sticker.name,
          description: sticker.description,
          format: sticker.format,
          url: sticker.url
        });
      });
    }

    client.backups.set(backup.id, backup);
    backupSystem.cleanOldBackups();
    backupSystem.saveBackups();
    
    return backup;
  },

  listBackups: () => {
    return Array.from(client.backups.values()).sort((a, b) => b.timestamp - a.timestamp);
  },

  restoreBackup: async (guild, backupId) => {
    const backup = client.backups.get(backupId);
    if (!backup) throw new Error('النسخة الاحتياطية غير موجودة');

    const results = {
      roles: { success: 0, failed: 0 },
      channels: { success: 0, failed: 0 },
      emojis: { success: 0, failed: 0 }
    };

    // استعادة الأدوار
    if (config.backup.saveRoles) {
      for (const roleData of backup.guild.roles) {
        try {
          await guild.roles.create({
            name: roleData.name,
            color: roleData.color,
            permissions: BigInt(roleData.permissions),
            mentionable: roleData.mentionable,
            hoist: roleData.hoist,
            reason: 'استعادة من النسخة الاحتياطية'
          });
          results.roles.success++;
        } catch (error) {
          results.roles.failed++;
          console.log(chalk.yellow(`⚠️ تعذر إنشاء الدور: ${roleData.name}`));
        }
      }
    }

    return results;
  },

  cleanOldBackups: () => {
    const backups = backupSystem.listBackups();
    if (backups.length > config.backup.maxBackups) {
      const toDelete = backups.slice(config.backup.maxBackups);
      toDelete.forEach(backup => {
        client.backups.delete(backup.id);
      });
    }
  },

  saveBackups: () => {
    if (!config.settings.autoSave) return;
    
    try {
      if (!fs.existsSync('./data')) {
        fs.mkdirSync('./data');
      }
      
      const backupsData = {};
      client.backups.forEach((backup, id) => {
        backupsData[id] = backup;
      });
      fs.writeFileSync('./data/backups.json', JSON.stringify(backupsData, null, 2));
    } catch (error) {
      console.log(chalk.yellow('⚠️ تعذر حفظ النسخ الاحتياطية في الملف'));
    }
  },

  loadBackups: () => {
    try {
      if (fs.existsSync('./data/backups.json')) {
        const data = fs.readFileSync('./data/backups.json', 'utf8');
        const backupsData = JSON.parse(data);
        Object.entries(backupsData).forEach(([id, backup]) => {
          client.backups.set(id, backup);
        });
        console.log(chalk.green('✅ تم تحميل النسخ الاحتياطية من الملف'));
      }
    } catch (error) {
      console.log(chalk.yellow('⚠️ تعذر تحميل النسخ الاحتياطية من الملف'));
    }
  },

  deleteBackup: (backupId) => {
    const result = client.backups.delete(backupId);
    if (result) {
      backupSystem.saveBackups();
    }
    return result;
  }
};

// نظام الحماية
const protectionSystem = {
  checkRaid: (guild, member) => {
    if (!config.protection.antiRaid.enabled || protectionSystem.isWhitelisted(member.id)) return false;
    
    const key = `raid_${guild.id}`;
    if (!client.protection.has(key)) {
      client.protection.set(key, []);
    }
    
    const joins = client.protection.get(key);
    joins.push(Date.now());
    
    // تنظيف المدخلات القديمة
    const recentJoins = joins.filter(time => Date.now() - time < config.protection.antiRaid.timeframe);
    client.protection.set(key, recentJoins);
    
    if (recentJoins.length > config.protection.antiRaid.maxJoins) {
      return true; // اكتشاف هجوم
    }
    return false;
  },

  checkSpam: (message) => {
    if (!config.protection.antiSpam.enabled || protectionSystem.isWhitelisted(message.author.id)) return false;
    
    const key = `spam_${message.author.id}`;
    if (!client.protection.has(key)) {
      client.protection.set(key, []);
    }
    
    const messages = client.protection.get(key);
    messages.push(Date.now());
    
    // تنظيف الرسائل القديمة
    const recentMessages = messages.filter(time => Date.now() - time < config.protection.antiSpam.timeframe);
    client.protection.set(key, recentMessages);
    
    return recentMessages.length > config.protection.antiSpam.maxMessages;
  },

  checkMention: (message) => {
    if (!config.protection.antiMention.enabled || protectionSystem.isWhitelisted(message.author.id)) return false;
    
    const mentions = message.mentions.users.size + message.mentions.roles.size;
    return mentions > config.protection.antiMention.maxMentions;
  },

  checkLinks: (message) => {
    if (!config.protection.antiLink.enabled || protectionSystem.isWhitelisted(message.author.id)) return false;
    
    const linkRegex = /https?:\/\/[^\s]+/g;
    const links = message.content.match(linkRegex);
    if (!links) return false;
    
    const allowed = config.protection.antiLink.allowedDomains;
    return links.some(link => !allowed.some(domain => link.includes(domain)));
  },

  checkNuke: (guild, actionType, userId) => {
    if (!config.protection.antiNuke.enabled || protectionSystem.isWhitelisted(userId)) return false;
    
    const key = `nuke_${guild.id}_${userId}`;
    if (!client.protection.has(key)) {
      client.protection.set(key, []);
    }
    
    const actions = client.protection.get(key);
    actions.push({
      type: actionType,
      timestamp: Date.now()
    });
    
    // تنظيف الإجراءات القديمة
    const recentActions = actions.filter(action => Date.now() - action.timestamp < config.protection.antiNuke.timeframe);
    client.protection.set(key, recentActions);
    
    return recentActions.length > config.protection.antiNuke.maxActions;
  },

  isWhitelisted: (userId) => {
    return config.settings.whitelist.includes(userId);
  },

  logAction: (action, details) => {
    const timestamp = new Date().toLocaleString('ar-SA');
    console.log(chalk.yellow(`🛡️ [${timestamp}] ${action}: ${details}`));
  },

  takeAction: async (actionType, target, reason) => {
    try {
      switch (actionType) {
        case 'kick':
          await target.kick(reason);
          break;
        case 'ban':
          await target.ban({ reason });
          break;
        case 'delete':
          // للمرسages فقط
          if (target.delete) await target.delete();
          break;
        case 'timeout':
          await target.timeout(300000, reason); // 5 دقائق
          break;
      }
      return true;
    } catch (error) {
      console.log(chalk.yellow(`⚠️ تعذر تنفيذ الإجراء ${actionType}: ${error.message}`));
      return false;
    }
  }
};

// نظام تتبع العناصر المحذوفة
const restoreSystem = {
  trackDeletedRole: (role) => {
    if (!client.deletedItems.has('roles')) {
      client.deletedItems.set('roles', []);
    }
    const roles = client.deletedItems.get('roles');
    roles.push({
      id: role.id,
      name: role.name,
      color: role.color,
      permissions: role.permissions.bitfield.toString(),
      position: role.position,
      deletedAt: Date.now()
    });
  },

  trackDeletedChannel: (channel) => {
    if (!client.deletedItems.has('channels')) {
      client.deletedItems.set('channels', []);
    }
    const channels = client.deletedItems.get('channels');
    channels.push({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parent: channel.parentId,
      position: channel.position,
      deletedAt: Date.now()
    });
  },

  getDeletedRoles: () => {
    return client.deletedItems.get('roles') || [];
  },

  getDeletedChannels: () => {
    return client.deletedItems.get('channels') || [];
  },

  clearDeletedRoles: () => {
    client.deletedItems.set('roles', []);
  },

  clearDeletedChannels: () => {
    client.deletedItems.set('channels', []);
  }
};

// تعريف الأوامر
const commands = [
  // أوامر الحماية
  new SlashCommandBuilder()
    .setName('protection')
    .setDescription('إدارة نظام الحماية')
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('عرض حالة جميع أنظمة الحماية')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('warnings')
        .setDescription('عرض تحذيرات عضو معين')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('العضو المراد عرض تحذيراته')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear_warnings')
        .setDescription('مسح تحذيرات عضو')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('العضو المراد مسح تحذيراته')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('whitelist')
        .setDescription('إدارة القائمة البيضاء')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('العضو المراد إضافته أو إزالته')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('action')
            .setDescription('الإجراء المراد تنفيذه')
            .setRequired(true)
            .addChoices(
              { name: 'إضافة', value: 'add' },
              { name: 'إزالة', value: 'remove' }
            )
        )
    ),

  // أوامر النسخ الاحتياطي
  new SlashCommandBuilder()
    .setName('backup')
    .setDescription('إدارة النسخ الاحتياطي')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('إنشاء نسخة احتياطية شاملة')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('عرض النسخ الاحتياطية المتاحة')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('restore')
        .setDescription('استعادة نسخة احتياطية')
        .addStringOption(option =>
          option
            .setName('backup_id')
            .setDescription('معرف النسخة الاحتياطية')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('delete')
        .setDescription('حذف نسخة احتياطية')
        .addStringOption(option =>
          option
            .setName('backup_id')
            .setDescription('معرف النسخة الاحتياطية')
            .setRequired(true)
        )
    ),

  // أوامر الاستعادة
  new SlashCommandBuilder()
    .setName('restore')
    .setDescription('استعادة العناصر المحذوفة')
    .addSubcommand(subcommand =>
      subcommand
        .setName('deleted_roles')
        .setDescription('عرض الأدوار المحذوفة')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('deleted_channels')
        .setDescription('عرض القنوات المحذوفة')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear_deleted')
        .setDescription('مسح قائمة العناصر المحذوفة')
        .addStringOption(option =>
          option
            .setName('type')
            .setDescription('نوع العناصر المراد مسحها')
            .setRequired(true)
            .addChoices(
              { name: 'الأدوار', value: 'roles' },
              { name: 'القنوات', value: 'channels' },
              { name: 'الكل', value: 'all' }
            )
        )
    )
];

// تسجيل الأوامر
async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(config.client.token);
    
    console.log(chalk.yellow('🔄 جاري تسجيل الأوامر...'));
    
    await rest.put(
      Routes.applicationGuildCommands(config.client.clientId, config.client.guildId),
      { body: commands }
    );
    
    console.log(chalk.green('✅ تم تسجيل الأوامر بنجاح!'));
  } catch (error) {
    console.log(chalk.red('❌ خطأ في تسجيل الأوامر:'), error);
  }
}

// معالج الأوامر
const commandHandlers = {
  protection: {
    status: async (interaction) => {
      const statusEmbed = new EmbedBuilder()
        .setColor(config.colors.primary)
        .setTitle(config.embeds.protectionTitle)
        .setDescription('إليك حالة جميع أنظمة الحماية في السيرفر')
        .addFields(
          { 
            name: '🛡️ حماية من الرايد', 
            value: config.protection.antiRaid.enabled ? '✅ **نشط**' : '❌ **غير نشط**', 
            inline: true 
          },
          { 
            name: '💥 حماية من النوك', 
            value: config.protection.antiNuke.enabled ? '✅ **نشط**' : '❌ **غير نشط**', 
            inline: true 
          },
          { 
            name: '📝 حماية من السبام', 
            value: config.protection.antiSpam.enabled ? '✅ **نشط**' : '❌ **غير نشط**', 
            inline: true 
          },
          { 
            name: '🔗 حماية من الروابط', 
            value: config.protection.antiLink.enabled ? '✅ **نشط**' : '❌ **غير نشط**', 
            inline: true 
          },
          { 
            name: '👥 حماية من المنشن', 
            value: config.protection.antiMention.enabled ? '✅ **نشط**' : '❌ **غير نشط**', 
            inline: true 
          },
          { 
            name: '🤖 حماية من البوتات', 
            value: config.protection.antiBot.enabled ? '✅ **نشط**' : '❌ **غير نشط**', 
            inline: true 
          }
        )
        .setFooter({ 
          text: config.embeds.footerText.replace('{timestamp}', new Date().toLocaleString('ar-SA')) 
        })
        .setTimestamp();
      
      await interaction.reply({ embeds: [statusEmbed] });
    },
    
    warnings: async (interaction) => {
      const user = interaction.options.getUser('user');
      const warnings = warningSystem.getWarnings(user.id);
      
      if (warnings.length === 0) {
        await interaction.reply({
          content: `❌ **${user.username}** ليس لديه أي تحذيرات`,
          ephemeral: true
        });
        return;
      }
      
      const warningsList = warnings.map((warn, index) => 
        `**${index + 1}.** ${warn.reason} - بواسطة ${warn.moderator} - <t:${Math.floor(warn.timestamp / 1000)}:R>`
      ).join('\n');
      
      const embed = new EmbedBuilder()
        .setColor(config.colors.warning)
        .setTitle(config.embeds.warningTitle)
        .setDescription(`**تحذيرات ${user.username}**\n${warningsList}`)
        .addFields(
          { name: 'إجمالي التحذيرات', value: warnings.length.toString(), inline: true },
          { name: 'الحد الأقصى', value: config.warnings.maxWarnings.toString(), inline: true }
        )
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
    },
    
    clear_warnings: async (interaction) => {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ 
          content: '❌ تحتاج إلى صلاحية الأدمن لاستخدام هذا الأمر', 
          ephemeral: true 
        });
        return;
      }
      
      const user = interaction.options.getUser('user');
      const success = warningSystem.clearWarnings(user.id);
      
      if (success) {
        await interaction.reply(`✅ تم مسح جميع تحذيرات **${user.username}**`);
      } else {
        await interaction.reply(`❌ **${user.username}** ليس لديه أي تحذيرات لمسحها`);
      }
    },
    
    whitelist: async (interaction) => {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ 
          content: '❌ تحتاج إلى صلاحية الأدمن لاستخدام هذا الأمر', 
          ephemeral: true 
        });
        return;
      }
      
      const user = interaction.options.getUser('user');
      const action = interaction.options.getString('action');
      
      let currentWhitelist = config.settings.whitelist || [];
      
      if (action === 'add') {
        if (currentWhitelist.includes(user.id)) {
          await interaction.reply(`❌ **${user.username}** موجود بالفعل في القائمة البيضاء`);
          return;
        }
        currentWhitelist.push(user.id);
        await interaction.reply(`✅ تم إضافة **${user.username}** إلى القائمة البيضاء`);
      } else if (action === 'remove') {
        if (!currentWhitelist.includes(user.id)) {
          await interaction.reply(`❌ **${user.username}** غير موجود في القائمة البيضاء`);
          return;
        }
        currentWhitelist = currentWhitelist.filter(id => id !== user.id);
        await interaction.reply(`✅ تم إزالة **${user.username}** من القائمة البيضاء`);
      }
      
      // حفظ التغييرات في config
      config.settings.whitelist = currentWhitelist;
      try {
        fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
        console.log(chalk.green('✅ تم تحديث الإعدادات في config.json'));
      } catch (error) {
        console.log(chalk.red('❌ خطأ في حفظ الإعدادات:'), error);
        await interaction.followUp('⚠️ تعذر حفظ التغييرات في الإعدادات');
      }
    }
  },
  
  backup: {
    create: async (interaction) => {
      await interaction.deferReply();
      
      try {
        const backup = await backupSystem.createBackup(interaction.guild);
        
        const embed = new EmbedBuilder()
          .setColor(config.colors.success)
          .setTitle(config.embeds.backupTitle)
          .setDescription('تم إنشاء نسخة احتياطية شاملة للسيرفر')
          .addFields(
            { name: 'معرف النسخة', value: backup.id, inline: true },
            { name: 'تاريخ الإنشاء', value: `<t:${Math.floor(backup.timestamp / 1000)}:F>`, inline: true },
            { name: 'عدد الأدوار', value: backup.guild.roles.length.toString(), inline: true },
            { name: 'عدد القنوات', value: backup.guild.channels.length.toString(), inline: true },
            { name: 'عدد الإيموجي', value: backup.guild.emojis.length.toString(), inline: true },
            { name: 'عدد الاستيكر', value: backup.guild.stickers.length.toString(), inline: true }
          )
          .setFooter({ text: 'نظام النسخ الاحتياطي' })
          .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error(error);
        await interaction.editReply('❌ حدث خطأ أثناء إنشاء النسخة الاحتياطية');
      }
    },
    
    list: async (interaction) => {
      const backups = backupSystem.listBackups();
      
      if (backups.length === 0) {
        await interaction.reply({
          content: '❌ لا توجد نسخ احتياطية متاحة',
          ephemeral: true
        });
        return;
      }
      
      const backupsList = backups.slice(0, 10).map(backup => 
        `**${backup.id}** - <t:${Math.floor(backup.timestamp / 1000)}:R> - ${backup.guild.roles.length} أدوار`
      ).join('\n');
      
      const embed = new EmbedBuilder()
        .setColor(config.colors.info)
        .setTitle('💾 النسخ الاحتياطية المتاحة')
        .setDescription(backupsList)
        .setFooter({ text: `إجمالي النسخ: ${backups.length} | الحد الأقصى: ${config.backup.maxBackups}` })
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
    },
    
    restore: async (interaction) => {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ 
          content: '❌ تحتاج إلى صلاحية الأدمن لاستخدام هذا الأمر', 
          ephemeral: true 
        });
        return;
      }
      
      const backupId = interaction.options.getString('backup_id');
      
      await interaction.deferReply();
      
      try {
        const results = await backupSystem.restoreBackup(interaction.guild, backupId);
        
        const embed = new EmbedBuilder()
          .setColor(config.colors.success)
          .setTitle('✅ تم الاستعادة بنجاح')
          .setDescription(`تم استعادة النسخة الاحتياطية **${backupId}**`)
          .addFields(
            { name: 'الأدوار المستعادة', value: `${results.roles.success} ✅`, inline: true },
            { name: 'الأدوار الفاشلة', value: `${results.roles.failed} ❌`, inline: true },
            { name: 'القنوات المستعادة', value: `${results.channels.success} ✅`, inline: true },
            { name: 'القنوات الفاشلة', value: `${results.channels.failed} ❌`, inline: true }
          )
          .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        await interaction.editReply(`❌ فشل في استعادة النسخة الاحتياطية: ${error.message}`);
      }
    },
    
    delete: async (interaction) => {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ 
          content: '❌ تحتاج إلى صلاحية الأدمن لاستخدام هذا الأمر', 
          ephemeral: true 
        });
        return;
      }
      
      const backupId = interaction.options.getString('backup_id');
      const success = backupSystem.deleteBackup(backupId);
      
      if (success) {
        await interaction.reply(`✅ تم حذف النسخة الاحتياطية **${backupId}**`);
      } else {
        await interaction.reply(`❌ لم يتم العثور على النسخة الاحتياطية **${backupId}**`);
      }
    }
  },
  
  restore: {
    deleted_roles: async (interaction) => {
      const deletedRoles = restoreSystem.getDeletedRoles();
      
      if (deletedRoles.length === 0) {
        await interaction.reply({
          content: '✅ لا توجد أدوار محذوفة مؤخراً',
          ephemeral: true
        });
        return;
      }
      
      const rolesList = deletedRoles.slice(0, 15).map(role => 
        `**${role.name}** - <t:${Math.floor(role.deletedAt / 1000)}:R>`
      ).join('\n');
      
      const embed = new EmbedBuilder()
        .setColor(config.colors.warning)
        .setTitle(config.embeds.restoreTitle)
        .setDescription('**الأدوار المحذوفة حديثاً:**\n' + rolesList)
        .setFooter({ text: `إجمالي الأدوار المحذوفة: ${deletedRoles.length}` })
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
    },
    
    deleted_channels: async (interaction) => {
      const deletedChannels = restoreSystem.getDeletedChannels();
      
      if (deletedChannels.length === 0) {
        await interaction.reply({
          content: '✅ لا توجد قنوات محذوفة مؤخراً',
          ephemeral: true
        });
        return;
      }
      
      const channelsList = deletedChannels.slice(0, 15).map(channel => 
        `**${channel.name}** (${channel.type}) - <t:${Math.floor(channel.deletedAt / 1000)}:R>`
      ).join('\n');
      
      const embed = new EmbedBuilder()
        .setColor(config.colors.warning)
        .setTitle(config.embeds.restoreTitle)
        .setDescription('**القنوات المحذوفة حديثاً:**\n' + channelsList)
        .setFooter({ text: `إجمالي القنوات المحذوفة: ${deletedChannels.length}` })
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
    },
    
    clear_deleted: async (interaction) => {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ 
          content: '❌ تحتاج إلى صلاحية الأدمن لاستخدام هذا الأمر', 
          ephemeral: true 
        });
        return;
      }
      
      const type = interaction.options.getString('type');
      
      if (type === 'roles' || type === 'all') {
        restoreSystem.clearDeletedRoles();
      }
      
      if (type === 'channels' || type === 'all') {
        restoreSystem.clearDeletedChannels();
      }
      
      await interaction.reply(`✅ تم مسح قائمة العناصر المحذوفة (${type})`);
    }
  }
};

// الأحداث
client.once(Events.ClientReady, async () => {
  console.log(chalk.green(`✅ ${client.user.tag} يعمل الآن!`));
  console.log(chalk.blue(`📊 يراقب ${client.guilds.cache.size} سيرفر`));
  
  // إنشاء مجلد البيانات إذا لم يكن موجوداً
  if (!fs.existsSync('./data')) {
    fs.mkdirSync('./data');
  }
  
  // تحميل البيانات المحفوظة
  warningSystem.loadWarnings();
  backupSystem.loadBackups();
  
  // تعيين حالة البات
  client.user.setActivity({
    name: '🔒 يحمي السيرفر | /protection',
    type: ActivityType.Watching
  });
  
  // تسجيل الأوامر
  await registerCommands();
  
  // النسخ الاحتياطي التلقائي
  if (config.backup.autoBackup) {
    setInterval(() => {
      client.guilds.cache.forEach(guild => {
        backupSystem.createBackup(guild);
      });
    }, config.backup.backupInterval * 60 * 1000);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options } = interaction;
  
  try {
    if (commandName === 'protection') {
      const subcommand = options.getSubcommand();
      await commandHandlers.protection[subcommand](interaction);
    }
    else if (commandName === 'backup') {
      const subcommand = options.getSubcommand();
      await commandHandlers.backup[subcommand](interaction);
    }
    else if (commandName === 'restore') {
      const subcommand = options.getSubcommand();
      await commandHandlers.restore[subcommand](interaction);
    }
  } catch (error) {
    console.error(chalk.red(`❌ خطأ في تنفيذ الأمر ${commandName}:`), error);
    
    const errorMessage = {
      content: '❌ حدث خطأ غير متوقع أثناء تنفيذ الأمر!', 
      ephemeral: true 
    };
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMessage);
    } else {
      await interaction.reply(errorMessage);
    }
  }
});

// نظام الحماية - حدث دخول الأعضاء
client.on(Events.GuildMemberAdd, async (member) => {
  if (!config.protection.antiRaid.enabled || protectionSystem.isWhitelisted(member.id)) return;
  
  const isRaid = protectionSystem.checkRaid(member.guild, member);
  
  if (isRaid) {
    try {
      await protectionSystem.takeAction(config.protection.antiRaid.action, member, 'اكتشاف هجوم رايد');
      protectionSystem.logAction('ANTI-RAID', `تم ${config.protection.antiRaid.action} ${member.user.tag} بسبب اكتشاف هجوم رايد`);
    } catch (error) {
      console.log(chalk.yellow(`⚠️ تعذر ${config.protection.antiRaid.action} ${member.user.tag}: ${error.message}`));
    }
  }
});

// نظام الحماية - حدث الرسائل
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (protectionSystem.isWhitelisted(message.author.id)) return;

  let shouldDelete = false;
  let reason = '';

  // فحص السبام
  if (config.protection.antiSpam.enabled && protectionSystem.checkSpam(message)) {
    shouldDelete = true;
    reason = 'إرسال رسائل متكررة';
    warningSystem.addWarning(message.author.id, 'سبام');
  }

  // فحص المنشن
  if (config.protection.antiMention.enabled && protectionSystem.checkMention(message)) {
    shouldDelete = true;
    reason = 'إساءة استخدام المنشن';
    warningSystem.addWarning(message.author.id, 'منشن مفرط');
  }

  // فحص الروابط
  if (config.protection.antiLink.enabled && protectionSystem.checkLinks(message)) {
    shouldDelete = true;
    reason = 'إرسال روابط غير مسموحة';
    warningSystem.addWarning(message.author.id, 'روابط غير مرغوبة');
  }

  if (shouldDelete) {
    try {
      await protectionSystem.takeAction(config.protection.antiSpam.action, message, reason);
      protectionSystem.logAction('ANTI-SPAM', `حذف رسالة من ${message.author.tag}: ${reason}`);
      
      // إرسال تحذير للعضو
      try {
        await message.author.send(`⚠️ **تحذير أمان:** تم حذف رسالتك في ${message.guild.name} بسبب: ${reason}`);
      } catch (dmError) {
        // لا يمكن إرسال رسالة خاصة
      }
    } catch (error) {
      console.log(chalk.yellow(`⚠️ تعذر حذف الرسالة: ${error.message}`));
    }
  }
});

// نظام الحماية - حدث إضافة البوتات
client.on(Events.GuildMemberAdd, async (member) => {
  if (!config.protection.antiBot.enabled || protectionSystem.isWhitelisted(member.user.id)) return;
  
  if (member.user.bot) {
    try {
      await protectionSystem.takeAction(config.protection.antiBot.action, member, 'بوت غير مصرح به');
      protectionSystem.logAction('ANTI-BOT', `تم ${config.protection.antiBot.action} البوت ${member.user.tag}`);
    } catch (error) {
      console.log(chalk.yellow(`⚠️ تعذر ${config.protection.antiBot.action} البوت ${member.user.tag}: ${error.message}`));
    }
  }
});

// تتبع العناصر المحذوفة
client.on(Events.GuildRoleDelete, async (role) => {
  restoreSystem.trackDeletedRole(role);
  protectionSystem.logAction('ROLE_DELETED', `تم حذف الدور: ${role.name}`);
});

client.on(Events.ChannelDelete, async (channel) => {
  restoreSystem.trackDeletedChannel(channel);
  protectionSystem.logAction('CHANNEL_DELETED', `تم حذف القناة: ${channel.name}`);
});

// الحماية من النوك (حذف الأدوار)
client.on(Events.GuildRoleDelete, async (role) => {
  if (!config.protection.antiNuke.enabled || !role.guild || protectionSystem.isWhitelisted(role.guild.ownerId)) return;
  
  const isNuke = protectionSystem.checkNuke(role.guild, 'ROLE_DELETE', role.guild.ownerId);
  
  if (isNuke) {
    protectionSystem.logAction('ANTI-NUKE', `تم اكتشاف محاولة نوك في السيرفر ${role.guild.name}`);
    // يمكن إضافة إجراءات إضافية هنا
  }
});

// الحماية من النوك (حذف القنوات)
client.on(Events.ChannelDelete, async (channel) => {
  if (!config.protection.antiNuke.enabled || !channel.guild || protectionSystem.isWhitelisted(channel.guild.ownerId)) return;
  
  const isNuke = protectionSystem.checkNuke(channel.guild, 'CHANNEL_DELETE', channel.guild.ownerId);
  
  if (isNuke) {
    protectionSystem.logAction('ANTI-NUKE', `تم اكتشاف محاولة نوك في السيرفر ${channel.guild.name}`);
  }
});

// بدء البات
async function startBot() {
  try {
    console.log(chalk.yellow('🚀 بدء تشغيل بات الحماية...'));
    console.log(chalk.blue('📝 تم التحميل من config.json بنجاح'));
    await client.login(config.client.token);
  } catch (error) {
    console.log(chalk.red('❌ فشل في تشغيل البات:'), error);
    process.exit(1);
  }
}

// التعامل مع الأخطاء
process.on('unhandledRejection', (error) => {
  console.log(chalk.red('❌ خطأ غير معالج:'), error);
});

process.on('uncaughtException', (error) => {
  console.log(chalk.red('❌ استثناء غير معالج:'), error);
});

// بدء التشغيل
startBot();