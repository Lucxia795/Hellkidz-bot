// ==== DEBUG BAŞLANGIÇ ====
console.log('=== ENV DEBUG ===');
console.log('Çalışma dizini:', process.cwd());
console.log('__dirname:', __dirname);
// ==== DEBUG BİTİŞ ====

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits,
    PermissionsBitField,
    ChannelType,
    SlashCommandBuilder,
    REST,
    Routes,
    StringSelectMenuBuilder,
    AuditLogEvent
} = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dns = require('dns');
require('dotenv').config();

// ==== ENV YÜKLENDİKTEN SONRA DEBUG ====
console.log('=== ENV YÜKLEME SONRASI ===');
console.log('Token var mı?', !!process.env.DISCORD_TOKEN);
console.log('Token uzunluğu:', process.env.DISCORD_TOKEN?.length || 0);
console.log('GUILD_TAG_ROLE_ID:', process.env.GUILD_TAG_ROLE_ID || '❌ YOK');
console.log('AUTO_VOICE_CHANNEL_ID:', process.env.AUTO_VOICE_CHANNEL_ID || '❌ YOK');
console.log('SETUP_VOICE_CHANNEL_ID:', process.env.SETUP_VOICE_CHANNEL_ID || '❌ YOK');
console.log('WELCOME_CHANNEL_ID:', process.env.WELCOME_CHANNEL_ID || '❌ YOK');
console.log('===========================');

// --- 🛡️ GÜVENLİK VE TOKEN SIZINTI KORUMASI ---
const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error("❌ HATA: .env dosyasında DISCORD_TOKEN bulunamadı!");
    console.error("→ .env dosyasının index.js ile AYNI klasörde olduğundan emin ol.");
    console.error("→ Dosya adı '.env' olmalı ('.env.txt' DEĞİL).");
    process.exit(1);
}

// --- 🛡️ IP VE ORTAM YETKİLENDİRMESİ ---
const ALLOWED_IP = process.env.ALLOWED_SERVER_IP;

if (ALLOWED_IP) {
    dns.lookup(os.hostname(), (err, address) => {
        if (err || (address && address !== ALLOWED_IP)) {
            console.error(`🚨 [GÜVENLİK İHLALİ] Bot yetkisiz bir IP adresinde (${address || 'Bilinmiyor'}) başlatılmaya çalışıldı! İşlem durduruluyor.`);
            process.exit(1);
        } else {
            console.log(`🔒 [IP DOĞRULAMA] IP adresi doğrulandı (${address}). Bot güvenli ortamda çalışıyor.`);
        }
    });
}

const originalLog = console.log;
console.log = function (...args) {
    const sanitizedArgs = args.map(arg => typeof arg === 'string' ? arg.split(TOKEN).join('[GİZLİ_TOKEN]') : arg);
    originalLog.apply(console, sanitizedArgs);
};

process.on('unhandledRejection', (reason) => {
    console.error('⚠️ [HATA KORUMASI] Yakalanmayan Hata:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
    console.error('⚠️ [HATA KORUMASI] Sistem Hatası:', err?.message || err);
});

// Toplu silme yapılan kanallar (log spam'ini engellemek için)
global.bulkDeletingChannels = new Set();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildInvites
    ]
});

const PREFIX = '.';
const STATS_FILE = path.join(__dirname, 'stats.json');
const callCooldowns = new Map();

// 🚫 Komut kanalı spam kontrolü
const commandSpamTracker = new Map();
const mutedUsers = new Map();

function loadStats() {
    if (!fs.existsSync(STATS_FILE)) {
        fs.writeFileSync(STATS_FILE, JSON.stringify({ messages: {}, voice: {}, invites: {}, inviteMap: {}, giveaways: {} }, null, 2));
    }
    const data = JSON.parse(fs.readFileSync(STATS_FILE));
    if (!data.messages) data.messages = {};
    if (!data.voice) data.voice = {};
    if (!data.invites) data.invites = {};
    if (!data.inviteMap) data.inviteMap = {};
    if (!data.giveaways) data.giveaways = {};
    return data;
}

