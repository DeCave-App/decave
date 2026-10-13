-- Official Hub #rules and #faq translations updated after "Squad" became a
-- kept-English term in every language (see shared/i18n/glossary.md). Same
-- rows and matching as migration 0093, regenerated from the locale catalogs
-- for the posts whose text changed.

-- el
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'el','Κανόνες κοινότητας DeCave','Αυτοί οι κανόνες ισχύουν παντού στο DeCave: Hubs, DM, ομαδικές συνομιλίες, φωνή και Βρες Squad.

1. **Να σέβεσαι τους άλλους.** Όχι παρενόχληση, εκφοβισμός, απειλές ή στοχευμένες προσβολές.
2. **Όχι ρητορική μίσους.** Τίποτα που επιτίθεται σε ανθρώπους λόγω φυλής, εθνοτικής καταγωγής, θρησκείας, φύλου, σεξουαλικού προσανατολισμού, αναπηρίας ή εθνικότητας.
3. **Κράτα τους δημόσιους χώρους κατάλληλους για όλους.** Όχι σεξουαλικό, αιματηρό ή σοκαριστικό περιεχόμενο σε Hubs που δεν το έχουν επιτρέψει. Ποτέ τίποτα που αφορά ανηλίκους.
4. **Προστάτευε την ιδιωτικότητα.** Μη μοιράζεσαι προσωπικά στοιχεία κανενός (πραγματικό όνομα, διεύθυνση, φωτογραφίες, λογαριασμούς) χωρίς τη συγκατάθεσή του.
5. **Όχι cheating, απάτες ή exploits.** Όχι πώληση cheats, εμπόριο λογαριασμών, phishing links, ψεύτικα giveaways ή πλαστοπροσωπία μελών της ομάδας του DeCave.
6. **Όχι spam.** Όχι μαζικά DM, επαναλαμβανόμενα μηνύματα, αζήτητη διαφήμιση ή αυτοπροβολή εκτός χώρων που το επιτρέπουν.
7. **Ακολούθα τους κανόνες κάθε Hub.** Οι ιδιοκτήτες Hub μπορούν να προσθέσουν αυστηρότερους κανόνες για την κοινότητά τους.
8. **Σεβάσου τον νόμο** και τους [Όρους χρήσης](https://de-cave.com/terms).

**Επιβολή:** ανάλογα με τη σοβαρότητα, η παραβίαση αυτών των κανόνων μπορεί να οδηγήσει σε προειδοποίηση, προσωρινούς περιορισμούς, αφαίρεση από Hub ή μόνιμο αποκλεισμό από το DeCave.

**Ανάφερε ένα πρόβλημα:** κάνε δεξί κλικ σε ένα μήνυμα ή προφίλ και επίλεξε **Αναφορά**. Οι αναφορές είναι ιδιωτικές και το άτομο δεν μαθαίνει ποτέ ποιος το ανέφερε.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='rules'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='DeCave Community Rules';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'el','Τι είναι το Βρες Squad;','Διάλεξε παιχνίδι και τι ψάχνεις, και το DeCave σε ταιριάζει με παίκτες που ψάχνουν το ίδιο. Όταν γίνει ταίριασμα, παίρνετε ένα δωμάτιο Squad για chat και φωνή μαζί.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';

-- es
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'es','Normas de la comunidad de DeCave','Estas normas se aplican en todo DeCave: Hubs, MD, chats de grupo, voz y Buscar Squad.

1. **Sé respetuoso.** Nada de acoso, bullying, amenazas ni insultos dirigidos.
2. **Nada de discurso de odio.** Nada que ataque a personas por su raza, etnia, religión, género, orientación sexual, discapacidad o nacionalidad.
3. **Mantén los espacios públicos aptos para todos.** Nada de contenido sexual, gore o impactante en Hubs que no lo hayan permitido expresamente. Nunca nada que involucre a menores.
4. **Protege la privacidad.** No compartas información personal de nadie (nombre real, dirección, fotos, cuentas) sin su consentimiento.
5. **Nada de trampas, estafas ni exploits.** Nada de vender cheats, comerciar con cuentas, enlaces de phishing, sorteos falsos ni hacerse pasar por el equipo de DeCave.
6. **Nada de spam.** Nada de MD masivos, mensajes repetidos, publicidad no solicitada ni autopromoción fuera de los espacios que lo permitan.
7. **Sigue las normas de cada Hub.** Los propietarios de los Hubs pueden añadir normas más estrictas para su comunidad.
8. **Respeta la ley** y los [Términos del servicio](https://de-cave.com/terms).

**Aplicación:** según la gravedad, incumplir estas normas puede conllevar una advertencia, restricciones temporales, la expulsión de un Hub o un baneo permanente de DeCave.

**Reporta un problema:** haz clic derecho en un mensaje o perfil y elige **Reportar**. Los reportes son privados y nunca se le dice a la persona quién la reportó.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='rules'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='DeCave Community Rules';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'es','¿Qué es Buscar Squad?','Elige un juego y lo que buscas, y DeCave te empareja con jugadores que buscan lo mismo. Cuando hay coincidencia, obtienes una sala de Squad para chatear y hablar por voz con ellos.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';

-- pt-BR
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pt-BR','O que é o Encontrar um Squad?','Escolha um jogo e o que você procura, e o DeCave junta você com jogadores procurando a mesma coisa. Quando der match, vocês ganham uma sala de Squad para conversar por texto e voz.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';

-- fr
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'fr','Règles de la communauté DeCave','Ces règles s''appliquent partout sur DeCave : Hubs, MP, discussions de groupe, vocal et Trouver un Squad.

1. **Sois respectueux.** Pas de harcèlement, d''intimidation, de menaces ni d''insultes ciblées.
2. **Pas de discours haineux.** Rien qui attaque des personnes en raison de leur race, origine ethnique, religion, genre, orientation sexuelle, handicap ou nationalité.
3. **Reste correct dans les espaces publics.** Pas de contenu sexuel, gore ou choquant dans les Hubs qui ne l''ont pas autorisé. Jamais rien impliquant des mineurs.
4. **Protège la vie privée.** Ne partage pas les informations personnelles de quelqu''un (vrai nom, adresse, photos, comptes) sans son consentement.
5. **Pas de triche, d''arnaques ni d''exploits.** Pas de vente de cheats, d''échange de comptes, de liens de phishing, de faux concours ni d''usurpation de l''identité de l''équipe DeCave.
6. **Pas de spam.** Pas de MP en masse, de messages répétés, de publicité non sollicitée ni d''autopromo en dehors des espaces qui l''autorisent.
7. **Respecte les règles de chaque Hub.** Les propriétaires de Hub peuvent ajouter des règles plus strictes pour leur communauté.
8. **Respecte la loi** et les [Conditions d''utilisation](https://de-cave.com/terms).

**Sanctions :** selon la gravité, enfreindre ces règles peut entraîner un avertissement, des restrictions temporaires, une exclusion d''un Hub ou un bannissement définitif de DeCave.

**Signaler un problème :** fais un clic droit sur un message ou un profil et choisis **Signaler**. Les signalements sont privés et la personne ne sait jamais qui l''a signalée.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='rules'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='DeCave Community Rules';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'fr','C''est quoi, Trouver un Squad ?','Choisis un jeu et ce que tu cherches, et DeCave te met en relation avec des joueurs qui cherchent la même chose. Quand ça matche, tu obtiens un salon de Squad pour discuter et parler en vocal ensemble.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';

-- nl
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'nl','Wat is Find a Squad?','Kies een game en wat je zoekt, en DeCave koppelt je aan spelers die hetzelfde zoeken. Bij een match krijg je een Squad-kamer om samen te chatten en te voicen.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';

-- it
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'it','Regole della community di DeCave','Queste regole valgono ovunque su DeCave: Hub, DM, chat di gruppo, vocale e Trova uno Squad.

1. **Sii rispettoso.** Niente molestie, bullismo, minacce o insulti mirati.
2. **Niente incitamento all''odio.** Nulla che attacchi le persone per razza, etnia, religione, genere, orientamento sessuale, disabilità o nazionalità.
3. **Negli spazi pubblici niente contenuti inadatti.** Niente contenuti sessuali, cruenti o scioccanti negli Hub che non li hanno esplicitamente permessi. Mai nulla che coinvolga minori.
4. **Proteggi la privacy.** Non condividere informazioni personali di nessuno (nome reale, indirizzo, foto, account) senza il suo consenso.
5. **Niente cheat, truffe o exploit.** Niente vendita di cheat, scambio di account, link di phishing, falsi giveaway o impersonificazione dello staff DeCave.
6. **Niente spam.** Niente DM di massa, messaggi ripetuti, pubblicità non richiesta o autopromozione fuori dagli spazi che la consentono.
7. **Rispetta le regole di ogni Hub.** I proprietari degli Hub possono aggiungere regole più severe per la loro community.
8. **Rispetta la legge** e i [Termini di servizio](https://de-cave.com/terms).

**Applicazione:** a seconda della gravità, violare queste regole può portare a un avvertimento, restrizioni temporanee, rimozione da un Hub o un ban permanente da DeCave.

**Segnala un problema:** fai clic destro su un messaggio o un profilo e scegli **Segnala**. Le segnalazioni sono private e la persona non saprà mai chi l''ha segnalata.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='rules'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='DeCave Community Rules';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'it','Cos''è Trova uno Squad?','Scegli un gioco e cosa cerchi, e DeCave ti abbina a giocatori che cercano la stessa cosa. Quando trovi un match, ottieni una stanza dello Squad per chattare e parlare in vocale insieme.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';

-- pl
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pl','Czym jest Find a Squad?','Wybierz grę i to, czego szukasz, a DeCave połączy cię z graczami, którzy szukają tego samego. Po dopasowaniu dostajecie pokój Squad do wspólnego czatu i rozmów głosowych.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';

-- uk
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'uk','Правила спільноти DeCave','Ці правила діють усюди в DeCave: у Hubs, особистих повідомленнях, групових чатах, голосі та «Знайди Squad».

1. **Будь шанобливим.** Жодних цькувань, булінгу, погроз чи цілеспрямованих образ.
2. **Жодної мови ворожнечі.** Нічого, що нападає на людей через расу, етнічне походження, релігію, гендер, сексуальну орієнтацію, інвалідність чи національність.
3. **Публічні простори — без NSFW.** Жодного сексуального, кривавого чи шокуючого контенту в Hubs, які на це не погодились. І ніколи нічого за участі неповнолітніх.
4. **Захищай приватність.** Не поширюй чужу особисту інформацію (справжнє ім’я, адресу, фото, акаунти) без згоди людини.
5. **Жодних читів, шахрайства чи експлойтів.** Не продавай чити, не торгуй акаунтами, не кидай фішингові посилання, не влаштовуй фейкові розіграші й не видавай себе за команду DeCave.
6. **Жодного спаму.** Жодних масових особистих повідомлень, повторюваних повідомлень, непроханої реклами чи самопіару поза місцями, де це дозволено.
7. **Дотримуйся правил кожного Hub.** Власники Hub можуть додавати суворіші правила для своєї спільноти.
8. **Поважай закон** і [Умови використання](https://de-cave.com/terms).

**Покарання:** залежно від серйозності порушення правил може призвести до попередження, тимчасових обмежень, видалення з Hub або остаточного бану в DeCave.

**Повідом про проблему:** клацни правою кнопкою на повідомленні чи профілі й вибери **Поскаржитися**. Скарги приватні, і людині ніколи не кажуть, хто на неї поскаржився.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='rules'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='DeCave Community Rules';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'uk','Що таке «Знайди Squad»?','Вибери гру й те, що шукаєш, і DeCave підбере тобі гравців, які шукають те саме. Коли збіг знайдено, ти отримуєш кімнату Squad для чату й голосу.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';
