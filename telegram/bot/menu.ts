import { InlineKeyboard } from "grammy";
import { getRotatingTip } from "../services/promo.js";

// =============================================================================
// MENU PRINCIPALE - Tastiera inline del bot (senza Pack/Battle)
// MAIN MENU - Bot inline keyboard (without Pack/Battle)
//
// Questo file definisce la tastiera principale del bot PokeDEX.
// In Telegram, le "inline keyboard" sono pulsanti che appaiono sotto un
// messaggio. Ogni pulsante ha un testo visibile e un callback_data
// (stringa identificativa) che viene inviato al bot quando premuto.
//
// This file defines the PokeDEX bot's main keyboard.
// In Telegram, "inline keyboards" are buttons that appear below a
// message. Each button has visible text and callback_data
// (identifying string) that is sent to the bot when pressed.
//
// Layout attuale (4 righe) / Current layout (4 rows):
// Riga 1 / Row 1: [My Cards] [Create Card]  - Gestione carte / Card management
// Riga 2 / Row 2: [Marketplace] [Wallet]     - Commercio e finanze / Trading & finance
// Riga 3 / Row 3: [Contracts] [Security]     - Info tecniche e sicurezza / Tech info & security
// Riga 4 / Row 4: [Help] [Share]              - Supporto e condivisione / Support & sharing
//
// Funzionalita' rimosse (disabilitate per ora):
// Features removed (disabled for now):
// - "Buy Packs": Apertura pacchetti carte (richiede VRF Chainlink)
//                Card pack opening (requires Chainlink VRF)
// - "Battle Arena": Sistema di combattimento PvP
//                   PvP battle system
// - "Leaderboard": Classifica giocatori
//                   Player rankings
// =============================================================================

/**
 * Restituisce la tastiera inline del menu principale del bot.
 * Returns the bot's main menu inline keyboard.
 *
 * Ogni pulsante corrisponde a una funzionalita' del bot:
 * Each button corresponds to a bot feature:
 *
 * - "My Cards" (action_my_cards): Mostra le carte NFT possedute dall'utente.
 *   Shows the NFT cards owned by the user.
 *   Legge i token dal contratto PokeDEXCustomCards on-chain.
 *   Reads tokens from the PokeDEXCustomCards contract on-chain.
 *
 * - "Create Card" (action_create_card): Avvia il flusso di creazione carta.
 *   Starts the card creation flow.
 *   Entra nella conversazione cardCreationConversation.
 *   Enters the cardCreationConversation conversation.
 *
 * - "Marketplace" (action_marketplace): Apre il marketplace per comprare/vendere.
 *   Opens the marketplace to buy/sell.
 *   Mostra le carte in vendita dal contratto PokeDEXMarketplace.
 *   Shows cards for sale from the PokeDEXMarketplace contract.
 *
 * - "Wallet" (action_wallet): Gestione wallet custodial dell'utente.
 *   User's custodial wallet management.
 *   Mostra saldo, indirizzo, opzioni di export della chiave privata.
 *   Shows balance, address, private key export options.
 *
 * - "Contracts" (action_contracts): Mostra gli indirizzi dei contratti deployati.
 *   Shows the deployed contract addresses.
 *   Link diretti a Etherscan per trasparenza e verifica.
 *   Direct Etherscan links for transparency and verification.
 *
 * - "Security" (action_security): Mostra avvisi di sicurezza anti-phishing.
 *   Shows anti-phishing security notices.
 *   Importante per bot crypto: protegge gli utenti da scam.
 *   Important for crypto bots: protects users from scams.
 *
 * - "Help" (action_help): Mostra la guida all'uso del bot.
 *   Shows the bot usage guide.
 *
 * - "Share" (action_share): Mostra messaggio promozionale con link condivisibile.
 *   Shows promotional message with shareable link.
 *   Invia GIF Pokemon e link di invito personalizzato.
 *   Sends Pokemon GIF and personalized invite link.
 *
 * I pulsanti sono organizzati in righe da 2 usando .row() per separare le righe.
 * Buttons are organized in rows of 2 using .row() to separate rows.
 *
 * @returns InlineKeyboard - La tastiera inline pronta per essere usata con reply_markup.
 *          InlineKeyboard - The inline keyboard ready to be used with reply_markup.
 */
export function getMainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🎴 My Cards", "action_my_cards")
    .text("🎨 Create Card", "action_create_card")
    .row()
    .text("🛒 Marketplace", "action_marketplace")
    .text("👛 Wallet", "action_wallet")
    .row()
    .text("📜 Contracts", "action_contracts")
    .text("🔒 Security", "action_security")
    .row()
    .text("ℹ️ Help", "action_help")
    .text("📤 Share", "action_share");
}

/**
 * Restituisce il messaggio di benvenuto/menu principale del bot.
 * Returns the bot's welcome/main menu message.
 *
 * Usato sia da /start che dal pulsante "Menu" per mostrare sempre
 * la stessa interfaccia ricca con emoji Pokemon e descrizione completa.
 *
 * Used by both /start and the "Menu" button to always show the same
 * rich interface with Pokemon emoji and full description.
 */
export function getWelcomeMessage(firstName?: string): string {
  const greeting = firstName ? `, ${firstName}` : "";

  return (
    `⚡ *PokeDEX NFT* ⚡\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +

    `🎮 Welcome${greeting}!\n` +
    `Gotta Mint 'Em All!\n\n` +

    `🔥💧🌿⚡❄️🐉👻🔮🧚⚙️\n\n` +

    `🎴 *Create* unique Pokemon cards\n` +
    `⚔️ Set custom stats: HP, ATK, DEF, SPD\n` +
    `🛒 *Trade* on the decentralized marketplace\n` +
    `💰 *Earn* royalties on every resale\n` +
    `👛 Built-in wallet, no MetaMask needed\n\n` +

    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 *5 Rarities*\n` +
    `⚪ Common \u2022 🟢 Uncommon \u2022 🔵 Rare\n` +
    `🟣 Ultra Rare \u2022 🟡 Legendary\n\n` +

    `🌍 *18 Pokemon Types*\n` +
    `From Fire 🔥 to Dragon 🐉 to Fairy 🧚\n\n` +

    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `📡 Network: Sepolia Testnet\n` +
    `🔒 We *never* ask for private keys!\n\n` +

    `${getRotatingTip()}\n\n` +

    `👇 *Choose your adventure!* 👇`
  );
}
