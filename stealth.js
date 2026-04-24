const { default: makeWASocket, useMultiFileAuthState, fetchLatestWaWebVersion } = require('baileys');
const pino = require('pino');
const os = require('os');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

let lastSenderJid = null;
const messageHistory = []; 
const recentContacts = new Map(); // Solo i contatti di questa sessione

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
let sock = null; // Manteniamo il socket globale

// Inizializza l'interfaccia a riga di comando UNA SOLA VOLTA
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.on('line', async (line) => {
    line = line.trim();
    if (!line) return;
    if (!sock) {
        console.log("System error: Daemon not ready yet.");
        return;
    }

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
            const name = allContacts.get(lastSenderJid) || lastSenderJid.split('@')[0];
            console.log(`[SND] OK -> ${name}`);
        } 
        else if (cmd === 'n') {
            const match = line.match(/^n\s+([^\s]+)\s+(.+)$/i);
            if (match) {
                const target = match[1];
                const text = match[2];
                let finalJid = null;
                let foundName = null;

                const targetLower = target.toLowerCase();
                for (let [contactJid, contactName] of recentContacts.entries()) {
                    if (contactName.toLowerCase().includes(targetLower)) {
                        finalJid = contactJid;
                        foundName = contactName;
                        break;
                    }
                }

                if (!finalJid) {
                    console.log(`System error: Contact '${target}' not found in RECENT chats. Use 'w' to search the full address book.`);
                    return;
                }

                await sock.sendPresenceUpdate('unavailable', finalJid);
                await sock.sendMessage(finalJid, { text: text });
                console.log(`[SND] OK -> ${foundName || finalJid.split('@')[0]}`);
            } else {
                console.log("Syntax error. Use: n <name> <text>");
            }
        }
        else if (cmd === 'w') {
            const match = line.match(/^w\s+([^\s]+)\s+(.+)$/i);
            if (match) {
                const target = match[1];
                const text = match[2];
                let finalJid = null;
                let foundName = null;

                if (/^\d+$/.test(target)) {
                    if (target.length <= 10) {
                        console.log("[WARN] You might have forgotten the country code (e.g., 39). Sending anyway...");
                    }
                    finalJid = target.includes('@') ? target : target + '@s.whatsapp.net';
                } else {
                    const targetLower = target.toLowerCase();
                    for (let [contactJid, contactName] of allContacts.entries()) {
                        if (contactName.toLowerCase().includes(targetLower)) {
                            finalJid = contactJid;
                            foundName = contactName;
                            break;
                        }
                    }

                    if (!finalJid) {
                        console.log(`System error: Name '${target}' not found in address book.`);
                        return;
                    }
                }

                await sock.sendPresenceUpdate('unavailable', finalJid);
                await sock.sendMessage(finalJid, { text: text });
                console.log(`[SND] OK -> ${foundName || finalJid.split('@')[0]} (New Message)`);
            } else {
                console.log("Syntax error. Use: w <name_or_number> <text>");
            }
        }
        else if (cmd === 'l') {
            console.log("\n--- Known Contacts ---");
            if (allContacts.size === 0) console.log("Empty. Contacts will be added as they message you.");
            for (let [jid, name] of allContacts.entries()) {
                console.log(`- ${name} (Num: ${jid.split('@')[0]})`);
            }
            console.log("----------------------\n");
        }
        else if (cmd === 'v') {
            if (!lastSenderJid) {
                console.log("System error: missing target.");
                return;
            }
            await sock.readMessages([{ remoteJid: lastSenderJid, id: 'status', participant: undefined }]);
            const name = allContacts.get(lastSenderJid) || lastSenderJid.split('@')[0];
            console.log(`[STATUS] Marked as read for ${name}`);
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

async function startService() {
    console.log("Starting node-daemon-sync...");
    
    const { state, saveCreds } = await useMultiFileAuthState(cacheFolder);
    const { version } = await fetchLatestWaWebVersion({});

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }), 
        auth: state,
        markOnlineOnConnect: false, 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('contacts.upsert', (contacts) => {
        let changed = false;
        for (const contact of contacts) {
            const jid = contact.id;
            const name = contact.name || contact.notify || contact.verifiedName;
            if (name) {
                allContacts.set(jid, name);
                changed = true;
            }
        }
        if (changed) saveContacts();
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if(connection === 'close') {
            console.log('Daemon disconnected. Reason:', lastDisconnect?.error?.message || 'Unknown');
            console.log('Per evitare conflitti crittografici, il demone si chiude. Riavvia con: node stealth.js');
            process.exit(1);
        } else if(connection === 'open') {
            console.log('Service connection established. [Status: OK]\n');
            console.log('Available commands:');
            console.log('  r <text>          - Reply to last');
            console.log('  n <name> <text>   - Send to a RECENT contact (e.g. n cla hi)');
            console.log('  w <num> <text>    - Send to ANY contact/number (e.g. w cla hi)');
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
                    
                    const pushName = msg.pushName || allContacts.get(lastSenderJid) || "Sconosciuto";
                    
                    if (pushName !== "Sconosciuto") {
                        allContacts.set(lastSenderJid, pushName);
                        recentContacts.set(lastSenderJid, pushName);
                        saveContacts();
                    }
                    
                    const text = msg.message.conversation || 
                                 msg.message.extendedTextMessage?.text || 
                                 "[Attachment]";
                                 
                    const displayName = `${pushName} (${lastSenderJid.split('@')[0]})`;
                    messageHistory.push(`[${displayName}]: ${text}`);
                    if(messageHistory.length > MAX_HISTORY) messageHistory.shift();

                    console.log(`[RCV] ${displayName}: ${text}`);
                }
            }
        }
    });
}

startService();
