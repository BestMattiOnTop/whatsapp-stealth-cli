const { default: makeWASocket, useMultiFileAuthState, fetchLatestWaWebVersion } = require('baileys');
const pino = require('pino');
const os = require('os');
const path = require('path');
const readline = require('readline');

let lastSenderJid = null;
let lastSenderName = null;
const messageHistory = []; 
const recentContacts = new Map(); // Mappa numero -> Nome
const MAX_HISTORY = 10;

async function startService() {
    console.log("Starting node-daemon-sync...");
    
    const cacheFolder = path.join(os.homedir(), '.local', 'share', 'mudslide');
    const { state, saveCreds } = await useMultiFileAuthState(cacheFolder);
    const { version } = await fetchLatestWaWebVersion({});

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }), 
        auth: state,
        markOnlineOnConnect: false, 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection } = update;
        if(connection === 'close') {
            console.log('Daemon disconnected. Reconnecting...');
            startService();
        } else if(connection === 'open') {
            console.log('Service connection established. [Status: OK]\n');
            console.log('Available commands:');
            console.log('  r <text>       - Reply to last');
            console.log('  n <num> <text> - Send to number (include country code, e.g. 39...)');
            console.log('  v              - Mark last chat as read (send blue ticks)');
            console.log('  h              - Show recent history');
            console.log('  l              - List recent contacts (Names & Numbers)');
            console.log('  c              - Clear screen');
            console.log('  q              - Quit daemon\n');
        }
    });

    sock.ev.on('messages.upsert', async m => {
        if(m.type === 'notify') {
            for (const msg of m.messages) {
                if (!msg.key.fromMe && msg.message) {
                    lastSenderJid = msg.key.remoteJid; 
                    lastSenderName = lastSenderJid.split('@')[0];
                    
                    // Ottiene il nome pubblico impostato dall'utente su WhatsApp
                    const pushName = msg.pushName || "Sconosciuto";
                    
                    // Salva in rubrica temporanea
                    recentContacts.set(lastSenderName, pushName);
                    
                    const text = msg.message.conversation || 
                                 msg.message.extendedTextMessage?.text || 
                                 "[Attachment]";
                                 
                    const displayName = `${pushName} (${lastSenderName})`;
                    messageHistory.push(`[${displayName}]: ${text}`);
                    if(messageHistory.length > MAX_HISTORY) messageHistory.shift();

                    console.log(`[RCV] ${displayName}: ${text}`);
                }
            }
        }
    });

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.on('line', async (line) => {
        line = line.trim();
        if (!line) return;

        const cmd = line.substring(0, 1).toLowerCase();
        const arg = line.substring(2).trim();

        try {
            if (cmd === 'r') {
                if (!lastSenderJid) {
                    console.log("System error: missing target.");
                    return;
                }
                await sock.sendPresenceUpdate('unavailable', lastSenderJid); 
                await sock.sendMessage(lastSenderJid, { text: arg });
                console.log(`[SND] OK -> ${recentContacts.get(lastSenderName) || lastSenderName}`);
            } 
            else if (cmd === 'n') {
                const match = line.match(/^n\s+([0-9]+)[\s,]+(.+)$/i);
                if (match) {
                    let num = match[1];
                    // Se l'utente dimentica il 39, lo avvisa o lo aggiunge. Per sicurezza gli diciamo di scriverlo per intero.
                    if (num.length <= 10) {
                        console.log("[WARN] You might have forgotten the country code (e.g., 39). Sending anyway...");
                    }
                    const text = match[2];
                    const jid = num.includes('@') ? num : num + '@s.whatsapp.net';
                    
                    await sock.sendPresenceUpdate('unavailable', jid);
                    await sock.sendMessage(jid, { text: text });
                    console.log(`[SND] OK -> ${num}`);
                } else {
                    console.log("Syntax error. Use: n <country_code+number> <text>");
                }
            }
            else if (cmd === 'l') {
                console.log("\n--- Recent Contacts ---");
                if (recentContacts.size === 0) console.log("Empty.");
                for (let [num, name] of recentContacts.entries()) {
                    console.log(`- ${name} (Num: ${num})`);
                }
                console.log("-----------------------\n");
            }
            else if (cmd === 'v') {
                if (!lastSenderJid) {
                    console.log("System error: missing target.");
                    return;
                }
                await sock.readMessages([{ remoteJid: lastSenderJid, id: 'status', participant: undefined }]);
                console.log(`[STATUS] Marked as read for ${recentContacts.get(lastSenderName) || lastSenderName}`);
            }
            else if (cmd === 'h') {
                console.log("\n--- Recent History ---");
                if (messageHistory.length === 0) console.log("Empty.");
                messageHistory.forEach(m => console.log(m));
                console.log("----------------------\n");
            }
            else if (cmd === 'c') {
                console.clear();
            }
            else if (cmd === 'q') {
                console.log("Shutting down daemon...");
                process.exit(0);
            }
            else {
                console.log("Unknown command.");
            }
        } catch (err) {
            console.error(`[ERR] Operation failed.`);
        }
    });
}

startService();