function saveStats(data) {
    fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2));
}

const voiceStates = new Map();

// --- 📨 DAVET TAKİP SİSTEMİ ---
const inviteCache = new Map();

async function cacheGuildInvites(guild) {
    try {
        const invites = await guild.invites.fetch();
        inviteCache.set(
            guild.id,
            new Map(invites.map(inv => [inv.code, { uses: inv.uses ?? 0, inviterId: inv.inviter?.id || null }]))
        );
    } catch (err) {
        console.warn(`⚠️ [DAVET] ${guild.name} davetleri alınamadı (botta "Sunucuyu Yönet" yetkisi olmalı).`);
    }
}

function recordInvite(inviterId, memberId) {
    if (!inviterId || inviterId === memberId) return;
    const stats = loadStats();
    const entry = stats.invites[inviterId] || { total: 0, left: 0 };
    entry.total++;
    stats.invites[inviterId] = entry;
    stats.inviteMap[memberId] = inviterId;
    saveStats(stats);
}

function recordInviteLeave(memberId) {
    const stats = loadStats();
    const inviterId = stats.inviteMap[memberId];
    if (!inviterId) return;
    const entry = stats.invites[inviterId];
    if (entry) entry.left = (entry.left || 0) + 1;
    delete stats.inviteMap[memberId];
    saveStats(stats);
}

async function findUsedInvite(guild) {
    const oldInvites = inviteCache.get(guild.id) || new Map();
    let newInvites;
    try {
        newInvites = await guild.invites.fetch();
    } catch {
        return null;
    }

    let result = null;

    const used = newInvites.find(inv => (inv.uses ?? 0) > (oldInvites.get(inv.code)?.uses ?? 0));
    if (used) {
        result = { inviterId: used.inviter?.id || null };
    } else {
        for (const [code, data] of oldInvites) {
            if (!newInvites.has(code)) {
                result = { inviterId: data.inviterId };
                break;
            }
        }
    }

    inviteCache.set(
        guild.id,
        new Map(newInvites.map(inv => [inv.code, { uses: inv.uses ?? 0, inviterId: inv.inviter?.id || null }]))
    );

    if (!result && guild.vanityURLCode) return { vanity: true };
    return result;
}

client.on('inviteCreate', (invite) => {
    if (!invite.guild) return;
    const cache = inviteCache.get(invite.guild.id) || new Map();
    cache.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviter?.id || null });
    inviteCache.set(invite.guild.id, cache);
});

client.on('inviteDelete', (invite) => {
    if (!invite.guild) return;
    setTimeout(() => inviteCache.get(invite.guild.id)?.delete(invite.code), 5000);
});

client.on('guildCreate', (guild) => { cacheGuildInvites(guild); });

// Özel odalar
const privateChannels = new Map();

function savePrivateRooms() {
    const s = loadStats();
    s.privateRooms = Object.fromEntries(privateChannels);
    saveStats(s);
}

// Özel Oda Kurulum Kanal ID'sini Alır (.env öncelikli)
function getSetupChannelId() {
    return process.env.SETUP_VOICE_CHANNEL_ID || client.setupVoiceChannelId || loadStats().setupVoiceChannelId;
}

function parseUserId(input) {
    return String(input || '').replace(/[<@!>]/g, '').trim();
}

// --- LOG GÖNDERME ---
async function sendLog(guild, channelEnvName, embed) {
    const channelId = process.env[channelEnvName];
    if (!channelId) return;
    const channel = guild.channels.cache.get(channelId);
    if (channel) {
        await channel.send({ embeds: [embed] }).catch(() => {});
    }
}

