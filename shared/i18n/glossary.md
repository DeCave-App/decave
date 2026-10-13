# DeCave translation glossary

Translators (people and models) follow this file for every catalog in
`shared/i18n/locales/`. The machine-readable lists live in `glossary.json`:
`keepEnglish` (words that are never translated) and `sameAsEnglish` (full keys,
per locale, whose translation is allowed to equal the English text).

## Kept in English

DeCave, Hub, Hubs, PUG, PUGs, Squad, Squads, ClearVoice, FACEIT, Steam, Twitch, Discord,
Epic Games, OK, emote names, game titles, and the skin names (Nebula Pulse,
Arctic Flux, Crimson Glass, Royal Violet, Pearl Glass, Obsidian Glass, Verdant
Raid, Bright Grey, Neon Lounge). "Push to talk" stays in English
only where gamers in that language normally say it (see the table).

Brand names (and Squad) are never inflected or abbreviated. In languages with cases
(Greek, Polish, Ukrainian, German) build the sentence so "Hub" can stay in its
base form, for example "в Hub" rather than a declined form. The same goes for
"Squad": the feature and the group it finds are called Squad in every language
(Find a Squad, Squad Finder, squad rooms, squad invites).

## Core terms

| English      | el                 | es                 | pt-BR             | fr                                                    | nl               | de                                      | it                                                              | pl                   | uk                  |
| ------------ | ------------------ | ------------------ | ----------------- | ----------------------------------------------------- | ---------------- | --------------------------------------- | --------------------------------------------------------------- | -------------------- | ------------------- |
| room         | δωμάτιο            | sala               | sala              | salon                                                 | kanaal           | Raum                                    | stanza                                                          | pokój                | кімната             |
| forum        | φόρουμ             | foro               | fórum             | forum                                                 | forum            | Forum                                   | forum                                                           | forum                | форум               |
| event        | εκδήλωση           | evento             | evento            | événement                                             | evenement        | Event                                   | evento                                                          | wydarzenie           | подія               |
| mention      | αναφορά            | mención            | menção            | mention                                               | vermelding       | Erwähnung                               | menzione                                                        | wzmianka             | згадування          |
| push to talk | Push-to-Talk       | pulsar para hablar | aperte para falar | appuyer pour parler                                   | push to talk     | Push-to-Talk                            | push-to-talk                                                    | Naciśnij i mów       | Активація кнопкою   |
| voice (chat) | φωνή               | voz                | voz               | voix                                                  | spraak           | Voice                                   | voce                                                            | głos                 | голос               |
| voice room   | φωνητικό δωμάτιο   | sala de voz        | sala de voz       | salon vocal                                           | spraakkanaal     | Sprachraum                              | stanza vocale                                                   | pokój głosowy        | голосова кімната    |
| screen share | κοινή χρήση οθόνης | compartir pantalla | compartilhar tela | partage d'écran                                       | scherm delen     | Bildschirm teilen                       | condivisione schermo                                            | udostępnianie ekranu | демонстрація екрана |
| mute         | σίγαση             | silenciar          | silenciar         | couper le micro (own mic); rendre muet (others, Hubs) | dempen           | stummschalten                           | disattiva microfono (own mic); silenzia (others, notifications) | wycisz               | вимкнути мікрофон   |
| deafen       | κώφωση             | ensordecer         | desativar áudio   | mettre en sourdine                                    | onhoorbaar maken | Ein- und Ausgabe deaktivieren (Ton aus) | disattiva audio                                                 | wyłącz dźwięk        | вимкнути звук       |

"Voice" on its own (voice chat, the Voice & video settings tab, Voice & audio)
is never "Sprache" in German: Sprache means language ("Sprache & Region"). German
keeps "Voice" there and uses "Sprach-" only in compounds such as Sprachraum.

The Greek column was confirmed in the owner's review. Every column (both tables)
was then checked against the Discord and Steam clients in that language, and the
catalogs follow the terms shown here. Any later change is made here first so
every namespace stays consistent.

## More terms

Chosen during the full translation pass and used in every shipped catalog.
Where a language keeps the English word, that is deliberate (gamers there use it).

