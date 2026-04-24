# WhatsApp Stealth CLI 🥷

Una Command Line Interface per usare WhatsApp in modalità completamente invisibile ("Stealth Mode"). 
Basato sulla libreria *Baileys* e sul wrapper *Mudslide*, questo strumento ti permette di chattare dal terminale passando inosservato.

## ✨ Funzionalità
- **Completamente Invisibile**: Non mostra mai il tuo stato "Online".
- **Nessuna Spunta Blu**: Leggi i messaggi senza inviare la notifica di lettura.
- **Nessun "Sta scrivendo..."**: Scrivi e rispondi senza che l'interlocutore se ne accorga.
- **Interfaccia Camuffata**: Output da terminale mascherato da demone di sistema (`node-daemon-sync`).

## ⚠️ Prerequisiti
È **strettamente necessaria** l'installazione di **Node.js in versione 24** (o superiore). Le versioni più vecchie causeranno disconnessioni costanti (errore *"Restart required"*).
Se usi Ubuntu, puoi installarlo così:
```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs
```

## ⚙️ Installazione e Configurazione

**1. Scarica la repository:**
```bash
git clone <URL_DELLA_TUA_REPO>
cd <NOME_DELLA_REPO>
```

**2. Installa le dipendenze e compila:**
```bash
npm install
npm run build
```

**3. Autenticazione (Primo Avvio):**
Collega il tuo account WhatsApp effettuando la scansione del QR code:
```bash
npm run start -- login
```
*(Apri WhatsApp sul telefono -> Impostazioni -> Dispositivi collegati -> Collega dispositivo e inquadra il QR code sul terminale).*

## 🚀 Utilizzo: Modalità Stealth

Una volta effettuato il login, per chattare in incognito avvia:
```bash
node stealth.js
```

Il programma rimarrà in ascolto e ti mostrerà i messaggi in tempo reale.

### Comandi Rapidi
Digita il comando e premi `Invio`:

*   **`r [messaggio]`** — **Rispondi** all'ultimo contatto che ti ha scritto.
    *(Esempio: `r sto arrivando!`)*
*   **`n [numero] [messaggio]`** — **Nuova chat** verso un numero. **Importante**: Inserisci sempre il prefisso internazionale!
    *(Esempio: `n 393331234567 ciao, sono io`)*
*   **`l`** — Mostra la **Rubrica** temporanea (Nomi e Numeri) di chi ti ha contattato nell'attuale sessione.
*   **`h`** — Mostra la **Cronologia** degli ultimi 10 messaggi ricevuti.
*   **`v`** — Segna le chat dell'ultimo utente come **Viste** (invia intenzionalmente le spunte blu).
*   **`c`** — **Pulisce** il terminale (Clear Screen) per nascondere tutto al volo.
*   **`q`** — **Chiude** il demone.

## Contributi e Avvertenze
Questo progetto è a scopo educativo. L'abuso di API non ufficiali può portare al ban del proprio account WhatsApp. Usa questo tool a tuo rischio e pericolo.