const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('Bot 7/24 Aktif!');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sunucu ${PORT} portunda aktif.`);
});

// --- 🏷️ SUNUCU ETİKETİ ROL SİSTEMİ ---
const tagProcessing = new Set();

async function checkGuildTag(member) {
    const roleId = process.env.GUILD_TAG_ROLE_ID;
    if (!roleId || !member || member.user.bot) return;

    const pg = member.user.primaryGuild;
    const hasTag = pg && pg.identityGuildId === member.guild.id && pg.identityEnabled !== false;

    if (hasTag) {
        if (member.roles.cache.has(roleId)) return;
        if (tagProcessing.has(member.id)) return;

        tagProcessing.add(member.id);
        try {
            const role = member.guild.roles.cache.get(roleId);
            if (!role) {
                console.warn('⚠️ [SUNUCU ETİKETİ] GUILD_TAG_ROLE_ID ile eşleşen rol bulunamadı.');
                return;
            }

            await member.roles.add(role, 'Sunucu etiketi takıldı');

            const tagEmbed = new EmbedBuilder()
                .setTitle('🏷️ Sunucu Etiketi Takıldı')
                .setColor('#2ecc71')
                .setThumbnail(member.user.displayAvatarURL())
                .setDescription(`${member} (\`${member.id}\`) sunucu etiketini taktığı için **${role.name}** rolü verildi.`)
                .addFields(
                    { name: 'Kullanıcı', value: `${member.user.tag}`, inline: true },
                    { name: 'Etiket', value: `\`${pg.tag || 'Bilinmiyor'}\``, inline: true },
                    { name: 'Verilen Rol', value: `${role}`, inline: true }
                )
                .setTimestamp();

            await sendLog(member.guild, 'LOG_GUILD', tagEmbed);
            console.log(`[SUNUCU ETİKETİ] ${member.user.tag} etiketi taktı, "${role.name}" rolü verildi.`);
        } catch (err) {
            console.error('Sunucu etiketi rolü verilemedi (botun rolü, verilecek rolün üstünde mi?):', err?.message || err);
        } finally {
            tagProcessing.delete(member.id);
        }
    } else {
        if (!member.roles.cache.has(roleId)) return;
        if (tagProcessing.has(member.id)) return;

        tagProcessing.add(member.id);
        try {
            const role = member.guild.roles.cache.get(roleId);
            if (!role) return;

            await member.roles.remove(role, 'Sunucu etiketi kaldırıldı');

            const untagEmbed = new EmbedBuilder()
                .setTitle('🏷️ Sunucu Etiketi Kaldırıldı')
                .setColor('#e74c3c')
                .setThumbnail(member.user.displayAvatarURL())
                .setDescription(`${member} (\`${member.id}\`) sunucu etiketini kaldırdığı için **${role.name}** rolü alındı.`)
                .setTimestamp();

            await sendLog(member.guild, 'LOG_GUILD', untagEmbed);
            console.log(`[SUNUCU ETİKETİ] ${member.user.tag} etiketi kaldırdı, "${role.name}" rolü alındı.`);
        } catch (err) {
            console.error('Sunucu etiketi rolü alınamadı:', err?.message || err);
        } finally {
            tagProcessing.delete(member.id);
        }
    }
}

async function scanGuildTags() {
    for (const guild of client.guilds.cache.values()) {
        try {
            const members = await guild.members.fetch();
            for (const member of members.values()) {
                await checkGuildTag(member);
            }
        } catch (err) {
            console.error('Sunucu etiketi taraması hatası:', err?.message || err);
        }
    }
}

client.on('userUpdate', (oldUser, newUser) => {
    for (const guild of client.guilds.cache.values()) {
        const m = guild.members.cache.get(newUser.id);
        if (m) checkGuildTag(m);
    }
});

client.on('presenceUpdate', (oldPresence, newPresence) => {
    if (newPresence?.member) checkGuildTag(newPresence.member);
});

