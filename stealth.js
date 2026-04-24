const { default: makeWASocket, useMultiFileAuthState, fetchLatestWaWebVersion } = require('baileys');
const pino = require('pino');
const os = require('os');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

let lastSenderJid = null;
let lastSenderName = null;
const messageHistory = []; 

// Cartella cache
const cacheFolder = path.join(os.homedir(), '.local', 'share', 'mudslide');
const contactsFile = path.join(cacheFolder, 'stealth_contacts.json');

// Mappa globale dei contatti salvata su file per resistere ai riavvii
let allContacts = new Map();

// Carica i contatti dal file
if (fs.existsSync(contactsFile)) {
    try {
        const data = JSON.parse(fs.readFileSync(contactsFile, 'utf8'));
        allContacts = new Map(Object.entries(data));
    } catch (e) {
        console.error("Errore nel caricamento della rubrica:", e.message);
    }
}

function saveContacts() {
    try {
        const obj = Object.fromEntries(allContacts);
        fs.writeFileSync(contactsFile, JSON.stringify(obj, null, 2));
    } catch (e) {}
}

const MAX_HISTORY = 10;

async function startService() {
    console.log("Starting node-daemon-sync...");
    
    const { state, saveCreds } = await useMultiFileAuthState(cacheFolder);
    const { version } = await fetchLatestWaWebVersion({});

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }), 
        auth: state,
        markOnlineOnConnect: false, 
    });

    sock.ev.on('creds.update', saveCreds);

    // Salva in memoria TUTTI i contatti quando WhatsApp li sincronizza all'avvio
    sock.ev.on('contacts.upsert', (contacts) => {
        let changed = false;
        for (const contact of contacts) {
            const num = contact.id.split('@')[0];
            const name = contact.name || contact.notify || contact.verifiedName;
            if (name) {
                allContacts.set(num, name);
                changed = true;
            }
        }
        if (changed) saveContacts();
    });

    sock.ev.on('connection.update', (update) => {
        const { connection } = update;
        if(connection === 'close') {
            console.log('Daemon disconnected. Reconnecting...');
            startService();
        } else if(connection === 'open') {
            console.log('Service connection established. [Status: OK]\n');
            console.log('Available commands:');
            console.log('  r <text>          - Reply to last');
            console.log('  n <name> <text>   - Send to a known contact (e.g. n cla hi)');
            console.log('  w <num> <text>    - Send to a NEW number (e.g. w 39333... hi)');
            console.log('  v                 - Mark last chat as read (send blue ticks)');
            console.log('  h                 - Show recent history');
            console.log('  l                 - List known contacts');
            console.log('  c                 - Clear screen');
            console.log('  q                 - Quit daemon\n');
        }
    });

    sock.ev.on('messages.upsert', async m => {
        if(m.type === 'notify') {
            for (const msg of m.messages) {
                if (!msg.key.fromMe && msg.message) {
                    lastSenderJid = msg.key.remoteJid; 
                    lastSenderName = lastSenderJid.split('@')[0];
                    
                    const pushName = msg.pushName || allContacts.get(lastSenderName) || "Sconosciuto";
                    
                    if (pushName !== "Sconosciuto") {
                        allContacts.set(lastSenderName, pushName);
                        saveContacts();
                    }
                    
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
                console.log(`[SND] OK -> ${allContacts.get(lastSenderName) || lastSenderName}`);
            } 
            else if (cmd === 'n') {
                const match = line.match(/^n\s+([^\s]+)\s+(.+)$/i);
                if (match) {
                    const target = match[1];
                    const text = match[2];
                    let num = null;
                    let foundName = null;

                    const targetLower = target.toLowerCase();
                    for (let [contactNum, contactName] of allContacts.entries()) {
                        if (contactName.toLowerCase().includes(targetLower)) {
                            num = contactNum;
                            foundName = contactName;
                            break;
                        }
                    }

                    if (!num) {
                        console.log(`System error: Contact '${target}' not found. If it's a new number, use the 'w' command instead.`);
                        return;
                    }

                    const jid = num.includes('@') ? num : num + '@s.whatsapp.net';
                    
                    await sock.sendPresenceUpdate('unavailable', jid);
                    await sock.sendMessage(jid, { text: text });
                    console.log(`[SND] OK -> ${foundName || num}`);
                } else {
                    console.log("Syntax error. Use: n <name> <text>");
                }
            }
            else if (cmd === 'w') {
                const match = line.match(/^w\s+([0-9]+)[\s,]+(.+)$/i);
                if (match) {
                    const num = match[1];
                    const text = match[2];
                    if (num.length <= 10) {
                        console.log("[WARN] You might have forgotten the country code (e.g., 39). Sending anyway...");
                    }
                    const jid = num.includes('@') ? num : num + '@s.whatsapp.net';
                    
                    await sock.sendPresenceUpdate('unavailable', jid);
                    await sock.sendMessage(jid, { text: text });
                    console.log(`[SND] OK -> ${num} (New Number)`);
                } else {
                    console.log("Syntax error. Use: w <number> <text>");
                }
            }
            else if (cmd === 'l') {
                console.log("\n--- Known Contacts ---");
                if (allContacts.size === 0) console.log("Empty. Contacts will be added as they message you.");
                for (let [num, name] of allContacts.entries()) {
                    console.log(`- ${name} (Num: ${num})`);
                }
                console.log("----------------------\n");
            }
            else if (cmd === 'v') {
                if (!lastSenderJid) {
                    console.log("System error: missing target.");
                    return;
                }
                await sock.readMessages([{ remoteJid: lastSenderJid, id: 'status', participant: undefined }]);
                console.log(`[STATUS] Marked as read for ${allContacts.get(lastSenderName) || lastSenderName}`);
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
