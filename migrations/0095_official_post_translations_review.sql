-- Official Hub #rules and #faq translations updated after the review of every
-- catalog against the Discord and Steam terms in each language (see
-- shared/i18n/glossary.md). Same rows and matching as migrations 0093 and
-- 0094, regenerated from the locale catalogs for the posts whose text changed.

-- el
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'el','Κανόνες κοινότητας DeCave','Αυτοί οι κανόνες ισχύουν παντού στο DeCave: Hubs, άμεσα μηνύματα, ομαδικές συνομιλίες, φωνή και Βρες Squad.

1. **Να σέβεσαι τους άλλους.** Όχι παρενόχληση, εκφοβισμός, απειλές ή στοχευμένες προσβολές.
2. **Όχι ρητορική μίσους.** Τίποτα που επιτίθεται σε ανθρώπους λόγω φυλής, εθνοτικής καταγωγής, θρησκείας, φύλου, σεξουαλικού προσανατολισμού, αναπηρίας ή εθνικότητας.
3. **Κράτα τους δημόσιους χώρους κατάλληλους για όλους.** Όχι σεξουαλικό, αιματηρό ή σοκαριστικό περιεχόμενο σε Hubs που δεν το έχουν επιτρέψει. Ποτέ τίποτα που αφορά ανηλίκους.
4. **Σεβάσου το απόρρητο των άλλων.** Μη μοιράζεσαι προσωπικά στοιχεία κανενός (πραγματικό όνομα, διεύθυνση, φωτογραφίες, λογαριασμούς) χωρίς τη συγκατάθεσή του.
5. **Όχι cheating, απάτες ή exploits.** Όχι πώληση cheats, εμπόριο λογαριασμών, συνδέσμους phishing, ψεύτικα giveaway ή πλαστοπροσωπία μελών της ομάδας του DeCave.
6. **Όχι spam.** Όχι μαζικά άμεσα μηνύματα, επαναλαμβανόμενα μηνύματα, αζήτητη διαφήμιση ή αυτοπροβολή εκτός χώρων που το επιτρέπουν.
7. **Ακολούθα τους κανόνες κάθε Hub.** Οι ιδιοκτήτες Hub μπορούν να προσθέσουν αυστηρότερους κανόνες για την κοινότητά τους.
8. **Σεβάσου τον νόμο** και τους [Όρους χρήσης](https://de-cave.com/terms).

**Επιβολή:** ανάλογα με τη σοβαρότητα, η παραβίαση αυτών των κανόνων μπορεί να οδηγήσει σε προειδοποίηση, προσωρινούς περιορισμούς, αφαίρεση από Hub ή μόνιμο ban από το DeCave.

**Ανάφερε ένα πρόβλημα:** κάνε δεξί κλικ σε ένα μήνυμα ή προφίλ και επίλεξε **Αναφορά**. Οι αναφορές είναι ιδιωτικές και το άτομο δεν μαθαίνει ποτέ ποιος έκανε την αναφορά.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='rules'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='DeCave Community Rules';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'el','Πώς ρυθμίζω το προφίλ μου;','Κάνε κλικ στο άβαταρ σου κάτω αριστερά → **Προφίλ**. Μπορείς να προσθέσεις εικόνα, banner, βιογραφικό και τα παιχνίδια που παίζεις.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I set up my profile?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'el','Πώς προσθέτω φίλους;','Άνοιξε τους **Φίλους**, επίλεξε **Προσθήκη φίλου** και αναζήτησε με όνομα χρήστη. Μόλις αποδεχτούν το αίτημα, μπορείς να τους στέλνεις μηνύματα, να τους καλείς και να τους προσκαλείς σε Hubs.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I add friends?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'el','Τι είναι το Βρες Squad;','Διάλεξε παιχνίδι και τι ψάχνεις, και το DeCave σε ταιριάζει με παίκτες που ψάχνουν το ίδιο. Όταν γίνει ταίριασμα, παίρνετε ένα δωμάτιο Squad για συνομιλία και φωνή μαζί.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'el','Πώς μπαίνω ή δημιουργώ Hub;','Χρησιμοποίησε το κουμπί **+** στην πάνω μπάρα. Μπορείς να περιηγηθείς σε δημόσια Hubs, να μπεις σε ένα με σύνδεσμο πρόσκλησης ή να δημιουργήσεις το δικό σου από πρότυπο (μαζί και τη διάταξη streamer).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I join or create a hub?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'el','Πώς λειτουργούν τα φωνητικά δωμάτια;','Κάνε κλικ σε ένα φωνητικό δωμάτιο σε οποιοδήποτε Hub για να μπεις. Από τα χειριστήρια φωνής μπορείς να κάνεις σίγαση, κώφωση, κοινή χρήση οθόνης και να αλλάξεις συσκευή εισόδου. Το Push-to-Talk είναι διαθέσιμο στην εφαρμογή υπολογιστή.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do voice rooms work?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'el','Να χρησιμοποιήσω την εφαρμογή υπολογιστή;','Είναι προαιρετική, αλλά προσθέτει αναγνώριση παιχνιδιών, ειδοποιήσεις επιφάνειας εργασίας, καθολικό Push-to-Talk και αυτόματες ενημερώσεις. Κατέβασέ την για Windows ή Mac από το [de-cave.com](https://de-cave.com).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Should I use the desktop app?';

-- es
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'es','Normas de la comunidad de DeCave','Estas normas se aplican en todo DeCave: Hubs, MD, chats de grupo, voz y Buscar Squad.

1. **Respeta a los demás.** Nada de acoso, bullying, amenazas ni insultos dirigidos.
2. **Nada de discurso de odio.** Nada que ataque a personas por su raza, etnia, religión, género, orientación sexual, discapacidad o nacionalidad.
3. **Mantén los espacios públicos aptos para todos.** Nada de contenido sexual, gore o impactante en Hubs que no lo hayan permitido expresamente. Nunca nada que involucre a menores.
4. **Protege la privacidad.** No compartas información personal de nadie (nombre real, dirección, fotos, cuentas) sin su consentimiento.
5. **Nada de trampas, estafas ni exploits.** Nada de vender cheats, comerciar con cuentas, enlaces de phishing, sorteos falsos ni hacerse pasar por el equipo de DeCave.
6. **Nada de spam.** Nada de MD masivos, mensajes repetidos, publicidad no solicitada ni autopromoción fuera de los espacios que lo permitan.
7. **Sigue las normas de cada Hub.** Los propietarios de los Hubs pueden añadir normas más estrictas para su comunidad.
8. **Respeta la ley** y los [Términos del servicio](https://de-cave.com/terms).

**Sanciones:** según la gravedad, incumplir estas normas puede conllevar una advertencia, restricciones temporales, la expulsión de un Hub o un baneo permanente de DeCave.

**Reporta un problema:** haz clic derecho en un mensaje o perfil y elige **Reportar**. Los reportes son privados y nunca se le dice a la persona quién la reportó.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='rules'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='DeCave Community Rules';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'es','¿Qué es Buscar Squad?','Elige un juego y lo que buscas, y DeCave te empareja con jugadores que buscan lo mismo. Cuando hay coincidencia, tendrás una sala de Squad para chatear y hablar por voz juntos.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'es','¿Cómo funcionan las salas de voz?','Haz clic en una sala de voz de cualquier Hub para unirte. Desde los controles de voz puedes silenciarte, ensordecerte, compartir pantalla y cambiar tu dispositivo de entrada. La función Pulsar para hablar está disponible en la app de escritorio.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do voice rooms work?';

-- pt-BR
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pt-BR','Regras da comunidade DeCave','Estas regras valem em todo o DeCave: Hubs, DMs, chats em grupo, voz e Encontrar um Squad.

1. **Seja respeitoso.** Nada de assédio, bullying, ameaças ou insultos direcionados.
2. **Sem discurso de ódio.** Nada que ataque pessoas por raça, etnia, religião, gênero, orientação sexual, deficiência ou nacionalidade.
3. **Mantenha os espaços públicos adequados para todos.** Nada de conteúdo sexual, violento ou chocante em Hubs que não tenham optado por isso. Nunca nada que envolva menores.
4. **Proteja a privacidade.** Não compartilhe informações pessoais de ninguém (nome real, endereço, fotos, contas) sem o consentimento da pessoa.
5. **Sem cheats, golpes ou exploits.** Nada de vender cheats, negociar contas, links de phishing, sorteios falsos ou se passar pela equipe do DeCave.
6. **Sem spam.** Nada de DMs em massa, mensagens repetidas, publicidade não solicitada ou autopromoção fora dos espaços que permitem isso.
7. **Siga as regras de cada Hub.** Donos de Hubs podem adicionar regras mais rígidas para a comunidade deles.
8. **Respeite a lei** e os [Termos de Serviço](https://de-cave.com/terms).

**Punições:** dependendo da gravidade, quebrar estas regras pode resultar em advertência, restrições temporárias, remoção de um Hub ou banimento permanente do DeCave.

**Denuncie um problema:** clique com o botão direito em uma mensagem ou perfil e escolha **Denunciar**. As denúncias são privadas e a pessoa nunca fica sabendo quem a denunciou.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='rules'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='DeCave Community Rules';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pt-BR','Como funcionam as salas de voz?','Clique em uma sala de voz em qualquer Hub para entrar. Nos controles de voz, você pode desativar o microfone, desativar o áudio, compartilhar a tela e trocar o dispositivo de entrada. O Aperte para falar está disponível no app para desktop.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do voice rooms work?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pt-BR','Devo usar o app para desktop?','É opcional, mas ele adiciona detecção de jogos, notificações na área de trabalho, Aperte para falar global e atualizações automáticas. Baixe para Windows ou Mac em [de-cave.com](https://de-cave.com).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Should I use the desktop app?';

-- fr
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'fr','Règles de la communauté DeCave','Ces règles s''appliquent partout sur DeCave : Hubs, MP, discussions de groupe, vocal et Trouver un Squad.

1. **Sois respectueux.** Pas de harcèlement, d''intimidation, de menaces ni d''insultes ciblées.
2. **Pas de discours haineux.** Rien qui attaque des personnes en raison de leur race, origine ethnique, religion, genre, orientation sexuelle, handicap ou nationalité.
3. **Reste correct dans les espaces publics.** Pas de contenu sexuel, gore ou choquant dans les Hubs qui ne l''ont pas autorisé. Jamais rien impliquant des mineurs.
4. **Protège la vie privée.** Ne partage pas les informations personnelles de quelqu''un (vrai nom, adresse, photos, comptes) sans son consentement.
5. **Pas de triche, d''arnaques ni d''exploitation de bugs.** Pas de vente de cheats, d''échange de comptes, de liens de phishing, de faux concours ni d''usurpation de l''identité de l''équipe DeCave.
6. **Pas de spam.** Pas de MP en masse, de messages répétés, de publicité non sollicitée ni d''autopromo en dehors des espaces qui l''autorisent.
7. **Respecte les règles de chaque Hub.** Les propriétaires de Hub peuvent ajouter des règles plus strictes pour leur communauté.
8. **Respecte la loi** et les [Conditions d''utilisation](https://de-cave.com/terms).

**Sanctions :** selon la gravité, enfreindre ces règles peut entraîner un avertissement, des restrictions temporaires, une expulsion d''un Hub ou un bannissement définitif de DeCave.

**Signaler un problème :** fais un clic droit sur un message ou un profil et choisis **Signaler**. Les signalements sont privés et la personne ne sait jamais qui l''a signalée.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='rules'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='DeCave Community Rules';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'fr','Comment fonctionnent les salons vocaux ?','Clique sur un salon vocal dans n''importe quel Hub pour le rejoindre. Depuis les commandes vocales, tu peux couper ton micro, te mettre en sourdine, partager ton écran et changer de périphérique d''entrée. Le mode Appuyer pour parler est disponible dans l''appli de bureau.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do voice rooms work?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'fr','Dois-je utiliser l''appli de bureau ?','C''est facultatif, mais elle ajoute la détection des jeux, les notifications de bureau, le mode Appuyer pour parler global et les mises à jour automatiques. Télécharge-la pour Windows ou Mac sur [de-cave.com](https://de-cave.com).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Should I use the desktop app?';

-- nl
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'nl','DeCave-communityregels','Deze regels gelden overal op DeCave: Hubs, DM''s, groepschats, spraak en Find a Squad.

1. **Wees respectvol.** Geen intimidatie, pesten, bedreigingen of gerichte beledigingen.
2. **Geen haatzaaiende taal.** Niets wat mensen aanvalt op basis van ras, etniciteit, religie, gender, seksuele geaardheid, beperking of nationaliteit.
3. **Houd het netjes in openbare ruimtes.** Geen seksuele, bloederige of schokkende content in Hubs die daar niet voor gekozen hebben. Nooit iets waarbij minderjarigen betrokken zijn.
4. **Bescherm privacy.** Deel geen persoonlijke gegevens van anderen (echte naam, adres, foto''s, accounts) zonder hun toestemming.
5. **Geen valsspelen, oplichting of exploits.** Geen verkoop van cheats, accounthandel, phishinglinks, nep-giveaways en je niet voordoen als DeCave-medewerker.
6. **Geen spam.** Geen massa-DM''s, herhaalde berichten, ongevraagde reclame of zelfpromotie buiten ruimtes waar dat mag.
7. **Volg de eigen regels van elke Hub.** Hub-eigenaren kunnen strengere regels toevoegen voor hun community.
8. **Respecteer de wet** en de [Servicevoorwaarden](https://de-cave.com/terms).

**Handhaving:** afhankelijk van de ernst kan het overtreden van deze regels leiden tot een waarschuwing, tijdelijke beperkingen, verwijdering uit een Hub of een permanente verbanning van DeCave.

**Een probleem rapporteren:** klik met de rechtermuisknop op een bericht of profiel en kies **Rapporteren**. Rapporten zijn privé en de persoon krijgt nooit te horen wie hem heeft gerapporteerd.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='rules'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='DeCave Community Rules';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'nl','Is deze Hub privé? Kunnen anderen mij hier zien?','Ja, hij is privé. Iedereen wordt automatisch lid van DeCave Official, maar leden kunnen elkaar niet zien: de ledenlijst, ledenaantallen en onlinestatus zijn verborgen, en alleen het DeCave-team kan posten. Niemand kan zien dat jij hier bent.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Is this hub private? Can other people see me here?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'nl','Wat is Find a Squad?','Kies een game en wat je zoekt, en DeCave koppelt je aan spelers die hetzelfde zoeken. Bij een match krijg je een Squad-kanaal om samen te chatten en te praten.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'nl','Hoe werken spraakkanalen?','Klik in een Hub op een spraakkanaal om deel te nemen. Via de spraakbediening kun je jezelf dempen, onhoorbaar maken, je scherm delen en je invoerapparaat wijzigen. Push to Talk is beschikbaar in de desktop-app.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do voice rooms work?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'nl','Moet ik de desktop-app gebruiken?','Het is optioneel, maar je krijgt er gamedetectie, desktopmeldingen, globale Push to Talk en automatische updates bij. Download hem voor Windows of Mac op [de-cave.com](https://de-cave.com).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Should I use the desktop app?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'nl','Hoe rapporteer ik iemand?','Klik met de rechtermuisknop op hun bericht of profiel en kies **Rapporteren**. Rapporten zijn privé.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I report someone?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'nl','Hoe verwijder ik mijn account of mijn gegevens?','Ga naar **Instellingen → Account en apparaten**. In het [Privacybeleid](https://de-cave.com/privacy) lees je wat er wordt opgeslagen en hoe het wordt verwijderd.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I delete my account or my data?';

-- de
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'de','DeCave-Community-Regeln','Diese Regeln gelten überall auf DeCave: in Hubs, DMs, Gruppenchats, im Voice-Chat und bei Find a Squad.

1. **Sei respektvoll.** Keine Belästigung, kein Mobbing, keine Drohungen oder gezielten Beleidigungen.
2. **Keine Hassrede.** Nichts, was Menschen wegen ihrer Herkunft, Ethnie, Religion, ihres Geschlechts, ihrer sexuellen Orientierung, Behinderung oder Nationalität angreift.
3. **Öffentliche Bereiche bleiben jugendfrei.** Keine sexuellen, blutigen oder schockierenden Inhalte in Hubs, die das nicht ausdrücklich erlauben. Niemals etwas mit Minderjährigen.
4. **Schütze die Privatsphäre.** Teile keine persönlichen Daten anderer (echter Name, Adresse, Fotos, Accounts) ohne deren Zustimmung.
5. **Keine Cheats, Betrügereien oder Exploits.** Kein Verkauf von Cheats, kein Account-Handel, keine Phishing-Links, keine Fake-Giveaways und kein Ausgeben als DeCave-Team.
6. **Kein Spam.** Keine Massen-DMs, wiederholten Nachrichten, ungefragte Werbung oder Eigenwerbung außerhalb von Bereichen, die das erlauben.
7. **Halte dich an die Regeln jedes Hubs.** Hub-Eigentümer können für ihre Community strengere Regeln festlegen.
8. **Halte dich an das Gesetz** und die [Nutzungsbedingungen](https://de-cave.com/terms).

**Durchsetzung:** Je nach Schwere kann ein Verstoß gegen diese Regeln zu einer Verwarnung, vorübergehenden Einschränkungen, dem Entfernen aus einem Hub oder einem dauerhaften Bann auf DeCave führen.

**Problem melden:** Klick mit der rechten Maustaste auf eine Nachricht oder ein Profil und wähle **Melden**. Meldungen sind privat und die Person erfährt nie, wer sie gemeldet hat.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='rules'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='DeCave Community Rules';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'de','Wie füge ich Freunde hinzu?','Öffne **Freunde**, wähle **Freund hinzufügen** und such nach dem Benutzernamen. Sobald die Person annimmt, könnt ihr chatten und telefonieren, und du kannst sie in Hubs einladen.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I add friends?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'de','Was ist Find a Squad?','Wähl ein Spiel und was du suchst, und DeCave bringt dich mit Spielern zusammen, die dasselbe suchen. Bei einem Match bekommt ihr einen Squad-Raum zum gemeinsamen Chatten und Voice-Chat.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'de','Wie funktionieren Sprachräume?','Klick in einem beliebigen Hub auf einen Sprachraum, um beizutreten. Über die Voice-Steuerung kannst du dich stummschalten, Ein- und Ausgabe deaktivieren, deinen Bildschirm teilen und dein Eingabegerät wechseln. Push-to-Talk gibt es in der Desktop-App.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do voice rooms work?';

-- it
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'it','Regole della community di DeCave','Queste regole valgono ovunque su DeCave: Hub, DM, chat di gruppo, chat vocale e Trova uno Squad.

1. **Rispetta gli altri.** Niente molestie, bullismo, minacce o insulti mirati.
2. **Niente incitamento all''odio.** Nulla che attacchi le persone per razza, etnia, religione, genere, orientamento sessuale, disabilità o nazionalità.
3. **Niente contenuti NSFW negli spazi pubblici.** Niente contenuti sessuali, cruenti o scioccanti negli Hub che non li hanno esplicitamente permessi. Mai nulla che coinvolga minori.
4. **Proteggi la privacy.** Non condividere informazioni personali di nessuno (nome reale, indirizzo, foto, account) senza il suo consenso.
5. **Niente cheat, truffe o exploit.** Niente vendita di cheat, compravendita di account, link di phishing, falsi giveaway o persone che si spacciano per lo staff di DeCave.
6. **Niente spam.** Niente DM di massa, messaggi ripetuti, pubblicità non richiesta o autopromozione fuori dagli spazi che la consentono.
7. **Rispetta le regole di ogni Hub.** I proprietari degli Hub possono aggiungere regole più severe per la loro community.
8. **Rispetta la legge** e i [Termini di servizio](https://de-cave.com/terms).

**Sanzioni:** a seconda della gravità, violare queste regole può portare a un avvertimento, a restrizioni temporanee, alla rimozione da un Hub o a un ban permanente da DeCave.

**Segnala un problema:** fai clic destro su un messaggio o un profilo e scegli **Segnala**. Le segnalazioni sono private e la persona segnalata non saprà mai chi l''ha segnalata.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='rules'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='DeCave Community Rules';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'it','Come aggiungo amici?','Apri **Amici**, scegli **Aggiungi amico** e cerca per nome utente. Quando la richiesta viene accettata, potete chattare e chiamarvi, e puoi invitare l''altra persona negli Hub.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I add friends?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'it','Cos''è Trova uno Squad?','Scegli un gioco e cosa cerchi: DeCave ti abbina a giocatori che cercano la stessa cosa. Quando trovi un match, ottieni una stanza dello Squad per chattare e parlare in vocale insieme.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'it','Come funzionano le stanze vocali?','Fai clic su una stanza vocale in qualsiasi Hub per entrare. Dai controlli vocali puoi disattivare il microfono o l''audio, condividere lo schermo e cambiare il dispositivo di ingresso. Il push-to-talk è disponibile nell''app desktop.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do voice rooms work?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'it','Conviene usare l''app desktop?','È facoltativa, ma aggiunge il rilevamento dei giochi, le notifiche desktop, il push-to-talk globale e gli aggiornamenti automatici. Scaricala per Windows o Mac su [de-cave.com](https://de-cave.com).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Should I use the desktop app?';

-- pl
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pl','Zasady społeczności DeCave','Te zasady obowiązują wszędzie w DeCave: w Hubs, prywatnych wiadomościach, czatach grupowych, na czacie głosowym i w Find a Squad.

1. **Szanuj innych.** Żadnego nękania, prześladowania, gróźb ani obraźliwych ataków na konkretne osoby.
2. **Zero mowy nienawiści.** Nic, co atakuje ludzi ze względu na rasę, pochodzenie etniczne, religię, płeć, orientację seksualną, niepełnosprawność lub narodowość.
3. **W miejscach publicznych trzymaj się treści SFW.** Żadnych treści seksualnych, drastycznych ani szokujących w Hubs, które się na to nie zgodziły. Nigdy niczego z udziałem nieletnich.
4. **Chroń prywatność.** Nie udostępniaj niczyich danych osobowych (prawdziwego imienia i nazwiska, adresu, zdjęć, kont) bez zgody tej osoby.
5. **Zero cheatów, oszustw i exploitów.** Żadnej sprzedaży cheatów, handlu kontami, linków phishingowych, fałszywych giveawayów ani podszywania się pod zespół DeCave.
6. **Zero spamu.** Żadnego masowego wysyłania prywatnych wiadomości, powtarzanych wiadomości, niechcianych reklam ani autopromocji poza miejscami, które na to pozwalają.
7. **Przestrzegaj zasad danego Hub.** Właściciele Hubs mogą dodać surowsze zasady dla swojej społeczności.
8. **Przestrzegaj prawa** i [Warunków korzystania z usługi](https://de-cave.com/terms).

**Egzekwowanie:** w zależności od wagi naruszenia łamanie tych zasad może skończyć się ostrzeżeniem, tymczasowymi ograniczeniami, usunięciem z Hub lub trwałym banem w DeCave.

**Zgłoś problem:** kliknij prawym przyciskiem wiadomość lub profil i wybierz **Zgłoś**. Zgłoszenia są prywatne, a zgłoszona osoba nigdy nie dowie się, kto ją zgłosił.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='rules'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='DeCave Community Rules';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pl','Jak działają pokoje głosowe?','Kliknij pokój głosowy w dowolnym Hub, aby dołączyć. W sterowaniu głosem możesz wyciszyć mikrofon, wyłączyć dźwięk, udostępnić ekran i zmienić urządzenie wejściowe. Tryb „Naciśnij i mów” jest dostępny w aplikacji na komputer.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do voice rooms work?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pl','Czy warto używać aplikacji na komputer?','Jest opcjonalna, ale dodaje wykrywanie gier, powiadomienia na pulpicie, globalny tryb „Naciśnij i mów” i automatyczne aktualizacje. Pobierz ją na Windowsa lub Maca ze strony [de-cave.com](https://de-cave.com).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Should I use the desktop app?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pl','Jak kogoś zgłosić?','Kliknij prawym przyciskiem wiadomość lub profil tej osoby i wybierz **Zgłoś**. Zgłoszenia są prywatne.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I report someone?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pl','Gdzie sprawdzić, co nowego?','Czytaj **#announcements**, aby poznać nowości, i **#patch-notes**, aby śledzić każdą aktualizację.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Where can I see what''s new?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pl','Jak usunąć konto lub swoje dane?','Wejdź w **Ustawienia → Konto**. Szczegóły o tym, co jest przechowywane i jak jest usuwane, znajdziesz w [Polityce prywatności](https://de-cave.com/privacy).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I delete my account or my data?';

-- uk
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'uk','Правила спільноти DeCave','Ці правила діють усюди в DeCave: у Hubs, приватних повідомленнях, групових чатах, голосі та «Знайди Squad».

1. **Будь шанобливим.** Жодних цькувань, булінгу, погроз чи цілеспрямованих образ.
2. **Жодної мови ворожнечі.** Жодних нападок на людей через расу, етнічне походження, релігію, гендер, сексуальну орієнтацію, інвалідність чи національність.
3. **Публічні простори — без NSFW.** Жодного сексуального, кривавого чи шокувального контенту в Hubs, які цього явно не дозволили. І ніколи нічого за участі неповнолітніх.
4. **Захищай приватність.** Не поширюй чужу особисту інформацію (справжнє ім’я, адресу, фото, акаунти) без згоди людини.
5. **Жодних читів, шахрайства чи експлойтів.** Не продавай чити, не торгуй акаунтами, не кидай фішингові посилання, не влаштовуй фейкові розіграші й не видавай себе за команду DeCave.
6. **Жодного спаму.** Жодних масових приватних повідомлень, повторюваних повідомлень, непроханої реклами чи самопіару поза місцями, де це дозволено.
7. **Дотримуйся правил кожного Hub.** Власники Hub можуть додавати суворіші правила для своєї спільноти.
8. **Поважай закон** і [Умови використання](https://de-cave.com/terms).

**Покарання:** залежно від серйозності порушення можна отримати попередження, тимчасові обмеження, видалення з Hub або остаточний бан у DeCave.

**Повідом про проблему:** клацни правою кнопкою на повідомленні чи профілі й вибери **Поскаржитися**. Скарги приватні, і людині ніколи не кажуть, хто на неї поскаржився.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='rules'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='DeCave Community Rules';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'uk','Цей Hub приватний? Чи бачать мене тут інші?','Так, він приватний. Усі автоматично вступають у DeCave Official, але учасники не бачать одне одного: список учасників, їхня кількість і статус у мережі приховані, а публікувати може лише команда DeCave. Ніхто не дізнається, що ти тут.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Is this hub private? Can other people see me here?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'uk','Як працюють голосові кімнати?','Клацни голосову кімнату в будь-якому Hub, щоб приєднатися. На панелі голосу можна вимкнути мікрофон чи звук, почати демонстрацію екрана й змінити пристрій введення. Активація кнопкою доступна в програмі для комп’ютера.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do voice rooms work?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'uk','Чи варто ставити програму для комп’ютера?','Це необов’язково, але програма додає розпізнавання ігор, сповіщення на робочому столі, глобальну активацію кнопкою й автооновлення. Завантаж її для Windows чи Mac на [de-cave.com](https://de-cave.com).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Should I use the desktop app?';