// --- SLASH KOMUTLARI ---
const commands = [
    new SlashCommandBuilder()
        .setName('cekilis')
        .setDescription('Yeni bir çekiliş başlatır.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false)
        .addStringOption(option =>
            option.setName('odul')
                .setDescription('Çekiliş ödülü nedir?')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('kazanan_sayisi')
                .setDescription('Kaç kazanan seçilsin?')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('sure')
                .setDescription('Süre (Örn: 30m, 1h, 10h)')
                .setRequired(true)
        )
].map(command => command.toJSON());

function isValidHttpUrl(str) {
    try {
        const u = new URL(str);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

// --- BOT HAZIR ---
client.once('ready', async () => {
    console.log(`[BAŞARILI] Bot ${client.user.tag} olarak aktifleşti!`);
    console.log(`[BİLGİ] ${client.guilds.cache.size} sunucuda çalışıyorum.`);

    for (const guild of client.guilds.cache.values()) {
        await cacheGuildInvites(guild);
    }

    if (process.env.GUILD_TAG_ROLE_ID) {
        if (client.user.primaryGuild === undefined) {
            console.warn('⚠️ [SUNUCU ETİKETİ] discord.js sürümün sunucu etiketini desteklemiyor olabilir. "npm install discord.js@latest" ile güncelle.');
        }
        scanGuildTags();
        const tagMinutes = Math.max(parseInt(process.env.GUILD_TAG_CHECK_MINUTES) || 5, 1);
        setInterval(scanGuildTags, tagMinutes * 60 * 1000);
    } else {
        console.warn('⚠️ [SUNUCU ETİKETİ] .env dosyasında GUILD_TAG_ROLE_ID yok, sistem kapalı.');
    }

    try {
        const saved = loadStats();
        if (saved.setupVoiceChannelId) {
            client.setupVoiceChannelId = saved.setupVoiceChannelId;
        }
        if (saved.privateRooms) {
            for (const [channelId, ownerId] of Object.entries(saved.privateRooms)) {
                const ch = client.channels.cache.get(channelId);
                if (ch) {
                    privateChannels.set(channelId, ownerId);
                    if (ch.members && ch.members.size === 0) {
                        privateChannels.delete(channelId);
                        await ch.delete().catch(() => {});
                    }
                }
            }
            savePrivateRooms();
        }
    } catch (err) {
        console.error('Özel odalar geri yüklenirken hata:', err);
    }

    const autoVoiceChannelId = process.env.AUTO_VOICE_CHANNEL_ID;
    if (autoVoiceChannelId) {
        const voiceChannel = client.channels.cache.get(autoVoiceChannelId);
        if (voiceChannel && voiceChannel.isVoiceBased()) {
            try {
                joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: voiceChannel.guild.id,
                    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                    selfDeaf: true,
                    selfMute: false
                });
                console.log(`🔊 Bot başarıyla "${voiceChannel.name}" ses kanalına bağlandı.`);
            } catch (error) {
                console.error('Ses kanalına katılırken bir hata oluştu:', error);
            }
        } else {
            console.warn('⚠️ AUTO_VOICE_CHANNEL_ID geçerli bir ses kanalı olarak bulunamadı.');
        }
    }

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        console.log('Slash (/) komutları Discord\'a yükleniyor...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('✅ Slash komutları başarıyla yüklendi!');
    } catch (error) {
        console.error('Slash komutları yüklenirken hata oluştu:', error);
    }
});

// --- YETKİ KONTROL ---
function checkAuth(member) {
    const staffRoleId = process.env.TICKET_STAFF_ROLE_ID || process.env.STAFF_ROLE_ID;
    return (staffRoleId && member.roles.cache.has(staffRoleId))
        || member.permissions.has(PermissionFlagsBits.Administrator)
        || member.permissions.has(PermissionFlagsBits.ManageChannels);
}

function isOwner(member) {
    const ownerRoleId = process.env.OWNER_ROLE_ID;
    const ownerUserId = process.env.OWNER_ID;

    const hasOwnerRole = ownerRoleId && member.roles.cache.has(ownerRoleId);
    const isOwnerUser = ownerUserId && member.id === ownerUserId;

    return hasOwnerRole || isOwnerUser;
}

function hasRole(member, roleId) {
    return roleId && member.roles.cache.has(roleId);
}

// --- 🛡️ TOKEN SIZINTI + MESAJ SAYACI ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.includes(TOKEN)) {
        await message.delete().catch(() => {});
        const warnMsg = await message.channel.send(`⚠️ **GÜVENLİK UYARISI:** ${message.author}, mesajınızda bot token'ı tespit edildiği için silindi!`);
        setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
        return;
    }

    if (message.guild) {
        try {
            const stats = loadStats();
            stats.messages[message.author.id] = (stats.messages[message.author.id] || 0) + 1;
            saveStats(stats);
        } catch (e) {}
    }
});

