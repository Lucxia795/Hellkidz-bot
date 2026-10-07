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
console.log('WELCOME_CHANNEL_ID:', process.env.WELCOME_CHANNEL_ID || '❌ YOK');
console.log('SETUP_VOICE_CHANNEL_ID:', process.env.SETUP_VOICE_CHANNEL_ID || '❌ YOK');
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

// Geçerli komutlar listesi (sadece bunlar uyarı sayılır)
const VALID_COMMANDS = [
    'help', 'yardim',
    'temizle', 'nuke',
    'sil', 'clear', 'purge',
    'reroll',
    'emoji-ekle', 'emojiekle', 'emojial',
    'msg',
    'ticket-kur',
    'setup', 'panel',
    'oda-bilgi', 'setup-bilgi',
    'say',
    'cek', 'çek', 'pull',
    'liderlik',
    'stat', 'stats',
    'ban', 'kick'
];

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

// 🔧 ENV öncelikli setup kanal ID'si (Render için)
function getSetupChannelId() {
    // Öncelik sırası: ENV > RAM > stats.json
    return process.env.SETUP_VOICE_CHANNEL_ID
        || client.setupVoiceChannelId
        || loadStats().setupVoiceChannelId;
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
                if (!global.tagRoleWarned) {
                    console.warn('⚠️ [SUNUCU ETİKETİ] GUILD_TAG_ROLE_ID ile eşleşen rol bulunamadı. Kontrol et: rol silinmiş veya ID yanlış olabilir.');
                    global.tagRoleWarned = true;
                    setTimeout(() => { global.tagRoleWarned = false; }, 60 * 60 * 1000);
                }
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

    // 🔧 Özel oda setup ID'si yükleme (ENV öncelikli - Render için)
    try {
        if (process.env.SETUP_VOICE_CHANNEL_ID) {
            client.setupVoiceChannelId = process.env.SETUP_VOICE_CHANNEL_ID;
            console.log(`[ÖZEL ODA] setupVoiceChannelId ENV'den yüklendi: ${client.setupVoiceChannelId}`);
        }

        const saved = loadStats();
        if (!client.setupVoiceChannelId && saved.setupVoiceChannelId) {
            client.setupVoiceChannelId = saved.setupVoiceChannelId;
            console.log(`[ÖZEL ODA] setupVoiceChannelId stats.json'dan yüklendi: ${client.setupVoiceChannelId}`);
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
            const hostId = interaction.user.id;

            const EMOJI_GIVEAWAY = '<a:e_f0xtdq:1555971362202325124>';
            const EMOJI_PRIZE    = '<a:pentagram666:1555968853698285658>';
            const EMOJI_WINNER   = '<:123:1555968816951984148>';
            const EMOJI_PEOPLE   = '<:123:1555968816951984148>';
            const EMOJI_TROPHY   = '<a:e_c18xak:1555970553322668143>';
            const EMOJI_JOIN     = '<a:cyronixTik:1322946507296739430>';
            const EMOJI_CANCEL   = '<a:cyronixRed:1322946526594465833>';
            const EMOJI_STAR     = '<a:white_star:1355954978941833236>';
            const EMOJI_CONFETTI = '<:e_63wqeb:1555970265505079410>';

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
                        `> **Kazanan(lar):** ${winnersList ? winnersList.join(', ') : 'Yok'}\n` +
                        `> **Toplam Katılımcı:** \`${participantCount}\``
                    );
                } else {
                    embed.setTitle(`${EMOJI_GIVEAWAY} **${reward}** Çekilişi`);
                    embed.setDescription(
                        `> Aşağıdaki ${EMOJI_JOIN} butonuna tıklayarak çekilişe katılabilirsin!\n\n` +
                        `⏰ **Bitiş:** <t:${endTime}:R> • <t:${endTime}:f>`
                    );
                }

                embed.addFields(
                    { name: '━━━━━━━━━━━━━━━━━━━━', value: '\u200B', inline: false },
                    { name: `${EMOJI_PRIZE} Ödül`, value: `\`\`\`${reward}\`\`\``, inline: false },
                    { name: `${EMOJI_WINNER} Kazanan Sayısı`, value: `> \`${winnerCount}\` kişi`, inline: true },
                    { name: `${EMOJI_PEOPLE} Katılımcı Sayısı`, value: `> \`${participantCount}\` kişi`, inline: true }
                );

                if (winnersList && winnersList.length > 0 && isEnded) {
                    embed.addFields({
                        name: `${EMOJI_TROPHY} Kazanan(lar)`,
                        value: winnersList.map((w, i) => `> ${i + 1}. ${w}`).join('\n'),
                        inline: false
                    });
                }

                embed.setFooter({
                    text: `Düzenleyen: ${interaction.user.tag}`,
                    iconURL: interaction.user.displayAvatarURL({ size: 64 })
                });

                if (isEnded && winnersList && winnersList.length > 0) {
                    const firstWinnerId = winnersList[0].replace(/[<@!>]/g, '');
                    const winnerUser = interaction.guild.members.cache.get(firstWinnerId)?.user
                                    || client.users.cache.get(firstWinnerId);
                    if (winnerUser) {
                        embed.setThumbnail(winnerUser.displayAvatarURL({ size: 256 }));
                    }
                } else if (!isEnded && !cancelled) {
                    const icon = interaction.guild.iconURL({ size: 256 });
                    if (icon) embed.setThumbnail(icon);
                }

                return embed;
            };

            const buildButtons = (disabled = false) => {
                return new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('giveaway_join')
                        .setLabel('Katıl')
                        .setEmoji(EMOJI_JOIN)
                        .setStyle(ButtonStyle.Success)
                        .setDisabled(disabled),
                    new ButtonBuilder()
                        .setCustomId('giveaway_cancel')
                        .setLabel('İptal Et')
                        .setEmoji(EMOJI_CANCEL)
                        .setStyle(ButtonStyle.Danger)
                        .setDisabled(disabled)
                );
            };

            await interaction.reply({ content: '✅ Çekiliş başarıyla başlatıldı!', ephemeral: true });

            const participants = new Set();
            const giveawayMsg = await interaction.channel.send({
                embeds: [buildEmbed(0)],
                components: [buildButtons()]
            });

            let cancelled = false;

            const collector = giveawayMsg.createMessageComponentCollector({ time: durationMs });

            collector.on('collect', async (i) => {
                if (i.customId === 'giveaway_join') {
                    if (cancelled) {
                        return i.reply({ content: '⚠️ Bu çekiliş iptal edildi.', ephemeral: true });
                    }

                    if (participants.has(i.user.id)) {
                        participants.delete(i.user.id);
                        await i.reply({ content: '❌ Çekilişten ayrıldınız.', ephemeral: true });
                    } else {
                        participants.add(i.user.id);
                        await i.reply({ content: `${EMOJI_STAR} Çekilişe başarıyla katıldınız!`, ephemeral: true });
                    }

                    await giveawayMsg.edit({ embeds: [buildEmbed(participants.size)] }).catch(() => {});
                }

                if (i.customId === 'giveaway_cancel') {
                    if (i.user.id !== hostId) {
                        return i.reply({ content: '❌ **Bu çekilişi sadece kuran kişi iptal edebilir!**', ephemeral: true });
                    }

                    cancelled = true;
                    collector.stop('cancelled');

                    await i.reply({ content: '🛑 Çekiliş iptal ediliyor...', ephemeral: true });

                    await giveawayMsg.edit({
                        embeds: [buildEmbed(participants.size, false, true)],
                        components: [buildButtons(true)]
                    }).catch(() => {});

                    await interaction.channel.send(`🛑 **${reward}** çekilişi ${i.user} tarafından iptal edildi.`).catch(() => {});
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'cancelled' || cancelled) return;

                const allParticipants = Array.from(participants);
                const participantArray = [...allParticipants];

                if (participantArray.length === 0) {
                    await giveawayMsg.edit({
                        embeds: [buildEmbed(0, true, false, null)],
                        components: [buildButtons(true)]
                    }).catch(() => {});
                    return interaction.channel.send(`⚠️ **${reward}** çekilişine kimse katılmadığı için çekiliş iptal edildi.`);
                }

                const totalParticipants = participantArray.length;
                const winners = [];
                const actualWinnerCount = Math.min(winnerCount, participantArray.length);

                while (winners.length < actualWinnerCount) {
                    const randomIndex = Math.floor(Math.random() * participantArray.length);
                    const selectedUser = participantArray.splice(randomIndex, 1)[0];
                    winners.push(`<@${selectedUser}>`);
                }

                await giveawayMsg.edit({
                    embeds: [buildEmbed(totalParticipants, true, false, winners)],
                    components: [buildButtons(true)]
                }).catch(() => {});

                await interaction.channel.send(`${EMOJI_CONFETTI} **Tebrikler** ${winners.join(', ')}!\n> **${reward}** ödülünü kazandınız!`);

                try {
                    const stats = loadStats();
                    stats.giveaways[giveawayMsg.id] = {
                        reward,
                        winnerCount,
                        participants: allParticipants,
                        channelId: interaction.channel.id,
                        guildId: interaction.guild.id,
                        endedAt: Date.now(),
                        hostId: interaction.user.id,
                        winners: winners.map(w => w.replace(/[<@!>]/g, ''))
                    };
                    saveStats(stats);
                    console.log(`[ÇEKİLİŞ] Veri kaydedildi: ${giveawayMsg.id} (${allParticipants.length} katılımcı)`);
                } catch (e) {
                    console.error('Çekiliş verisi kaydedilemedi:', e);
                }
            });
        }
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'ticket_select') {
            const selectedReason = interaction.values[0];
            const guild = interaction.guild;
            const user = interaction.user;

            const existingChannel = guild.channels.cache.find(c => c.name === `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`);
            if (existingChannel) {
                return interaction.reply({ content: `⚠️ Zaten açık bir talep kanalınız bulunuyor: ${existingChannel}`, ephemeral: true });
            }

            const staffRoleId = process.env.TICKET_STAFF_ROLE_ID || process.env.STAFF_ROLE_ID;

            let permissionOverwrites = [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] },
                { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
            ];

            if (staffRoleId && guild.roles.cache.has(staffRoleId)) {
                permissionOverwrites.push({ id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
            }

            const ticketChannel = await guild.channels.create({
                name: `ticket-${user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: permissionOverwrites
            });

            const ticketEmbed = new EmbedBuilder()
                .setTitle(`🎫 ${selectedReason}`)
                .setDescription(
                    `Merhaba ${user},\n\n` +
                    (selectedReason === 'Satın Alım Talebi'
                        ? `🛒 **Satın Alım Talebi:** Almak istediğiniz item/ürün detayını yazabilirsiniz.`
                        : `💬 **Genel Destek:** Destek ekibimiz en kısa sürede sizinle ilgilenecektir.`) +
                    `\n\n📌 *Ticket sadece yetkililer tarafından kapatılabilir.*`
                )
                .setColor('#2b2d31')
                .setTimestamp();

            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('ticket_call_staff').setLabel('Yetkili Çağır').setEmoji('🔔').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('ticket_close').setLabel("Ticket'ı Kapat").setEmoji('🔒').setStyle(ButtonStyle.Danger)
            );

            await ticketChannel.send({ content: `${user} ${staffRoleId ? `<@&${staffRoleId}>` : ''}`, embeds: [ticketEmbed], components: [actionRow] });
            return interaction.reply({ content: `✅ Destek talebiniz oluşturuldu: ${ticketChannel}`, ephemeral: true });
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'giveaway_join') return;

        if (interaction.customId === 'ticket_call_staff') {
            const channelId = interaction.channel.id;
            const now = Date.now();
            const cooldownTime = 60 * 1000;

            if (callCooldowns.has(channelId)) {
                const expirationTime = callCooldowns.get(channelId) + cooldownTime;
                if (now < expirationTime) {
                    const timeLeft = Math.ceil((expirationTime - now) / 1000);
                    return interaction.reply({ content: `⏳ Yeniden yetkili çağırabilmek için **${timeLeft} saniye** beklemelisiniz.`, ephemeral: true });
                }
            }

            const staffRoleId = process.env.TICKET_STAFF_ROLE_ID || process.env.STAFF_ROLE_ID;
            callCooldowns.set(channelId, now);

            await interaction.reply({ content: '🔔 Yetkili ekibine bildirim gönderildi!' });
            return interaction.channel.send({
                content: staffRoleId ? `<@&${staffRoleId}> 🔔 ${interaction.user} yetkili çağırıyor!` : `🔔 @here ${interaction.user} yetkili çağırıyor!`
            });
        }

        if (interaction.customId === 'ticket_close') {
            if (!checkAuth(interaction.member)) {
                return interaction.reply({ content: '❌ **Bu bileti kapatma yetkiniz yok! Yalnızca yetkililer kapatabilir.**', ephemeral: true });
            }

            await interaction.reply({ content: '🔒 Destek talebi 5 saniye içinde kapatılıyor...' });
            setTimeout(async () => {
                await interaction.channel.delete().catch(() => {});
            }, 5000);
            return;
        }

        if (!interaction.customId.startsWith('p_')) return;

        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel || privateChannels.get(voiceChannel.id) !== interaction.user.id) {
            return interaction.reply({ content: '⚠️ Yalnızca kendi özel ses odanızdayken bu paneli kullanabilirsiniz!', ephemeral: true });
        }

        const id = interaction.customId;

        try {
            const modalButtons = {
                p_name:   { modal: 'm_name',   title: 'Change Channel Name',  label: 'New Name',                       style: TextInputStyle.Short },
                p_limit:  { modal: 'm_limit',  title: 'Set User Capacity',    label: 'User Limit (0 = Unlimited)',     style: TextInputStyle.Short },
                p_access: { modal: 'm_access', title: 'Grant User Access',    label: 'User ID veya @etiket',           style: TextInputStyle.Short },
                p_kick:   { modal: 'm_kick',   title: 'Disconnect User',      label: 'User ID veya @etiket',           style: TextInputStyle.Short },
                p_block:  { modal: 'm_block',  title: 'Block User',           label: 'User ID veya @etiket',           style: TextInputStyle.Short },
                p_owner:  { modal: 'm_owner',  title: 'Transfer Ownership',   label: 'Yeni sahibin ID veya @etiketi',  style: TextInputStyle.Short }
            };

            if (modalButtons[id]) {
                const cfg = modalButtons[id];
                const modal = new ModalBuilder().setCustomId(cfg.modal).setTitle(cfg.title);
                const input = new TextInputBuilder().setCustomId('val').setLabel(cfg.label).setStyle(cfg.style).setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(input));
                return await interaction.showModal(modal);
            }

            if (id === 'p_lock') {
                const wasLocked = voiceChannel.permissionOverwrites.cache.get(interaction.guild.roles.everyone.id)?.deny.has(PermissionFlagsBits.Connect);
                await voiceChannel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: wasLocked ? null : false });
                return await interaction.reply({ content: wasLocked ? '🔓 Oda kilidi açıldı.' : '🔒 Oda kilitlendi.', ephemeral: true });
            }

            if (id === 'p_hide') {
                const wasHidden = voiceChannel.permissionOverwrites.cache.get(interaction.guild.roles.everyone.id)?.deny.has(PermissionFlagsBits.ViewChannel);
                await voiceChannel.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: wasHidden ? null : false });
                return await interaction.reply({ content: wasHidden ? '👁️ Oda artık görünür.' : '🙈 Oda gizlendi.', ephemeral: true });
            }

            if (id === 'p_delete') {
                privateChannels.delete(voiceChannel.id);
                savePrivateRooms();
                await interaction.reply({ content: '🗑️ Özel oda siliniyor...', ephemeral: true });
                return await voiceChannel.delete().catch(() => {});
            }
        } catch (err) {
            console.error('Özel oda panel hatası:', err);
            if (!interaction.replied && !interaction.deferred) {
                return interaction.reply({ content: '❌ İşlem sırasında bir hata oluştu (botun yetkilerini kontrol edin).', ephemeral: true }).catch(() => {});
            }
        }
    }

    if (interaction.isModalSubmit()) {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel || privateChannels.get(voiceChannel.id) !== interaction.user.id) {
            return interaction.reply({ content: '⚠️ Bu işlem için kendi özel odanızda olmalısınız.', ephemeral: true });
        }

        const value = interaction.fields.getTextInputValue('val');

        try {
            if (interaction.customId === 'm_name') {
                await voiceChannel.setName(value.slice(0, 100));
                return await interaction.reply({ content: `Kanal adı **${value}** olarak değiştirildi.`, ephemeral: true });
            }

            if (interaction.customId === 'm_limit') {
                const limit = parseInt(value);
                if (isNaN(limit) || limit < 0 || limit > 99) {
                    return await interaction.reply({ content: 'Lütfen 0 ile 99 arasında geçerli bir sayı girin.', ephemeral: true });
                }
                await voiceChannel.setUserLimit(limit);
                return await interaction.reply({ content: `Kanal limiti **${limit === 0 ? 'Sınırsız' : limit}** olarak ayarlandı.`, ephemeral: true });
            }

            if (['m_access', 'm_kick', 'm_block', 'm_owner'].includes(interaction.customId)) {
                const targetId = parseUserId(value);
                const target = await interaction.guild.members.fetch(targetId).catch(() => null);

                if (!target) {
                    return await interaction.reply({ content: '❌ Kullanıcı bulunamadı. Geçerli bir ID veya etiket girin.', ephemeral: true });
                }

                if (target.id === interaction.user.id) {
                    return await interaction.reply({ content: '⚠️ Bu işlemi kendiniz üzerinde yapamazsınız.', ephemeral: true });
                }

                if (interaction.customId === 'm_access') {
                    await voiceChannel.permissionOverwrites.edit(target.id, { ViewChannel: true, Connect: true });
                    return await interaction.reply({ content: `✅ ${target} kullanıcısına odaya erişim verildi.`, ephemeral: true });
                }

                if (interaction.customId === 'm_kick') {
                    if (target.voice.channelId !== voiceChannel.id) {
                        return await interaction.reply({ content: '⚠️ Bu kullanıcı odanızda değil.', ephemeral: true });
                    }
                    await target.voice.disconnect();
                    return await interaction.reply({ content: `👢 ${target} odadan çıkarıldı.`, ephemeral: true });
                }

                if (interaction.customId === 'm_block') {
                    await voiceChannel.permissionOverwrites.edit(target.id, { Connect: false });
                    if (target.voice.channelId === voiceChannel.id) {
                        await target.voice.disconnect().catch(() => {});
                    }
                    return await interaction.reply({ content: `⛔ ${target} odaya girişten engellendi.`, ephemeral: true });
                }

                if (interaction.customId === 'm_owner') {
                    const oldOwnerId = interaction.user.id;
                    privateChannels.set(voiceChannel.id, target.id);
                    savePrivateRooms();

                    await voiceChannel.permissionOverwrites.edit(target.id, {
                        ViewChannel: true,
                        Connect: true,
                        ManageChannels: true,
                        MoveMembers: true
                    });
                    await voiceChannel.permissionOverwrites.delete(oldOwnerId).catch(() => {});

                    return await interaction.reply({ content: `👑 Oda sahipliği ${target} kullanıcısına devredildi.`, ephemeral: true });
                }
            }
        } catch (err) {
            console.error('Modal işleme hatası:', err);
            if (!interaction.replied && !interaction.deferred) {
                return interaction.reply({ content: '❌ İşlem sırasında bir hata oluştu (botun yetkilerini kontrol edin).', ephemeral: true }).catch(() => {});
            }
        }
    }
});

// --- NOKTALI (.) KOMUTLAR ---
client.on('messageCreate', async (message) => {
    if (!message.content.startsWith(PREFIX) || message.author.bot || !message.guild) return;

    // 🚫 Sadece "." yazıldıysa hiçbir şey yapma
    if (message.content.trim() === PREFIX) return;

    // 🚫 Prefix'ten sonra komut adı yoksa veya geçersiz komutsa uyarı verme
    const withoutPrefix = message.content.slice(PREFIX.length).trim();
    const cmdName = withoutPrefix.split(/ +/)[0].toLowerCase();

    if (!cmdName || !VALID_COMMANDS.includes(cmdName)) return;

    const allowedChannelId = process.env.COMMAND_CHANNEL_ID;

    if (allowedChannelId && message.channel.id !== allowedChannelId) {
        const isStaffOrOwner = checkAuth(message.member) || isOwner(message.member);

        if (!isStaffOrOwner) {
            if (mutedUsers.has(message.author.id)) {
                const muteEnd = mutedUsers.get(message.author.id);
                if (Date.now() < muteEnd) {
                    await message.delete().catch(() => {});
                    return;
                } else {
                    mutedUsers.delete(message.author.id);
                }
            }

            const now = Date.now();
            const WINDOW = 30 * 1000;
            const LIMIT = 3;

            if (!commandSpamTracker.has(message.author.id)) {
                commandSpamTracker.set(message.author.id, []);
            }

            const timestamps = commandSpamTracker.get(message.author.id).filter(t => now - t < WINDOW);
            timestamps.push(now);
            commandSpamTracker.set(message.author.id, timestamps);

            await message.delete().catch(() => {});

            if (timestamps.length < LIMIT) {
                const remaining = LIMIT - timestamps.length;
                const warnMsg = await message.channel.send(
                    `⚠️ ${message.author}, bot komutlarını sadece <#${allowedChannelId}> kanalında kullanabilirsin!\n` +
                    `> **Uyarı:** \`${timestamps.length}/${LIMIT}\` — ${remaining} uyarı sonra **10 dakika** susturulacaksın.`
                );
                setTimeout(() => warnMsg.delete().catch(() => {}), 8000);
                return;
            }

            const MUTE_DURATION = 10 * 60 * 1000;
            const muteEnd = now + MUTE_DURATION;
            mutedUsers.set(message.author.id, muteEnd);
            commandSpamTracker.delete(message.author.id);

            try {
                if (message.member.moderatable) {
                    await message.member.timeout(MUTE_DURATION, `Komut kanalı spam - ${LIMIT} uyarı`);
                }
            } catch (e) {
                console.error('Timeout uygulanamadı:', e);
            }

            const muteMsg = await message.channel.send(
                `🔇 ${message.author} **10 dakika** boyunca susturuldu!\n` +
                `> **Sebep:** Komut kanalı dışında sürekli bot komutu kullanma (spam).`
            );
            setTimeout(() => muteMsg.delete().catch(() => {}), 15000);

            try {
                const logEmbed = new EmbedBuilder()
                    .setTitle('🔇 Kullanıcı Susturuldu (Komut Spam)')
                    .setColor('#e74c3c')
                    .setThumbnail(message.author.displayAvatarURL())
                    .addFields(
                        { name: 'Kullanıcı', value: `${message.author} (\`${message.author.id}\`)`, inline: true },
                        { name: 'Kanal', value: `${message.channel}`, inline: true },
                        { name: 'Süre', value: '`10 dakika`', inline: true },
                        { name: 'Sebep', value: 'Komut kanalı dışında 30 saniyede 3+ kez bot komutu kullanma', inline: false }
                    )
                    .setTimestamp();

                await sendLog(message.guild, 'LOG_MESSAGE_DELETE', logEmbed);
            } catch (logErr) {
                console.error('Spam log hatası:', logErr);
            }

            return;
        }
    }

    const contentWithoutPrefix = message.content.slice(PREFIX.length).trim();
    const args = contentWithoutPrefix.split(/ +/);
    const command = args.shift().toLowerCase();

    // --- 🧹 TEMİZLE ---
    if (command === 'temizle' || command === 'nuke') {
        const allowedRoleId = process.env.MSG_AND_NUKE_ROLE_ID;
        if (!hasRole(message.member, allowedRoleId) && !isOwner(message.member)) {
            return message.reply('❌ **yetkin yok**');
        }

        global.bulkDeletingChannels.add(message.channel.id);

        try {
            let totalDeleted = 0;
            const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
            let hasMore = true;
            let safety = 0;

            while (hasMore && safety < 100) {
                safety++;
                const fetched = await message.channel.messages.fetch({ limit: 100 });

                if (fetched.size === 0) break;

                const deletable = fetched.filter(m => m.createdTimestamp > twoWeeksAgo);
                const oldOnes = fetched.filter(m => m.createdTimestamp <= twoWeeksAgo);

                if (deletable.size > 0) {
                    const deleted = await message.channel.bulkDelete(deletable, true).catch(() => null);
                    totalDeleted += deleted?.size || 0;
                }

                for (const msg of oldOnes.values()) {
                    await msg.delete().catch(() => {});
                    totalDeleted++;
                    await new Promise(r => setTimeout(r, 300));
                }

                if (fetched.size < 100) hasMore = false;

                await new Promise(r => setTimeout(r, 1000));
            }

            const infoMsg = await message.channel.send(`🧹 **${totalDeleted} mesaj temizlendi.**`);
            setTimeout(() => infoMsg.delete().catch(() => {}), 5000);
        } catch (error) {
            console.error('Temizleme hatası:', error);
            const errMsg = await message.channel.send('⚠️ Mesajlar temizlenirken bir hata oluştu.').catch(() => null);
            if (errMsg) setTimeout(() => errMsg.delete().catch(() => {}), 5000);
        } finally {
            global.bulkDeletingChannels.delete(message.channel.id);
        }
        return;
    }

    // --- 🗑️ SİL ---
    if (command === 'sil' || command === 'clear' || command === 'purge') {
        const allowedRoleId = process.env.MSG_AND_NUKE_ROLE_ID;
        if (!hasRole(message.member, allowedRoleId) && !isOwner(message.member)) {
            return message.reply('❌ **yetkin yok**');
        }

        const amount = parseInt(args[0]);

        if (isNaN(amount) || amount < 1 || amount > 1000) {
            const warn = await message.reply('⚠️ Kullanım: `.sil <1-1000>` (Örn: `.sil 50`)');
            setTimeout(() => warn.delete().catch(() => {}), 5000);
            return;
        }

        global.bulkDeletingChannels.add(message.channel.id);

        try {
            let totalDeleted = 0;
            const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
            let remaining = amount;
            let safety = 0;

            while (remaining > 0 && safety < 20) {
                safety++;
                const fetchLimit = Math.min(remaining + 1, 100);
                const fetched = await message.channel.messages.fetch({ limit: fetchLimit });

                if (fetched.size === 0) break;

                const toDelete = fetched.first(Math.min(remaining, 100));
                const deletable = toDelete.filter(m => m.createdTimestamp > twoWeeksAgo);
                const oldOnes = toDelete.filter(m => m.createdTimestamp <= twoWeeksAgo);

                if (deletable.size > 0) {
                    const deleted = await message.channel.bulkDelete(deletable, true).catch(() => null);
                    totalDeleted += deleted?.size || 0;
                }

                for (const msg of oldOnes.values()) {
                    await msg.delete().catch(() => {});
                    totalDeleted++;
                    await new Promise(r => setTimeout(r, 300));
                }

                remaining = amount - totalDeleted;

                if (fetched.size < fetchLimit) break;
                await new Promise(r => setTimeout(r, 1000));
            }

            await message.delete().catch(() => {});

            const infoMsg = await message.channel.send(`🗑️ **${totalDeleted} mesaj silindi.**`);
            setTimeout(() => infoMsg.delete().catch(() => {}), 5000);
        } catch (error) {
            console.error('Silme hatası:', error);
            const errMsg = await message.channel.send('⚠️ Mesajlar silinirken bir hata oluştu.').catch(() => null);
            if (errMsg) setTimeout(() => errMsg.delete().catch(() => {}), 5000);
        } finally {
            global.bulkDeletingChannels.delete(message.channel.id);
        }
        return;
    }

    // --- 🎲 REROLL ---
    if (command === 'reroll') {
        if (!checkAuth(message.member)) {
            const warn = await message.reply('⚠️ **Bu komutu kullanmak için yetkiniz bulunmamaktadır.**');
            setTimeout(() => warn.delete().catch(() => {}), 5000);
            return;
        }

        let messageId = args[0];
        if (!messageId) {
            const warn = await message.reply('⚠️ Kullanım: `.reroll <mesaj_id>`\nÖrnek: `.reroll 1555963799599583386`');
            setTimeout(() => warn.delete().catch(() => {}), 8000);
            return;
        }

        messageId = messageId.replace(/[<>&?=]/g, '');
        if (messageId.includes('/')) {
            const parts = messageId.split('/');
            messageId = parts[parts.length - 1];
        }

        const stats = loadStats();
        const giveawayData = stats.giveaways?.[messageId];

        if (!giveawayData) {
            const warn = await message.reply('❌ Bu ID ile kayıtlı bir çekiliş bulunamadı.\n*(Sadece bu bot ile yapılan ve `.reroll` öncesi biten çekilişler için çalışır.)*');
            setTimeout(() => warn.delete().catch(() => {}), 8000);
            return;
        }

        if (!giveawayData.participants || giveawayData.participants.length === 0) {
            const warn = await message.reply('❌ Bu çekilişe katılan kimse yok, yeniden kazanan seçilemez.');
            setTimeout(() => warn.delete().catch(() => {}), 8000);
            return;
        }

        const winnerCount = giveawayData.winnerCount || 1;
        const pool = [...giveawayData.participants];
        const winners = [];
        const actualWinnerCount = Math.min(winnerCount, pool.length);

        while (winners.length < actualWinnerCount) {
            const randomIndex = Math.floor(Math.random() * pool.length);
            const selected = pool.splice(randomIndex, 1)[0];
            winners.push(`<@${selected}>`);
        }

        const rerollEmbed = new EmbedBuilder()
            .setTitle('🎲 Çekiliş Yeniden Çekildi (Reroll)')
            .setColor('#f39c12')
            .setDescription(
                `**Ödül:** ${giveawayData.reward}\n` +
                `**Yeni Kazanan(lar):** ${winners.join(', ')}\n` +
                `**Katılımcı Sayısı:** ${giveawayData.participants.length}\n` +
                `**Yetkili:** ${message.author}`
            )
            .setFooter({ text: `Çekiliş ID: ${messageId}` })
            .setTimestamp();

        try {
            const channel = await client.channels.fetch(giveawayData.channelId).catch(() => null);
            if (channel) {
                const oldMsg = await channel.messages.fetch(messageId).catch(() => null);
                if (oldMsg) {
                    await oldMsg.reply({
                        content: `🎲 **Yeniden Çekiliş!** Yeni kazanan(lar): ${winners.join(', ')} — Tebrikler!`,
                        allowedMentions: { users: winners.map(w => w.replace(/[<@!>]/g, '')) }
                    });
                }
            }
        } catch (e) {
            console.error('Reroll mesaj gönderme hatası:', e);
        }

        return message.reply({ embeds: [rerollEmbed] });
    }

    // --- 😀 EMOJİ-EKLE ---
    if (command === 'emoji-ekle' || command === 'emojiekle' || command === 'emojial') {
        const allowedRoleId = process.env.TICKET_SETUP_ROLE_ID;
        if (!hasRole(message.member, allowedRoleId) && !isOwner(message.member) && !message.member.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
            const warn = await message.reply('❌ **yetkin yok**');
            setTimeout(() => warn.delete().catch(() => {}), 5000);
            return;
        }

        const emojiInputs = args.filter(a => /<(a?):([a-zA-Z0-9_]+):(\d+)>/.test(a));

        if (emojiInputs.length === 0) {
            const warn = await message.reply(
                '⚠️ **Kullanım:**\n' +
                '`.emoji-ekle <emoji1> <emoji2> ...`\n\n' +
                '**Örnekler:**\n' +
                '• `.emoji-ekle <:a:111> <:b:222> <a:c:333>`\n' +
                '• Tek seferde 10-20-50 tane ekleyebilirsin'
            );
            setTimeout(() => warn.delete().catch(() => {}), 15000);
            return;
        }

        if (emojiInputs.length > 50) {
            const warn = await message.reply(`⚠️ Tek seferde en fazla **50** emoji eklenebilir. (${emojiInputs.length} yazdın)`);
            setTimeout(() => warn.delete().catch(() => {}), 8000);
            return;
        }

        const currentEmojis = message.guild.emojis.cache.size;
        const maxEmojis = { 0: 50, 1: 100, 2: 150, 3: 250 }[message.guild.premiumTier] || 50;
        const availableSlots = maxEmojis - currentEmojis;

        if (availableSlots <= 0) {
            const warn = await message.reply(`❌ Sunucu emoji limiti dolu (${currentEmojis}/${maxEmojis}).`);
            setTimeout(() => warn.delete().catch(() => {}), 8000);
            return;
        }

        const generateRandomName = () => {
            const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
            let result = 'e_';
            for (let i = 0; i < 6; i++) {
                result += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return result;
        };

        const pendingEmojiNames = new Set();

        const generateUniqueName = () => {
            let name;
            let attempts = 0;
            do {
                name = generateRandomName();
                attempts++;
            } while (
                (message.guild.emojis.cache.find(e => e.name === name) ||
                 pendingEmojiNames.has(name)) &&
                attempts < 50
            );
            pendingEmojiNames.add(name);
            return name;
        };

        const toProcess = emojiInputs.slice(0, availableSlots);
        const skipped = emojiInputs.length - toProcess.length;

        const statusMsg = await message.channel.send(
            `⏳ **${toProcess.length} emoji** yükleniyor...\n` +
            (skipped > 0 ? `_(Limit dolduğu için ${skipped} emoji atlanacak)_\n` : '') +
            `Bu işlem biraz sürebilir, lütfen bekleyin.`
        );

        const results = { success: [], failed: [] };

        for (let i = 0; i < toProcess.length; i++) {
            const emojiInput = toProcess[i];

            try {
                const match = emojiInput.match(/<(a?):([a-zA-Z0-9_]+):(\d+)>/);
                if (!match) {
                    results.failed.push({ input: emojiInput, reason: 'Geçersiz format' });
                    continue;
                }

                const isAnimated = match[1] === 'a';
                const emojiId = match[3];
                const extension = isAnimated ? 'gif' : 'png';
                const emojiUrl = `https://cdn.discordapp.com/emojis/${emojiId}.${extension}`;
                const newName = generateUniqueName();

                const newEmoji = await message.guild.emojis.create({
                    attachment: emojiUrl,
                    name: newName,
                    reason: `Toplu emoji çalındı - ${message.author.tag}`
                });

                results.success.push({
                    name: newEmoji.name,
                    id: newEmoji.id,
                    animated: isAnimated,
                    emoji: newEmoji
                });

                if ((i + 1) % 3 === 0 || i === toProcess.length - 1) {
                    await statusMsg.edit(
                        `⏳ **İlerleme:** ${i + 1}/${toProcess.length}\n` +
                        `✅ Başarılı: ${results.success.length}\n` +
                        `❌ Başarısız: ${results.failed.length}`
                    ).catch(() => {});
                }

                if (i < toProcess.length - 1) {
                    await new Promise(r => setTimeout(r, 1000));
                }

            } catch (err) {
                console.error('Emoji ekleme hatası:', err);
                let reason = 'Bilinmeyen hata';
                if (err.code === 30008) reason = 'Limit dolu';
                else if (err.code === 50035) reason = 'Geçersiz veri';
                else if (err.message?.includes('File size')) reason = 'Dosya çok büyük';
                else if (err.message?.includes('Missing Permissions')) reason = 'Bot yetkisi yok';
                else if (err.code === 429) reason = 'Rate limit';

                results.failed.push({ input: emojiInput, reason });

                if (err.code === 429) {
                    await new Promise(r => setTimeout(r, 3000));
                }
            }
        }

        let resultText = `✅ **Toplu Emoji Yükleme Tamamlandı!**\n\n`;
        resultText += `📊 **Toplam:** ${toProcess.length}\n`;
        resultText += `✅ **Başarılı:** ${results.success.length}\n`;
        resultText += `❌ **Başarısız:** ${results.failed.length}\n`;

        if (skipped > 0) {
            resultText += `⏭️ **Atlanan (limit):** ${skipped}\n`;
        }

        if (results.success.length > 0) {
            const successList = results.success.slice(0, 25).map(e => e.emoji.toString()).join(' ');
            resultText += `\n**Eklenen Emojiler:**\n${successList}`;
            if (results.success.length > 25) {
                resultText += ` _...ve ${results.success.length - 25} tane daha_`;
            }
        }

        if (results.failed.length > 0) {
            resultText += `\n\n**Başarısız Olanlar:**\n`;
            const failedList = results.failed.slice(0, 5).map(f => `• \`${f.reason}\``).join('\n');
            resultText += failedList;
            if (results.failed.length > 5) {
                resultText += `\n_...ve ${results.failed.length - 5} tane daha_`;
            }
        }

        await statusMsg.edit(resultText);
        setTimeout(() => statusMsg.delete().catch(() => {}), 30000);

        if (results.success.length > 0) {
            try {
                const logEmbed = new EmbedBuilder()
                    .setTitle('😀 Toplu Emoji Eklendi')
                    .setColor('#9b59b6')
                    .setDescription(`${results.success.length} emoji başarıyla yüklendi.`)
                    .addFields(
                        { name: 'Ekleyen', value: `${message.author} (\`${message.author.id}\`)`, inline: true },
                        { name: 'Başarılı', value: `${results.success.length}`, inline: true },
                        { name: 'Başarısız', value: `${results.failed.length}`, inline: true }
                    )
                    .setTimestamp();

                const preview = results.success.slice(0, 20).map(e => e.emoji.toString()).join(' ');
                logEmbed.addFields({ name: 'Önizleme', value: preview + (results.success.length > 20 ? ` ...+${results.success.length - 20}` : '') });

                await sendLog(message.guild, 'LOG_GUILD', logEmbed);
            } catch (logErr) {
                console.error('Toplu emoji log hatası:', logErr);
            }
        }

        return;
    }

    // MSG
    if (command === 'msg') {
        const allowedRoleId = process.env.MSG_AND_NUKE_ROLE_ID;
        if (!hasRole(message.member, allowedRoleId) && !isOwner(message.member)) {
            return message.reply('❌ **yetkin yok**');
        }

        const text = args.join(' ');
        if (!text) return message.reply('Kullanım: `.msg <Gönderilecek Duyuru Mesajı>`');

        const statusMsg = await message.channel.send('⏳ Sunucu üyelerine mesaj gönderimi başlatıldı...');

        const members = await message.guild.members.fetch();
        let successCount = 0;
        let failCount = 0;
        let processed = 0;

        for (const [id, member] of members) {
            if (member.user.bot) continue;

            try {
                await member.send(`📢 **${message.guild.name} Sunucusundan Duyuru:**\n\n${text}`);
                successCount++;
            } catch {
                failCount++;
            }

            processed++;
            await new Promise(resolve => setTimeout(resolve, 1200));

            if (processed % 50 === 0) {
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        return statusMsg.edit(`✅ **Toplu Duyuru Tamamlandı!**\n\n• **Başarılı:** ${successCount} üye\n• **Başarısız (DM Kapalı):** ${failCount} üye`);
    }

    if (command === 'ticket-kur') {
        const allowedRoleId = process.env.TICKET_SETUP_ROLE_ID;
        if (!hasRole(message.member, allowedRoleId) && !isOwner(message.member)) {
            return message.reply('❌ **yetkin yok**');
        }

        const ticketEmbed = new EmbedBuilder()
            .setTitle('🎫 Destek & Satın Alım Paneli')
            .setDescription('Aşağıdaki menüden işlem türünü seçerek talebinizi veya satın alım talebinizi iletebilirsiniz.')
            .setColor('#2ecc71');

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('ticket_select')
            .setPlaceholder('Lütfen işlem türü seçin...')
            .addOptions([
                { label: 'Genel Destek', description: 'Sorularınız ve genel yardım talepleri için.', value: 'Genel Destek', emoji: '❓' },
                { label: 'Satın Alım Talebi', description: 'Satılan item/ürünü satın almak için destek talebi açın.', value: 'Satın Alım Talebi', emoji: '🛒' }
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        await message.delete().catch(() => {});
        return message.channel.send({ embeds: [ticketEmbed], components: [row] });
    }

    if (command === 'setup' || command === 'panel') {
        const allowedRoleId = process.env.TICKET_SETUP_ROLE_ID;
        if (!hasRole(message.member, allowedRoleId) && !isOwner(message.member)) {
            return message.reply('❌ **yetkin yok**');
        }

        try {
            const category = await message.guild.channels.create({ name: '.', type: ChannelType.GuildCategory });

            const voiceChannel = await message.guild.channels.create({
                name: 'oluştur',
                type: ChannelType.GuildVoice,
                parent: category.id
            });

            client.setupVoiceChannelId = voiceChannel.id;
            const s = loadStats();
            s.setupVoiceChannelId = voiceChannel.id;
            saveStats(s);

            // 📌 Render kullanıyorsan ENV'e eklemen gereken ID
            console.log(`\n=========================================`);
            console.log(`📌 [ÖZEL ODA] Yeni kurulum kanalı oluşturuldu!`);
            console.log(`   Kanal ID: ${voiceChannel.id}`);
            console.log(`   Lokal: .env → SETUP_VOICE_CHANNEL_ID=${voiceChannel.id}`);
            console.log(`   Render: Environment Variables → SETUP_VOICE_CHANNEL_ID = ${voiceChannel.id}`);
            console.log(`=========================================\n`);

            const embed = new EmbedBuilder()
                .setDescription(
                    "**Name** - Change channel name\n" +
                    "**Limit** - Set user capacity (0 = Unlimited)\n" +
                    "**Lock** - Lock / unlock channel\n" +
                    "**Hide** - Hide / unhide channel\n" +
                    "**Access** - Grant user access\n" +
                    "**Kick** - Disconnect user from channel\n" +
                    "**Block** - Block user from joining channel\n" +
                    "**Owner** - Transfer room ownership\n" +
                    "**Delete** - Delete private room"
                )
                .setColor('#2b2d31');

            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('p_name').setLabel('Name').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('p_limit').setLabel('Limit').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('p_lock').setLabel('Lock').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('p_hide').setLabel('Hide').setStyle(ButtonStyle.Secondary)
            );

            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('p_access').setLabel('Access').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('p_kick').setLabel('Kick').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('p_block').setLabel('Block').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('p_owner').setLabel('Owner').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('p_delete').setLabel('Delete').setStyle(ButtonStyle.Danger)
            );

            await message.channel.send({ embeds: [embed], components: [row1, row2] });
            return message.channel.send(`✅ Özel ses odası yönetim paneli oluşturuldu!\n\n> 📌 **Kanal ID:** \`${voiceChannel.id}\`\n> Bu ID'yi **Render → Environment Variables → SETUP_VOICE_CHANNEL_ID** olarak eklemeyi unutma!`);
        } catch (err) {
            console.error('Panel kurulum hatası:', err);
            return message.channel.send('❌ Panel kurulurken hata oluştu. Botun "Kanalları Yönet" yetkisi olduğundan emin olun.');
        }
    }

    // --- 📌 ODA KURULUM BİLGİSİ ---
    if (command === 'oda-bilgi' || command === 'setup-bilgi') {
        if (!checkAuth(message.member) && !isOwner(message.member)) {
            return message.reply('❌ **yetkin yok**');
        }

        const currentId = getSetupChannelId();
        const channel = currentId ? message.guild.channels.cache.get(currentId) : null;
        const stats = loadStats();

        const embed = new EmbedBuilder()
            .setTitle('📌 Özel Oda Kurulum Bilgisi')
            .setColor('#3498db')
            .addFields(
                {
                    name: '🔧 Aktif Setup Kanalı',
                    value: channel ? `${channel} (\`${currentId}\`)` : `❌ Bulunamadı (ID: \`${currentId || 'yok'}\`)`,
                    inline: false
                },
                {
                    name: '📂 ENV (Render)',
                    value: process.env.SETUP_VOICE_CHANNEL_ID
                        ? `\`${process.env.SETUP_VOICE_CHANNEL_ID}\``
                        : '❌ Tanımlı değil',
                    inline: true
                },
                {
                    name: '💾 stats.json',
                    value: stats.setupVoiceChannelId
                        ? `\`${stats.setupVoiceChannelId}\``
                        : '❌ Kayıtlı değil',
                    inline: true
                },
                {
                    name: '🧠 RAM (client)',
                    value: client.setupVoiceChannelId
                        ? `\`${client.setupVoiceChannelId}\``
                        : '❌ Yok',
                    inline: true
                }
            )
            .setDescription(
                '**Nasıl kullanılır?**\n' +
                '1. `.panel` komutuyla yeni bir setup kanalı oluştur\n' +
                '2. Botun konsolunda çıkan **Kanal ID**\'yi kopyala\n' +
                '3. **Render → Environment Variables** → `SETUP_VOICE_CHANNEL_ID` olarak ekle\n' +
                '4. Deploy et — artık bot yeniden başlasa bile çalışır ✅'
            )
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    if (command === 'help' || command === 'yardim') {
        const helpEmbed = new EmbedBuilder()
            .setTitle('📜 Bot Komut Listesi')
            .setColor('#3498db')
            .setDescription('Kullanabileceğiniz tüm bot komutları aşağıda kategorilere ayrılmıştır:')
            .addFields(
                {
                    name: '👤 Genel Komutlar',
                    value: '• `.help` - Komut menüsünü görüntüler.\n• `.stat` - Kişisel mesaj ve ses istatistiklerinizi gösterir.\n• `.liderlik` - En aktif 5 üyenin sıralamasını görüntüler.'
                },
                {
                    name: '🛠️ Yetkili / Owner Komutları',
                    value: '• `.temizle` - Kanaldaki tüm mesajları temizler.\n• `.sil <sayı>` - Belirtilen sayıda mesaj siler.\n• `/cekilis` - Süreli ve butonlu çekiliş başlatır.\n• `.reroll <mesaj_id>` - Bitmiş çekilişi yeniden çeker.\n• `.emoji-ekle <emoji...>` - Toplu emoji çalar.\n• `.ticket-kur` - Destek talebi panelini kurar.\n• `.say` - Sunucu üye ve boost durumunu gösterir.\n• `.msg <mesaj>` - Tüm sunucu üyelerine toplu DM gönderir.\n• `.ban @üye <sebep>` - Belirtilen üyeyi sunucudan yasaklar.\n• `.kick @üye <sebep>` - Belirtilen üyeyi sunucudan atar.\n• `.panel` - Özel ses odası yönetim panelini kurar.\n• `.oda-bilgi` - Setup kanal bilgisini gösterir.'
                }
            )
            .setFooter({ text: `${message.guild.name} • Yardım Sistemi`, iconURL: message.guild.iconURL() });

        return message.channel.send({ embeds: [helpEmbed] });
    }

    if (command === 'say') {
        if (!checkAuth(message.member)) {
            return message.reply('⚠️ **Bu komutu kullanmak için yetkiniz bulunmamaktadır.**');
        }

        const totalMembers = message.guild.memberCount;
        const boostCount = message.guild.premiumSubscriptionCount || 0;
        const boostLevel = message.guild.premiumTier;

        const embed = new EmbedBuilder()
            .setTitle('📊 Sunucu İstatistikleri')
            .setColor('Blurple')
            .addFields(
                { name: '👥 Üye Sayısı', value: `**${totalMembers}**`, inline: true },
                { name: '🚀 Takviye Sayısı', value: `**${boostCount}**`, inline: true },
                { name: '⭐ Takviye Seviyesi', value: `**Seviye ${boostLevel}**`, inline: true }
            );
        return message.channel.send({ embeds: [embed] });
    }

    if (command === 'cek' || command === 'çek' || command === 'pull') {
        if (!checkAuth(message.member)) {
            return message.reply('⚠️ Bu komutu kullanmak için yetkiniz bulunmamaktadır.');
        }

        const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
        if (!target) {
            return message.reply('⚠️ Lütfen ses kanalınıza çekmek istediğiniz kullanıcıyı etiketleyin veya ID girin. (`.çek @kullanıcı`)');
        }

        if (target.id === message.author.id) {
            return message.reply('⚠️ Kendinizi ses kanalına çekemezsiniz.');
        }

        const authorVoiceChannel = message.member.voice.channel;
        if (!authorVoiceChannel) {
            return message.reply('⚠️ Kullanıcıyı çekebilmek için önce bir ses kanalında olmalısınız.');
        }

        if (!target.voice.channel) {
            return message.reply('⚠️ Etiketlediğiniz kullanıcı şu anda herhangi bir ses kanalında değil.');
        }

        if (target.voice.channel.id === authorVoiceChannel.id) {
            return message.reply('⚠️ Etiketlediğiniz kullanıcı zaten sizinle aynı ses kanalında.');
        }

        try {
            await target.voice.setChannel(authorVoiceChannel);
            return message.reply(`✅ ${target} kullanıcısı doğrudan **${authorVoiceChannel.name}** kanalına taşındı.`);
        } catch (error) {
            return message.reply('❌ Kullanıcı taşınırken bir hata oluştu (Botun "Üyeleri Taşı" / "Move Members" yetkisinin olduğundan emin olun).');
        }
    }

    if (command === 'liderlik') {
        const stats = loadStats();

        const topMsg = Object.entries(stats.messages)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([id, count], i) => `${i + 1}. <@${id}> - **${count}** mesaj`)
            .join('\n') || 'Veri yok.';

        const topVoice = Object.entries(stats.voice)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([id, sec], i) => `${i + 1}. <@${id}> - **${Math.floor(sec / 60)}** dakika`)
            .join('\n') || 'Veri yok.';

        const msgEmbed = new EmbedBuilder().setTitle('💬 Mesaj Liderlik Tablosu').setDescription(topMsg).setColor('Green');
        const voiceEmbed = new EmbedBuilder().setTitle('🔊 Ses Liderlik Tablosu').setDescription(topVoice).setColor('Blue');

        return message.channel.send({ embeds: [msgEmbed, voiceEmbed] });
    }

    if (command === 'stat' || command === 'stats') {
        const target = message.mentions.members.first() || message.member;
        const stats = loadStats();

        const msgCount = stats.messages[target.id] || 0;
        let voiceTimeSec = stats.voice[target.id] || 0;

        if (target.voice && target.voice.channel && voiceStates.has(target.id)) {
            const activeSessionSec = Math.floor((Date.now() - voiceStates.get(target.id)) / 1000);
            voiceTimeSec += activeSessionSec;
        }

        const inviteData = stats.invites[target.id] || { total: 0, left: 0 };
        const inviteTotal = inviteData.total || 0;
        const inviteLeft = inviteData.left || 0;

        const hours = Math.floor(voiceTimeSec / 3600);
        const minutes = Math.floor((voiceTimeSec % 3600) / 60);
        const seconds = voiceTimeSec % 60;

        const embed = new EmbedBuilder()
            .setTitle(`📊 Kullanıcı İstatistikleri - ${target.user.username}`)
            .setThumbnail(target.user.displayAvatarURL())
            .setColor('#9b59b6')
            .addFields(
                { name: '💬 Toplam Mesaj', value: `\`${msgCount}\` mesaj`, inline: true },
                { name: '🔊 Ses Süresi', value: `\`${hours} saat, ${minutes} dk, ${seconds} sn\``, inline: true },
                { name: '📨 Davet Bilgisi', value: `**Davet sayısı:** \`${inviteTotal}\`\n**Ayrılan:** \`${inviteLeft}\``, inline: false }
            )
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    if (command === 'ban') {
        if (!checkAuth(message.member) && !message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
            return message.reply('yetkin yok');
        }

        const targetArg = args[0];
        if (!targetArg) {
            return message.reply('⚠️ Lütfen yasaklanacak kullanıcıyı etiketleyin veya ID yazın. (`.ban @kullanıcı` veya `.ban 123456789012345678`)');
        }

        const targetId = message.mentions.users.first()?.id || targetArg.replace(/[<@!>]/g, '');

        if (targetId === message.author.id) {
            return message.reply('⚠️ Kendinizi yasaklayamazsınız.');
        }

        const reason = args.slice(1).join(' ') || 'Sebep belirtilmedi.';

        try {
            const member = await message.guild.members.fetch(targetId).catch(() => null);
            if (member && !member.bannable) {
                return message.reply('❌ Bu kullanıcıyı yasaklamak için botun yetkisi yetersiz (Rolü botun üstünde olabilir).');
            }

            await message.guild.members.ban(targetId, { reason });
            return message.reply(`✅ **${targetId}** ID'li kullanıcı başarıyla yasaklandı. **Sebep:** ${reason}`);
        } catch (error) {
            return message.reply('❌ Kullanıcı yasaklanırken bir hata oluştu (ID hatalı olabilir veya botun ban yetkisi yok).');
        }
    }

    if (command === 'kick') {
        if (!checkAuth(message.member) && !message.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
            return message.reply('yetkin yok');
        }

        const targetArg = args[0];
        if (!targetArg) {
            return message.reply('⚠️ Lütfen atılacak kullanıcıyı etiketleyin veya ID yazın. (`.kick @kullanıcı` veya `.kick 123456789012345678`)');
        }

        const targetId = message.mentions.members.first()?.id || targetArg.replace(/[<@!>]/g, '');
        const target = await message.guild.members.fetch(targetId).catch(() => null);

        if (!target) {
            return message.reply('❌ Belirtilen ID veya etikete sahip kullanıcı sunucuda bulunamadı.');
        }

        if (target.id === message.author.id) {
            return message.reply('⚠️ Kendinizi sunucudan atamazsınız.');
        }

        if (!target.kickable) {
            return message.reply('❌ Bu kullanıcıyı atmak için botun yetkisi yetersiz (Rolü botun üstünde olabilir).');
        }

        const reason = args.slice(1).join(' ') || 'Sebep belirtilmedi.';

        try {
            await target.kick(reason);
            return message.reply(`✅ **${target.user.tag}** (${target.id}) sunucudan atıldı. **Sebep:** ${reason}`);
        } catch (error) {
            return message.reply('❌ Kullanıcı atılırken bir hata oluştu.');
        }
    }
});

client.login(TOKEN);