| English              | el                                          | es                           | pt-BR                         | fr                      | nl                     | de                                      | it                            | pl                      | uk                     |
| -------------------- | ------------------------------------------- | ---------------------------- | ----------------------------- | ----------------------- | ---------------------- | --------------------------------------- | ----------------------------- | ----------------------- | ---------------------- |
| owner                | ιδιοκτήτης                                  | propietario                  | dono                          | propriétaire            | eigenaar               | Eigentümer                              | proprietario                  | właściciel              | власник                |
| admin                | διαχειριστής                                | admin                        | admin                         | admin                   | beheerder              | Admin                                   | admin                         | admin                   | адміністратор          |
| moderator            | συντονιστής                                 | moderador                    | moderador                     | modérateur              | moderator              | Moderator                               | moderatore                    | moderator               | модератор              |
| role                 | ρόλος                                       | rol                          | cargo                         | rôle                    | rol                    | Rolle                                   | ruolo                         | rola                    | роль                   |
| member               | μέλος                                       | miembro                      | membro                        | membre                  | lid                    | Mitglied                                | membro                        | członek                 | учасник                |
| settings             | Ρυθμίσεις                                   | Ajustes                      | Configurações                 | Paramètres              | Instellingen           | Einstellungen                           | Impostazioni                  | Ustawienia              | Налаштування           |
| sign in              | σύνδεση                                     | iniciar sesión               | entrar                        | se connecter            | inloggen               | anmelden                                | accedi                        | zaloguj się             | увійти                 |
| session              | συνεδρία                                    | sesión                       | sessão                        | session                 | sessie                 | Sitzung (Session for streamer sessions) | sessione                      | sesja                   | сеанс                  |
| DM                   | άμεσο μήνυμα (DM only where space is tight) | MD                           | DM                            | MP                      | DM                     | DM                                      | DM                            | prywatna wiadomość (PW) | приватне повідомлення  |
| Find a Squad         | Βρες Squad                                  | Buscar Squad                 | Encontrar um Squad            | Trouver un Squad        | Find a Squad           | Find a Squad                            | Trova uno Squad               | Find a Squad            | Знайди Squad           |
| Squad Finder         | Αναζήτηση Squad                             | Squad Finder                 | Squad Finder                  | Recherche de Squad      | Squad Finder           | Squad Finder                            | Ricerca Squad                 | Squad Finder            | Пошук Squad            |
| Streamer Mode        | λειτουργία streamer                         | modo streamer                | Modo Streamer                 | Mode Streamer           | Streamermodus          | Streamer-Modus                          | modalità streamer             | tryb streamera          | режим стримера         |
| Overview             | Επισκόπηση                                  | Resumen                      | Visão geral                   | Vue d'ensemble          | Overzicht              | Übersicht                               | Panoramica                    | Przegląd                | Огляд                  |
| Discover             | Ανακάλυψη                                   | Descubrir                    | Descobrir                     | Découvrir               | Ontdekken              | Entdecken                               | Scopri                        | Odkrywaj                | каталог                |
| Trust & Safety       | Trust & Safety                              | Confianza y seguridad        | Confiança e Segurança         | Trust & Safety          | Trust & Safety         | Trust & Safety                          | Trust & Safety                | Trust & Safety          | Trust & Safety         |
| report               | αναφορά                                     | reportar                     | denúncia / denunciar          | signalement / signaler  | rapport / rapporteren  | Meldung / melden                        | segnalazione / segnala        | zgłoszenie / zgłoś      | скарга / поскаржитися  |
| block                | αποκλεισμός                                 | bloquear                     | bloquear                      | bloquer                 | blokkeren              | blockieren                              | blocca                        | zablokuj                | заблокувати            |
| kick                 | εκδίωξη                                     | expulsar                     | expulsar                      | expulser                | kicken                 | kicken                                  | espelli                       | wyrzuć                  | вигнати                |
| ban                  | ban                                         | banear                       | banir                         | bannir                  | verbannen              | bannen                                  | banna                         | zbanuj                  | забанити               |
| timeout              | διάλειμμα                                   | aislar temporalmente         | castigo                       | exclure temporairement  | time-out geven         | Timeout                                 | timeout                       | przerwa                 | тимчасовий блок        |
| slow mode            | αργή λειτουργία                             | modo lento                   | modo lento                    | mode lent               | slow-modus             | Slow-Modus                              | modalità lenta                | tryb powolny            | повільний режим        |
| unmute               | κατάργηση σίγασης                           | activar micro                | ativar microfone              | réactiver le micro      | dempen opheffen        | Stummschaltung aufheben (Mikro an)      | riattiva microfono / riattiva | włącz mikrofon          | увімкнути мікрофон     |
| undeafen             | κατάργηση κώφωσης                           | activar audio                | ativar áudio                  | réactiver le son        | onhoorbaar opheffen    | Ein- und Ausgabe aktivieren (Ton an)    | riattiva audio                | włącz dźwięk            | увімкнути звук         |
| pin / unpin          | καρφίτσωμα / ξεκαρφίτσωμα                   | fijar / dejar de fijar       | fixar / desafixar             | épingler / désépingler  | vastpinnen / losmaken  | anpinnen / loslösen                     | fissa / rimuovi dai fissati   | przypnij / odepnij      | закріпити / відкріпити |
| thread               | νήμα                                        | hilo                         | tópico                        | fil                     | thread                 | Thread                                  | thread                        | wątek                   | гілка                  |
| poll                 | ψηφοφορία                                   | encuesta                     | enquete                       | sondage                 | peiling                | Umfrage                                 | sondaggio                     | ankieta                 | опитування             |
| invite               | πρόσκληση                                   | invitar                      | convidar                      | inviter                 | uitnodigen             | einladen                                | invita                        | zaproś                  | запросити              |
| recovery code        | κωδικός ανάκτησης                           | código de recuperación       | código de recuperação         | code de récupération    | herstelcode            | Wiederherstellungscode                  | codice di recupero            | kod odzyskiwania        | код відновлення        |
| end-to-end encrypted | κρυπτογράφηση από άκρο σε άκρο              | cifrado de extremo a extremo | criptografia de ponta a ponta | chiffré de bout en bout | end-to-end versleuteld | Ende-zu-Ende-verschlüsselt              | crittografato end-to-end      | szyfrowane end-to-end   | наскрізне шифрування   |
| soundboard           | Soundboard                                  | panel de sonidos             | soundboard                    | soundboard              | soundboard             | Soundboard                              | soundboard                    | Panel dźwięków          | звукова панель         |
| giveaway             | giveaway                                    | sorteo                       | sorteio                       | giveaway                | giveaway               | Giveaway                                | giveaway                      | giveaway                | розіграш               |
| leaderboard          | πίνακας κατάταξης (tab: Κατάταξη)           | clasificación                | ranking                       | classement              | ranglijst              | Bestenliste                             | classifica                    | ranking                 | таблиця лідерів        |
| Retry                | Δοκίμασε ξανά                               | Reintentar                   | Tentar novamente              | Réessayer               | Opnieuw proberen       | Erneut versuchen                        | Riprova                       | Spróbuj ponownie        | Спробувати ще раз      |

Keys whose translation is allowed to equal the English text (brands, loanwords
such as "Online" or "Chat", symbols, URLs and placeholders) are listed per
locale in `glossary.json` under `sameAsEnglish`. Add a key there only when the
English text is genuinely the right word in that language.

## Tone

- Informal second person everywhere: du (de), tu (fr, it), tú (es), você
  (pt-BR), je (nl), ty (pl), ти (uk), εσύ (el).
- Short, gamer-friendly UI language. Say what the button does; no filler.
- Sentence case where the language allows it (German nouns keep their capital).
- Button and tab labels may be at most about 30 % longer than English; if a
  translation is longer, find a shorter phrasing. Check layouts in the
  pseudo-locale `en-XA`, which pads every string by 35 %.
- Keep `{{placeholders}}` and `<0>…</0>` tags exactly as in English; only move
  them within the sentence.
- Plurals: provide every form `Intl.PluralRules` lists for the language
  (`_one`, `_few`, `_many`, `_other` …).
- Never translate anything users write (messages, Hub and room names, posts).