// --- 📜 LOGLAR ---

client.on('messageDelete', async (message) => {
    if (!message.guild || message.author?.bot) return;

    if (global.bulkDeletingChannels && global.bulkDeletingChannels.has(message.channel.id)) return;

    const embed = new EmbedBuilder()
        .setTitle('🗑️ Mesaj Silindi')
        .setColor('#e74c3c')
        .addFields(
            { name: 'Kullanıcı', value: message.author ? `${message.author} (\`${message.author.id}\`)` : 'Bilinmiyor', inline: true },
            { name: 'Kanal', value: `${message.channel}`, inline: true },
            { name: 'Silinen Mesaj', value: message.content || '*[İçerik okunamadı veya görsel/embed]*' }
        )
        .setTimestamp();

    await sendLog(message.guild, 'LOG_MESSAGE_DELETE', embed);
});

client.on('guildMemberAdd', async (member) => {
    if (process.env.AUTO_ROLE_ID) {
        try { await member.roles.add(process.env.AUTO_ROLE_ID); } catch (e) {}
    }

    checkGuildTag(member);

    const usedInvite = await findUsedInvite(member.guild);
    if (usedInvite?.inviterId) {
        try { recordInvite(usedInvite.inviterId, member.id); } catch (e) { console.error('Davet kayıt hatası:', e); }
    }

    console.log(`[KARŞILAMA] guildMemberAdd tetiklendi: ${member.user.tag}`);

    const welcomeChannelId = process.env.WELCOME_CHANNEL_ID;
    const welcomeImage = process.env.WELCOME_IMAGE_URL;

    if (!welcomeChannelId) {
        console.warn('⚠️ [KARŞILAMA] WELCOME_CHANNEL_ID .env dosyasında tanımlı değil.');
    } else if (!welcomeImage) {
        console.warn('⚠️ [KARŞILAMA] .env dosyasında WELCOME_IMAGE_URL yok, mesaj gönderilmedi.');
    } else if (!isValidHttpUrl(welcomeImage)) {
        console.warn('⚠️ WELCOME_IMAGE_URL geçerli bir link değil (https:// ile başlamalı).');
    } else {
        try {
            const welcomeChannel = member.guild.channels.cache.get(welcomeChannelId)
                || await member.guild.channels.fetch(welcomeChannelId).catch(() => null);

            if (welcomeChannel && welcomeChannel.isTextBased()) {
                let inviterName = 'Unknown';
                let inviterIcon = null;

                if (usedInvite?.vanity) {
                    inviterName = 'Vanity URL';
                } else if (usedInvite?.inviterId) {
                    const inviterUser = await client.users.fetch(usedInvite.inviterId).catch(() => null);
                    if (inviterUser) {
                        inviterName = inviterUser.username;
                        inviterIcon = inviterUser.displayAvatarURL({ size: 64 });
                    }
                }

                const chatId = process.env.WELCOME_CHAT_CHANNEL_ID;
                const rulesId = process.env.WELCOME_RULES_CHANNEL_ID;
                let description = null;
                if (chatId && rulesId) {
                    description = `chat here <#${chatId}> & and read rules in <#${rulesId}>`;
                }

                const welcomeColor = /^#?[0-9a-fA-F]{6}$/.test(process.env.WELCOME_COLOR || '')
                    ? (process.env.WELCOME_COLOR.startsWith('#') ? process.env.WELCOME_COLOR : `#${process.env.WELCOME_COLOR}`)
                    : '#ff0000';

                const welcomeEmbed = new EmbedBuilder()
                    .setColor(welcomeColor)
                    .setAuthor({
                        name: member.user.username,
                        iconURL: member.user.displayAvatarURL({ size: 128 })
                    })
                    .setTitle(`Welcome to ${member.guild.name}`)
                    .setImage(welcomeImage)
                    .setFooter(
                        inviterIcon
                            ? { text: `Invited by ${inviterName}`, iconURL: inviterIcon }
                            : { text: `Invited by ${inviterName}` }
                    );

                if (description) welcomeEmbed.setDescription(description);

                await welcomeChannel.send({
                    content: `${member}!`,
                    embeds: [welcomeEmbed],
                    allowedMentions: { users: [member.id] }
                });
                console.log(`[KARŞILAMA] Mesaj #${welcomeChannel.name} kanalına gönderildi. (Invited by: ${inviterName})`);
            } else {
                console.warn('⚠️ WELCOME_CHANNEL_ID ile bir metin kanalı bulunamadı.');
            }
        } catch (err) {
            console.error('Karşılama mesajı gönderilemedi:', err);
        }
    }

    const joinEmbed = new EmbedBuilder()
        .setTitle('📥 Sunucuya Katıldı')
        .setColor('#2ecc71')
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
            { name: 'Kullanıcı', value: `${member.user.tag} (${member})`, inline: true },
            { name: 'ID', value: `\`${member.id}\``, inline: true },
            { name: 'Hesap Oluşturulma', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: false }
        )
        .setTimestamp();

    await sendLog(member.guild, 'LOG_JOIN', joinEmbed);
});

