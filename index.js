require('dotenv').config();
const http = require('http'); // <-- HTTP KEEP-ALIVE SERVER
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is alive!\n');
}).listen(process.env.PORT || 3000);

const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, InteractionType } = require('discord.js');
const fs = require('fs');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
  partials: ['CHANNEL'],
});

const questionsData = JSON.parse(fs.readFileSync('./questions.json', 'utf8'));

let loveChannelId = null;
const sessions = new Map();

function normalizeAnswer(ans) {
  ans = ans.trim().toLowerCase();
  if (['صح', 'true', '1', 'نعم'].includes(ans)) return true;
  if (['خطأ', 'false', '0', 'لا'].includes(ans)) return false;
  return null;
}

async function sendDM(user, content) {
  try {
    const dm = await user.createDM();
    await dm.send(content);
    return dm;
  } catch {
    return null;
  }
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'setlove') {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({ content: 'يجب أن تكون أدمن لتستخدم هذا الأمر.', ephemeral: true });
    }
    loveChannelId = interaction.channelId;
    return interaction.reply({ content: `تم تعيين قناة التقييمات: <#${loveChannelId}>`, ephemeral: true });
  }

  if (interaction.commandName === 'starttest') {
    if (sessions.has(interaction.user.id)) {
      return interaction.reply({ content: 'أنت بالفعل في اختبار! يرجى إكماله أولاً.', ephemeral: true });
    }

    sessions.set(interaction.user.id, {
      stage: 'personal',
      personalIndex: 0,
      personalAnswers: {},
      rulesIndex: 0,
      rulesResults: [],
      mistakes: 0,
      rated: false,
    });

    await interaction.reply({ content: 'تم بدء الاختبار، سنتواصل معك على الخاص لطرح الأسئلة.', ephemeral: true });
    startPersonalTest(interaction.user);
  }
});

async function startPersonalTest(user) {
  const session = sessions.get(user.id);
  if (!session) return;

  if (session.personalIndex >= questionsData.personal.length) {
    session.stage = 'rules';
    session.rulesIndex = 0;
    askRuleQuestion(user);
    return;
  }

  const currentQ = questionsData.personal[session.personalIndex];
  const dm = await sendDM(user, `السؤال (${session.personalIndex + 1}): ${currentQ.question}`);
  if (!dm) return sessions.delete(user.id);

  const filter = m => m.author.id === user.id;
  dm.channel.awaitMessages({ filter, max: 1, time: 5 * 60 * 1000, errors: ['time'] })
    .then(collected => {
      const answer = collected.first().content.trim();
      if (currentQ.type === 'number' && isNaN(answer)) {
        dm.channel.send('يرجى إدخال رقم صالح.');
        return startPersonalTest(user);
      }
      session.personalAnswers[currentQ.question] = answer;
      session.personalIndex++;
      startPersonalTest(user);
    })
    .catch(() => {
      dm.channel.send('انتهى وقت الإجابة، تم إلغاء الاختبار.');
      sessions.delete(user.id);
    });
}

async function askRuleQuestion(user) {
  const session = sessions.get(user.id);
  if (!session) return;

  if (session.rulesIndex >= questionsData.rules.length) {
    return finishTest(user);
  }

  const currentQ = questionsData.rules[session.rulesIndex];
  const dm = await sendDM(user, `السؤال (${session.rulesIndex + 1}): ${currentQ.question} (صح/خطأ)`);
  if (!dm) return sessions.delete(user.id);

  const filter = m => m.author.id === user.id;
  dm.channel.awaitMessages({ filter, max: 1, time: 5 * 60 * 1000, errors: ['time'] })
    .then(collected => {
      const answerRaw = collected.first().content.trim();
      const answer = normalizeAnswer(answerRaw);
      if (answer === null) {
        dm.channel.send('يرجى الرد بـ "صح" أو "خطأ" فقط.');
        return askRuleQuestion(user);
      }
      const correct = answer === currentQ.answer;
      if (!correct) session.mistakes++;
      session.rulesResults.push({ question: currentQ.question, correct });

      if (session.mistakes >= 5) {
        dm.channel.send('لقد تجاوزت الحد الأقصى للأخطاء (5). تم رفض تفعيلك.');
        sessions.delete(user.id);
        return;
      }

      session.rulesIndex++;
      askRuleQuestion(user);
    })
    .catch(() => {
      dm.channel.send('انتهى وقت الإجابة، تم إلغاء الاختبار.');
      sessions.delete(user.id);
    });
}

async function finishTest(user) {
  const session = sessions.get(user.id);
  if (!session) return;
  const dm = await sendDM(user, 'تهانينا! لقد اجتزت الاختبار بنجاح.\nأهلاً بك عزيزي العضو في سيرفر رويال ستي العظيم!');
  if (!dm) return sessions.delete(user.id);

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId('rate_1').setLabel('⭐').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('rate_2').setLabel('⭐⭐').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('rate_3').setLabel('⭐⭐⭐').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('rate_4').setLabel('⭐⭐⭐⭐').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('rate_5').setLabel('⭐⭐⭐⭐⭐').setStyle(ButtonStyle.Secondary),
    );

  const embed = new EmbedBuilder()
    .setTitle('مرحباً بك في رويال ستي!')
    .setDescription('يسرنا انضمامك إلينا.\nيرجى تقييم تجربة الاختبار الخاص بك باستخدام الأزرار أدناه.')
    .setColor('Green');

  const message = await dm.channel.send({ embeds: [embed], components: [row] });
  session.rated = false;
  sessions.set(user.id, { ...session, messageId: message.id, channelId: dm.channel.id });
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  const userId = interaction.user.id;
  const session = sessions.get(userId);
  if (!session) return interaction.reply({ content: 'هذا التقييم انتهى أو غير موجود.', ephemeral: true });
  if (session.rated) return interaction.reply({ content: 'لقد قمت بالتقييم مسبقاً.', ephemeral: true });
  if (!interaction.customId.startsWith('rate_')) return;

  const rating = parseInt(interaction.customId.split('_')[1], 10);
  session.rated = true;
  sessions.set(userId, session);

  if (!loveChannelId) return interaction.reply({ content: 'لم يتم تعيين قناة التقييمات بعد.', ephemeral: true });

  const channel = await client.channels.fetch(loveChannelId).catch(() => null);
  if (!channel) return interaction.reply({ content: 'قناة التقييمات غير موجودة أو لا يمكن الوصول إليها.', ephemeral: true });

  const embed = new EmbedBuilder()
    .setTitle('تقييم اختبار العضو')
    .setDescription(`العضو: <@${userId}>\nالتقييم: ${'⭐'.repeat(rating)} (${rating} من 5)`)
    .setColor('Blue')
    .setTimestamp();

  await channel.send({ embeds: [embed] });
  await interaction.reply({ content: `شكراً لتقييمك: ${'⭐'.repeat(rating)}`, ephemeral: true });
  sessions.delete(userId);
});

client.on('ready', async () => {
  const guild = client.guilds.cache.first();
  if (!guild) return console.error('يرجى إضافة البوت إلى سيرفر واحد على الأقل.');
  await guild.commands.set([
    { name: 'starttest', description: 'ابدأ اختبار التفعيل الخاص بسيرفر رويال ستي العظيم' },
    { name: 'setlove', description: 'تعيين قناة استقبال التقييمات (للمشرفين فقط)' }
  ]);
  console.log('تم تسجيل أوامر السلاش.');
});

client.login(process.env.TOKEN);