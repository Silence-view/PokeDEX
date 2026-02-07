// =============================================================================
// AVVISI DI SICUREZZA - Messaggi anti-phishing e best practice per crypto
// SECURITY NOTICES - Anti-phishing messages and crypto best practices
//
// Questo file contiene i messaggi di sicurezza mostrati agli utenti del bot.
// La sicurezza e' CRITICA per un bot che interagisce con criptovalute e NFT
// perche' i truffatori prendono di mira attivamente gli utenti di bot crypto.
//
// This file contains security messages shown to the bot's users.
// Security is CRITICAL for a bot that interacts with cryptocurrency and NFTs
// because scammers actively target users of crypto bots.
//
// Perche' questi avvisi sono importanti / Why these notices are important:
//
// 1. PHISHING: I truffatori creano bot falsi con nomi simili e chiedono
//    seed phrase o chiavi private. Gli utenti meno esperti possono cascarci.
//    Scammers create fake bots with similar names and ask for seed phrases
//    or private keys. Less experienced users may fall for it.
//
// 2. SOCIAL ENGINEERING: Finti "supporto" inviano DM agli utenti fingendo
//    di essere il team ufficiale. Il bot avvisa che il supporto ufficiale
//    non invia MAI messaggi privati per primo.
//    Fake "support" sends DMs to users pretending to be the official team.
//    The bot warns that official support NEVER sends private messages first.
//
// 3. TRANSAZIONI SOSPETTE: Gli utenti devono SEMPRE verificare i contratti
//    su Etherscan prima di firmare transazioni. Un contratto malevolo puo'
//    svuotare l'intero wallet con una singola firma.
//    Users must ALWAYS verify contracts on Etherscan before signing
//    transactions. A malicious contract can drain the entire wallet
//    with a single signature.
//
// 4. CUSTODIA: Questo bot usa wallet custodial (il bot gestisce le chiavi),
//    ma non chiede MAI chiavi esterne. L'utente puo' esportare le proprie
//    chiavi in qualsiasi momento.
//    This bot uses custodial wallets (the bot manages keys), but NEVER
//    asks for external keys. Users can export their own keys at any time.
// =============================================================================

// =============================================================================
// AVVISO SICUREZZA PRINCIPALE - Mostrato tramite il pulsante "Security" del menu
// MAIN SECURITY NOTICE - Shown via the "Security" button in the menu
//
// Questo messaggio e' il punto di riferimento principale per la sicurezza.
// Elenca chiaramente cosa il bot NON chiede mai e come funzionano le
// transazioni, in modo che l'utente possa riconoscere tentativi di scam.
//
// This message is the main reference point for security. It clearly lists
// what the bot NEVER asks for and how transactions work, so the user
// can recognize scam attempts.
// =============================================================================

export const SECURITY_NOTICE = `
🔒 *SECURITY - READ CAREFULLY*

This bot *NEVER* asks for:
• Your private key
• Your seed phrase (12/24 words)
• Access to your wallet

*How transactions work:*
1. The bot provides an Etherscan link
2. Connect YOUR wallet (MetaMask)
3. Sign the transaction from YOUR device

⚠️ *BEWARE OF SCAMMERS:*
• Don't reply to DMs from "support"
• Official support will never DM you first
• Always verify the bot username: @${process.env.BOT_USERNAME || "pokedex_nft_bot"}

🛡️ This bot is open source and verified.
`;

// =============================================================================
// AVVISO ANTI-PHISHING - Mostrato prima di interazioni con smart contract
// ANTI-PHISHING WARNING - Shown before smart contract interactions
//
// Questo avviso piu' specifico viene mostrato quando l'utente sta per
// interagire con uno smart contract (ad esempio, acquistare una carta
// dal marketplace). Ricorda i passaggi fondamentali di verifica.
//
// This more specific warning is shown when the user is about to interact
// with a smart contract (e.g., buying a card from the marketplace).
// It reminds users of the fundamental verification steps.
//
// I 4 passaggi di verifica / The 4 verification steps:
// 1. Verificare l'indirizzo del contratto su Etherscan
//    Verify the contract address on Etherscan
// 2. Controllare che sia il contratto verificato (codice sorgente visibile)
//    Check that it's the verified contract (source code visible)
// 3. Non firmare transazioni sospette o non richieste
//    Don't sign suspicious or unsolicited transactions
// 4. In caso di dubbio, chiedere nel gruppo ufficiale
//    If in doubt, ask in the official group
// =============================================================================

export const ANTI_PHISHING_WARNING = `
⚠️ *ANTI-PHISHING WARNING*

Before interacting with any contract:
1. Verify the address on Etherscan
2. Check that it's the verified contract
3. Don't sign suspicious transactions
4. If in doubt, ask in the official group
`;