client.on('guildMemberRemove', async (member) => {
    try { recordInviteLeave(member.id); } catch (e) { console.error('Davet ayrılma kayıt hatası:', e); }

    setTimeout(async () => {
        try {
            const fetchedLogs = await member.guild.fetchAuditLogs({
                limit: 1,
                type: AuditLogEvent.MemberKick,
            });
            const kickLog = fetchedLogs.entries.first();

            if (kickLog && kickLog.target.id === member.id && (Date.now() - kickLog.createdTimestamp) < 5000) {
                const executor = kickLog.executor;

                const kickEmbed = new EmbedBuilder()
                    .setTitle('👞 Üye Sunucudan Atıldı (Kick)')
                    .setColor('#e67e22')
                    .addFields(
                        { name: 'Atılan Üye', value: `${member.user.tag} (\`${member.id}\`)`, inline: true },
                        { name: 'Atan Yetkili', value: `${executor} (\`${executor.id}\`)`, inline: true },
                        { name: 'Sebep', value: kickLog.reason || 'Sebep belirtilmedi.' }
                    )
                    .setTimestamp();

                await sendLog(member.guild, 'LOG_KICK', kickEmbed);
                return;
            }
        } catch (e) {}

        const leaveEmbed = new EmbedBuilder()
            .setTitle('📤 Sunucudan Ayrıldı')
            .setColor('#95a5a6')
            .setThumbnail(member.user.displayAvatarURL())
            .addFields(
                { name: 'Kullanıcı', value: `${member.user.tag}`, inline: true },
                { name: 'ID', value: `\`${member.id}\``, inline: true }
            )
            .setTimestamp();

        await sendLog(member.guild, 'LOG_LEAVE', leaveEmbed);
    }, 1000);
});

client.on('guildBanAdd', async (ban) => {
    setTimeout(async () => {
        try {
            const fetchedLogs = await ban.guild.fetchAuditLogs({
                limit: 1,
                type: AuditLogEvent.MemberBanAdd,
            });
            const banLog = fetchedLogs.entries.first();

            const banEmbed = new EmbedBuilder()
                .setTitle('🚫 Üye Yasaklandı (Ban)')
                .setColor('#9b59b6')
                .addFields(
                    { name: 'Yasaklanan Üye', value: `${ban.user.tag} (\`${ban.user.id}\`)`, inline: true },
                    { name: 'Yasaklayan Yetkili', value: banLog ? `${banLog.executor} (\`${banLog.executor.id}\`)` : 'Bilinmiyor', inline: true },
                    { name: 'Sebep', value: ban.reason || banLog?.reason || 'Sebep belirtilmedi.' }
                )
                .setTimestamp();

            await sendLog(ban.guild, 'LOG_BAN', banEmbed);
        } catch (e) {}
    }, 1000);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
    const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));

    if (addedRoles.size > 0 || removedRoles.size > 0) {
        let executor = 'Bilinmiyor';
        try {
            const fetchedLogs = await newMember.guild.fetchAuditLogs({
                limit: 1,
                type: AuditLogEvent.MemberRoleUpdate,
            });
            const roleLog = fetchedLogs.entries.first();
            if (roleLog && roleLog.target.id === newMember.id && (Date.now() - roleLog.createdTimestamp) < 5000) {
                executor = `${roleLog.executor} (\`${roleLog.executor.id}\`)`;
            }
        } catch (e) {}

        const embed = new EmbedBuilder()
            .setTitle('🛡️ Rol Güncellendi')
            .setColor('#3498db')
            .addFields(
                { name: 'Kullanıcı', value: `${newMember.user.tag} (${newMember})`, inline: true },
                { name: 'İşlemi Yapan', value: executor, inline: true }
            )
            .setTimestamp();

        if (addedRoles.size > 0) {
            embed.addFields({ name: '➕ Verilen Rol(ler)', value: addedRoles.map(r => `${r}`).join(', ') });
        }
        if (removedRoles.size > 0) {
            embed.addFields({ name: '➖ Alınan Rol(ler)', value: removedRoles.map(r => `${r}`).join(', ') });
        }

        await sendLog(newMember.guild, 'LOG_ROLE_UPDATE', embed);
    }

    await checkGuildTag(newMember);
});

// --- 🔊 SES İSTATİSTİK VE ÖZEL ODA ---
client.on('voiceStateUpdate', async (oldState, newState) => {
    const userId = newState.id || oldState.id;
    if (!userId || newState.member?.user?.bot) return;

    const now = Date.now();

    try {
        if (!oldState.channelId && newState.channelId) {
            voiceStates.set(userId, now);
        }
        else if (oldState.channelId && !newState.channelId) {
            const joinTime = voiceStates.get(userId);
            if (joinTime) {
                const timeSpent = Math.floor((now - joinTime) / 1000);
                if (timeSpent > 0) {
                    const stats = loadStats();
                    stats.voice[userId] = (stats.voice[userId] || 0) + timeSpent;
                    saveStats(stats);
                }
                voiceStates.delete(userId);
            }
        }
        else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
            const joinTime = voiceStates.get(userId);
            if (joinTime) {
                const timeSpent = Math.floor((now - joinTime) / 1000);
                if (timeSpent > 0) {
                    const stats = loadStats();
                    stats.voice[userId] = (stats.voice[userId] || 0) + timeSpent;
                    saveStats(stats);
                }
            }
            voiceStates.set(userId, now);
        }
    } catch (err) {
        console.error('Ses istatistik hatası:', err);
    }

    const setupId = getSetupChannelId();

    // Kullanıcı belirlenen özel oda ses kanalına katıldığında otomatik oda aç
    if (setupId && newState.channelId === setupId && oldState.channelId !== setupId) {
        const member = newState.member;
        const guild = newState.guild;

        try {
            const createdChannel = await guild.channels.create({
                name: `🔊 ${member.user.username}'in Odası`,
                type: ChannelType.GuildVoice,
                parent: newState.channel?.parentId ?? null,
                permissionOverwrites: [
                    {
                        id: member.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.Connect,
                            PermissionFlagsBits.ManageChannels,
                            PermissionFlagsBits.MoveMembers
                        ]
                    }
                ]
            });

            privateChannels.set(createdChannel.id, member.id);
            savePrivateRooms();

            await member.voice.setChannel(createdChannel);
        } catch (err) {
            console.error('Özel oda oluşturma hatası:', err);
        }
    }

    // Özel oda boşaldığında sil
    if (oldState.channelId && privateChannels.has(oldState.channelId)) {
        const channel = oldState.guild.channels.cache.get(oldState.channelId);
        if (channel && channel.members.size === 0) {
            privateChannels.delete(channel.id);
            savePrivateRooms();
            await channel.delete().catch(() => {});
        }
    }
});

// --- INTERACTION ---
client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'cekilis') {
            if (!checkAuth(interaction.member)) {
                return interaction.reply({ content: '⚠️ **Bu yetkili komutunu kullanmak için izniniz bulunmamaktadır.**', ephemeral: true });
            }

            const reward = interaction.options.getString('odul');
            const winnerCount = interaction.options.getInteger('kazanan_sayisi');
            const durationStr = interaction.options.getString('sure');

            const timeMultiplier = { 'm': 60 * 1000, 'h': 60 * 60 * 1000, 'd': 24 * 60 * 60 * 1000 };
            const unit = durationStr.slice(-1).toLowerCase();
            const timeValue = parseInt(durationStr.slice(0, -1));

            if (isNaN(timeValue) || !timeMultiplier[unit]) {
                return interaction.reply({ content: '⚠️ Geçersiz süre biçimi! Örnek kullanım: `30m`, `1h`, `10h`', ephemeral: true });
            }

            const durationMs = timeValue * timeMultiplier[unit];
            const endTime = Math.floor((Date.now() + durationMs) / 1000);

            const buildEmbed = (participantCount, isEnded = false, cancelled = false, winnersList = null) => {
                const embed = new EmbedBuilder()
                    .setColor(cancelled ? '#e74c3c' : (isEnded ? '#2ecc71' : '#f1c40f'))
                    .setAuthor({
                        name: `${interaction.guild.name} • Çekiliş Sistemi`,
                        iconURL: interaction.guild.iconURL({ size: 128 }) || interaction.user.displayAvatarURL()
                    })
                    .setTimestamp();

                if (cancelled) {
                    embed.setTitle(`🛑 ÇEKİLİŞ İPTAL EDİLDİ`);
                    embed.setDescription(
                        `> Bu çekiliş **${interaction.user.username}** tarafından iptal edildi.\n` +
                        `> **Ödül:** \`${reward}\`\n` +
                        `> **Katılımcı:** \`${participantCount}\``
                    );
                } else if (isEnded) {
                    embed.setTitle(`🏁 ÇEKİLİŞ SONA ERDİ`);
                    embed.setDescription(
                        `> **Ödül:** \`${reward}\`\n` +
                        `> **Kazanan(lar):** ${winnersList ? winnersList.join(', ') : 'Kazanan yok'}\n` +
                        `> **Katılımcı:** \`${participantCount}\``
                    );
                } else {
                    embed.setTitle(`🎉 ÇEKİLİŞ BAŞLADI`);
                    embed.setDescription(
                        `> **Ödül:** \`${reward}\`\n` +
                        `> **Kazanan Sayısı:** \`${winnerCount}\` kişi\n` +
                        `> **Bitiş Zamanı:** <t:${endTime}:R> (<t:${endTime}:f>)\n` +
                        `> **Katılımcı Sayısı:** \`${participantCount}\``
                    );
                }
                return embed;
            };

            const joinButton = new ButtonBuilder()
                .setCustomId('cekilis_katil')
                .setLabel('Katıl')
                .setStyle(ButtonStyle.Primary);

            const row = new ActionRowBuilder().addComponents(joinButton);

            await interaction.reply({
                embeds: [buildEmbed(0)],
                components: [row]
            });
        }
    }
});

client.login(TOKEN);