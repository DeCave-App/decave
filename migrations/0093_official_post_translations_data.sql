-- Translated #rules and #faq posts of the DeCave Official Hub, for every
-- shipped locale (read by worker/lib/official-post-translations.ts; table from
-- migration 0091). Generated from shared/i18n/locales/<locale>/official.json.
--
-- The posts were written by hand in the Hub, so each row finds its post by
-- room name and the English title stored in the forum post JSON. A post whose
-- title no longer matches gets no row and keeps showing the original.
-- INSERT OR REPLACE makes the migration safe to re-run after a catalog update.

-- el
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'el','Κανόνες κοινότητας DeCave','Αυτοί οι κανόνες ισχύουν παντού στο DeCave: Hubs, DM, ομαδικές συνομιλίες, φωνή και Βρες ομάδα.

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
SELECT m.id,'el','Είναι ιδιωτικό αυτό το Hub; Μπορούν άλλοι να με δουν εδώ;','Ναι, είναι ιδιωτικό. Όλοι μπαίνουν αυτόματα στο DeCave Official, αλλά τα μέλη δεν βλέπουν το ένα το άλλο: η λίστα μελών, ο αριθμός μελών και η κατάσταση σύνδεσης είναι κρυφά και μόνο η ομάδα του DeCave μπορεί να δημοσιεύει. Κανείς δεν μπορεί να ξέρει ότι είσαι εδώ.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Is this hub private? Can other people see me here?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'el','Πώς ρυθμίζω το προφίλ μου;','Κάνε κλικ στο avatar σου κάτω αριστερά → **Προφίλ**. Μπορείς να προσθέσεις εικόνα, banner, βιογραφικό και τα παιχνίδια που παίζεις.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I set up my profile?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'el','Πώς προσθέτω φίλους;','Άνοιξε τους **Φίλους**, επίλεξε **Προσθήκη φίλου** και αναζήτησε με όνομα χρήστη. Μόλις αποδεχτούν, μπορείτε να συνομιλείτε, να καλείτε ο ένας τον άλλο και να τους προσκαλείς σε Hubs.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I add friends?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'el','Τι είναι το Βρες ομάδα;','Διάλεξε παιχνίδι και τι ψάχνεις, και το DeCave σε ταιριάζει με παίκτες που ψάχνουν το ίδιο. Όταν γίνει ταίριασμα, παίρνετε ένα δωμάτιο ομάδας για chat και φωνή μαζί.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'el','Πώς μπαίνω ή δημιουργώ Hub;','Χρησιμοποίησε το κουμπί **+** στην πάνω μπάρα. Μπορείς να περιηγηθείς σε δημόσια Hubs, να μπεις σε ένα με σύνδεσμο πρόσκλησης ή να δημιουργήσεις το δικό σου από πρότυπο (μαζί και τη διάταξη Streamer).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I join or create a hub?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'el','Πώς λειτουργούν τα φωνητικά δωμάτια;','Κάνε κλικ σε ένα φωνητικό δωμάτιο σε οποιοδήποτε Hub για να μπεις. Από τα χειριστήρια φωνής μπορείς να κάνεις σίγαση, κώφωση, κοινή χρήση οθόνης και να αλλάξεις συσκευή εισόδου. Το push to talk είναι διαθέσιμο στην εφαρμογή desktop.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do voice rooms work?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'el','Να χρησιμοποιήσω την εφαρμογή desktop;','Είναι προαιρετική, αλλά προσθέτει αναγνώριση παιχνιδιών, ειδοποιήσεις desktop, καθολικό push to talk και αυτόματες ενημερώσεις. Κατέβασέ την για Windows ή Mac από το [de-cave.com](https://de-cave.com).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Should I use the desktop app?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'el','Πώς αναφέρω κάποιον;','Κάνε δεξί κλικ στο μήνυμα ή το προφίλ του και επίλεξε **Αναφορά**. Οι αναφορές είναι ιδιωτικές.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I report someone?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'el','Πού βλέπω τι νέο υπάρχει;','Διάβασε το **#announcements** για νέα και το **#patch-notes** για κάθε ενημέρωση.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Where can I see what''s new?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'el','Πώς διαγράφω τον λογαριασμό ή τα δεδομένα μου;','Πήγαινε στις **Ρυθμίσεις → Λογαριασμός**. Δες την [Πολιτική απορρήτου](https://de-cave.com/privacy) για λεπτομέρειες σχετικά με το τι αποθηκεύεται και πώς αφαιρείται.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I delete my account or my data?';

-- es
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'es','Normas de la comunidad de DeCave','Estas normas se aplican en todo DeCave: Hubs, MD, chats de grupo, voz y Find a Squad.

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
SELECT m.id,'es','¿Este Hub es privado? ¿Pueden verme otras personas aquí?','Sí, es privado. Todos se unen a DeCave Official automáticamente, pero los miembros no pueden verse entre sí: la lista de miembros, el número de miembros y el estado en línea están ocultos, y solo el equipo de DeCave puede publicar. Nadie puede saber que estás aquí.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Is this hub private? Can other people see me here?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'es','¿Cómo configuro mi perfil?','Haz clic en tu avatar en la esquina inferior izquierda → **Perfil**. Puedes añadir una foto, un banner, una bio y los juegos a los que juegas.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I set up my profile?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'es','¿Cómo añado amigos?','Abre **Amigos**, elige **Añadir amigo** y busca por nombre de usuario. Cuando acepten, podrás chatear, llamarlos e invitarlos a Hubs.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I add friends?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'es','¿Qué es Find a Squad?','Elige un juego y lo que buscas, y DeCave te empareja con jugadores que buscan lo mismo. Cuando hay coincidencia, obtienes una sala de escuadra para chatear y hablar por voz con ellos.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'es','¿Cómo me uno a un Hub o creo uno?','Usa el botón **+** de la barra superior. Puedes explorar Hubs públicos, unirte a uno con un enlace de invitación o crear el tuyo a partir de una plantilla (incluido el diseño Streamer).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I join or create a hub?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'es','¿Cómo funcionan las salas de voz?','Haz clic en una sala de voz de cualquier Hub para unirte. Desde los controles de voz puedes silenciarte, ensordecerte, compartir pantalla y cambiar tu dispositivo de entrada. Pulsar para hablar está disponible en la app de escritorio.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do voice rooms work?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'es','¿Debería usar la app de escritorio?','Es opcional, pero añade detección de juegos, notificaciones de escritorio, pulsar para hablar global y actualizaciones automáticas. Descárgala para Windows o Mac en [de-cave.com](https://de-cave.com).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Should I use the desktop app?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'es','¿Cómo reporto a alguien?','Haz clic derecho en su mensaje o perfil y elige **Reportar**. Los reportes son privados.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I report someone?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'es','¿Dónde puedo ver las novedades?','Lee **#announcements** para noticias y **#patch-notes** para cada actualización.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Where can I see what''s new?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'es','¿Cómo elimino mi cuenta o mis datos?','Ve a **Ajustes → Cuenta**. Consulta la [Política de privacidad](https://de-cave.com/privacy) para ver qué se guarda y cómo se elimina.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I delete my account or my data?';

-- pt-BR
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pt-BR','Regras da comunidade DeCave','Estas regras valem em todo o DeCave: Hubs, DMs, chats em grupo, voz e Encontrar um Squad.

1. **Seja respeitoso.** Nada de assédio, bullying, ameaças ou insultos direcionados.
2. **Sem discurso de ódio.** Nada que ataque pessoas por raça, etnia, religião, gênero, orientação sexual, deficiência ou nacionalidade.
3. **Mantenha os espaços públicos adequados para todos.** Nada de conteúdo sexual, violento ou chocante em Hubs que não tenham optado por isso. Jamais qualquer coisa envolvendo menores.
4. **Proteja a privacidade.** Não compartilhe informações pessoais de ninguém (nome real, endereço, fotos, contas) sem o consentimento da pessoa.
5. **Sem cheats, golpes ou exploits.** Nada de vender cheats, negociar contas, links de phishing, sorteios falsos ou se passar pela equipe do DeCave.
6. **Sem spam.** Nada de DMs em massa, mensagens repetidas, publicidade não solicitada ou autopromoção fora dos espaços que permitem isso.
7. **Siga as regras de cada Hub.** Donos de Hubs podem adicionar regras mais rígidas para a comunidade deles.
8. **Respeite a lei** e os [Termos de Serviço](https://de-cave.com/terms).

**Aplicação:** dependendo da gravidade, quebrar estas regras pode resultar em advertência, restrições temporárias, remoção de um Hub ou banimento permanente do DeCave.

**Denuncie um problema:** clique com o botão direito em uma mensagem ou perfil e escolha **Denunciar**. As denúncias são privadas e a pessoa nunca fica sabendo quem a denunciou.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='rules'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='DeCave Community Rules';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pt-BR','Este Hub é privado? Outras pessoas podem me ver aqui?','Sim, ele é privado. Todo mundo entra no DeCave Official automaticamente, mas os membros não conseguem ver uns aos outros: a lista de membros, a contagem de membros e o status online ficam ocultos, e só a equipe do DeCave pode postar. Ninguém consegue saber que você está aqui.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Is this hub private? Can other people see me here?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pt-BR','Como configuro meu perfil?','Clique no seu avatar no canto inferior esquerdo → **Perfil**. Você pode adicionar uma foto, um banner, uma bio e os jogos que você joga.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I set up my profile?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pt-BR','Como adiciono amigos?','Abra **Amigos**, escolha **Adicionar amigo** e busque pelo nome de usuário. Depois que a pessoa aceitar, vocês podem conversar, fazer chamadas e você pode convidá-la para Hubs.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I add friends?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pt-BR','O que é o Encontrar um Squad?','Escolha um jogo e o que você procura, e o DeCave junta você com jogadores procurando a mesma coisa. Quando der match, vocês ganham uma sala de squad para conversar por texto e voz.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pt-BR','Como entro ou crio um Hub?','Use o botão **+** na barra superior. Você pode explorar Hubs públicos, entrar em um com um link de convite ou criar o seu a partir de um modelo (incluindo o layout Streamer).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I join or create a hub?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pt-BR','Como funcionam as salas de voz?','Clique em uma sala de voz em qualquer Hub para entrar. Nos controles de voz, você pode silenciar, ensurdecer, compartilhar a tela e trocar o dispositivo de entrada. O aperte para falar está disponível no app para desktop.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do voice rooms work?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pt-BR','Devo usar o app para desktop?','É opcional, mas ele adiciona detecção de jogos, notificações na área de trabalho, aperte para falar global e atualizações automáticas. Baixe para Windows ou Mac em [de-cave.com](https://de-cave.com).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Should I use the desktop app?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pt-BR','Como denuncio alguém?','Clique com o botão direito na mensagem ou no perfil da pessoa e escolha **Denunciar**. As denúncias são privadas.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I report someone?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pt-BR','Onde vejo as novidades?','Leia **#announcements** para notícias e **#patch-notes** para cada atualização.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Where can I see what''s new?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pt-BR','Como excluo minha conta ou meus dados?','Vá em **Configurações → Conta**. Veja a [Política de Privacidade](https://de-cave.com/privacy) para saber o que é armazenado e como é removido.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I delete my account or my data?';

-- fr
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'fr','Règles de la communauté DeCave','Ces règles s''appliquent partout sur DeCave : Hubs, MP, discussions de groupe, vocal et Trouver une escouade.

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
SELECT m.id,'fr','Ce Hub est-il privé ? Les autres peuvent-ils me voir ici ?','Oui, il est privé. Tout le monde rejoint DeCave Official automatiquement, mais les membres ne peuvent pas se voir : la liste des membres, le nombre de membres et le statut en ligne sont masqués, et seule l''équipe DeCave peut publier. Personne ne peut savoir que tu es là.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Is this hub private? Can other people see me here?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'fr','Comment configurer mon profil ?','Clique sur ton avatar en bas à gauche → **Profil**. Tu peux ajouter une photo, une bannière, une bio et les jeux auxquels tu joues.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I set up my profile?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'fr','Comment ajouter des amis ?','Ouvre **Amis**, choisis **Ajouter un ami** et cherche par nom d''utilisateur. Une fois ta demande acceptée, tu peux discuter, appeler et inviter cette personne dans des Hubs.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I add friends?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'fr','C''est quoi, Trouver une escouade ?','Choisis un jeu et ce que tu cherches, et DeCave te met en relation avec des joueurs qui cherchent la même chose. Quand ça matche, tu obtiens un salon d''escouade pour discuter et parler en vocal ensemble.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'fr','Comment rejoindre ou créer un Hub ?','Utilise le bouton **+** dans la barre du haut. Tu peux parcourir les Hubs publics, en rejoindre un avec un lien d''invitation ou créer le tien à partir d''un modèle (y compris la disposition Streamer).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I join or create a hub?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'fr','Comment fonctionnent les salons vocaux ?','Clique sur un salon vocal dans n''importe quel Hub pour le rejoindre. Depuis les commandes vocales, tu peux couper ton micro, te mettre en sourdine, partager ton écran et changer de périphérique d''entrée. Appuyer pour parler est disponible dans l''appli de bureau.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do voice rooms work?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'fr','Dois-je utiliser l''appli de bureau ?','C''est facultatif, mais elle ajoute la détection des jeux, les notifications de bureau, appuyer pour parler global et les mises à jour automatiques. Télécharge-la pour Windows ou Mac sur [de-cave.com](https://de-cave.com).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Should I use the desktop app?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'fr','Comment signaler quelqu''un ?','Fais un clic droit sur son message ou son profil et choisis **Signaler**. Les signalements sont privés.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I report someone?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'fr','Où voir les nouveautés ?','Lis **#announcements** pour les actus et **#patch-notes** pour chaque mise à jour.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Where can I see what''s new?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'fr','Comment supprimer mon compte ou mes données ?','Va dans **Paramètres → Compte**. Consulte la [Politique de confidentialité](https://de-cave.com/privacy) pour savoir ce qui est stocké et comment c''est supprimé.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I delete my account or my data?';

-- nl
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'nl','DeCave-communityregels','Deze regels gelden overal op DeCave: Hubs, DM''s, groepschats, voice en Find a Squad.

1. **Wees respectvol.** Geen intimidatie, pesten, bedreigingen of gerichte beledigingen.
2. **Geen haatzaaiende taal.** Niets wat mensen aanvalt op basis van ras, etniciteit, religie, gender, seksuele geaardheid, beperking of nationaliteit.
3. **Houd openbare ruimtes safe for work.** Geen seksuele, bloederige of schokkende content in Hubs die daar niet voor gekozen hebben. Nooit iets waarbij minderjarigen betrokken zijn.
4. **Bescherm privacy.** Deel geen persoonlijke gegevens van anderen (echte naam, adres, foto''s, accounts) zonder hun toestemming.
5. **Geen cheats, oplichting of exploits.** Geen verkoop van cheats, accounthandel, phishinglinks, nep-giveaways of je voordoen als DeCave-medewerker.
6. **Geen spam.** Geen massa-DM''s, herhaalde berichten, ongevraagde reclame of zelfpromotie buiten ruimtes waar dat mag.
7. **Volg de eigen regels van elke Hub.** Hub-eigenaren kunnen strengere regels toevoegen voor hun community.
8. **Respecteer de wet** en de [Servicevoorwaarden](https://de-cave.com/terms).

**Handhaving:** afhankelijk van de ernst kan het overtreden van deze regels leiden tot een waarschuwing, tijdelijke beperkingen, verwijdering uit een Hub of een permanente ban van DeCave.

**Een probleem melden:** klik met de rechtermuisknop op een bericht of profiel en kies **Melden**. Meldingen zijn privé en de gemelde persoon krijgt nooit te horen wie de melding heeft gedaan.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='rules'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='DeCave Community Rules';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'nl','Is deze Hub privé? Kunnen anderen mij hier zien?','Ja, hij is privé. Iedereen wordt automatisch lid van DeCave Official, maar leden kunnen elkaar niet zien: de ledenlijst, ledenaantallen en onlinestatus zijn verborgen, en alleen het DeCave-team kan posten. Niemand kan zien dat je hier bent.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Is this hub private? Can other people see me here?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'nl','Hoe stel ik mijn profiel in?','Klik op je avatar linksonder → **Profiel**. Je kunt een foto, banner, bio en de games die je speelt toevoegen.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I set up my profile?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'nl','Hoe voeg ik vrienden toe?','Open **Vrienden**, kies **Vriend toevoegen** en zoek op gebruikersnaam. Zodra ze accepteren, kun je chatten, bellen en ze uitnodigen voor Hubs.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I add friends?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'nl','Wat is Find a Squad?','Kies een game en wat je zoekt, en DeCave koppelt je aan spelers die hetzelfde zoeken. Bij een match krijg je een squadkamer om samen te chatten en te voicen.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'nl','Hoe word ik lid van een Hub of maak ik er een?','Gebruik de knop **+** in de bovenbalk. Je kunt openbare Hubs bekijken, lid worden via een uitnodigingslink of je eigen Hub maken vanuit een sjabloon (inclusief de Streamer-indeling).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I join or create a hub?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'nl','Hoe werken spraakkamers?','Klik in een Hub op een spraakkamer om mee te doen. Via de voice-bediening kun je dempen, doof maken, je scherm delen en je invoerapparaat wijzigen. Push to talk is beschikbaar in de desktop-app.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do voice rooms work?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'nl','Moet ik de desktop-app gebruiken?','Het is optioneel, maar je krijgt er gamedetectie, desktopmeldingen, globale push to talk en automatische updates bij. Download hem voor Windows of Mac op [de-cave.com](https://de-cave.com).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Should I use the desktop app?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'nl','Hoe meld ik iemand?','Klik met de rechtermuisknop op hun bericht of profiel en kies **Melden**. Meldingen zijn privé.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I report someone?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'nl','Waar zie ik wat er nieuw is?','Lees **#announcements** voor nieuws en **#patch-notes** voor elke update.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Where can I see what''s new?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'nl','Hoe verwijder ik mijn account of mijn gegevens?','Ga naar **Instellingen → Account**. Zie het [Privacybeleid](https://de-cave.com/privacy) voor details over wat wordt opgeslagen en hoe het wordt verwijderd.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I delete my account or my data?';

-- de
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'de','DeCave-Community-Regeln','Diese Regeln gelten überall auf DeCave: in Hubs, DMs, Gruppenchats, im Voice und bei Find a Squad.

1. **Sei respektvoll.** Keine Belästigung, kein Mobbing, keine Drohungen oder gezielten Beleidigungen.
2. **Keine Hassrede.** Nichts, was Menschen wegen ihrer Herkunft, Ethnie, Religion, ihres Geschlechts, ihrer sexuellen Orientierung, Behinderung oder Nationalität angreift.
3. **Öffentliche Bereiche bleiben jugendfrei.** Keine sexuellen, blutigen oder schockierenden Inhalte in Hubs, die das nicht ausdrücklich erlauben. Niemals etwas mit Minderjährigen.
4. **Schütze die Privatsphäre.** Teile keine persönlichen Daten anderer (echter Name, Adresse, Fotos, Accounts) ohne deren Zustimmung.
5. **Keine Cheats, Betrügereien oder Exploits.** Kein Verkauf von Cheats, kein Account-Handel, keine Phishing-Links, keine Fake-Gewinnspiele und kein Ausgeben als DeCave-Team.
6. **Kein Spam.** Keine Massen-DMs, wiederholten Nachrichten, ungefragte Werbung oder Eigenwerbung außerhalb von Bereichen, die das erlauben.
7. **Halte dich an die Regeln jedes Hubs.** Hub-Owner können für ihre Community strengere Regeln festlegen.
8. **Halte dich an das Gesetz** und die [Nutzungsbedingungen](https://de-cave.com/terms).

**Durchsetzung:** Je nach Schwere kann ein Verstoß gegen diese Regeln zu einer Verwarnung, vorübergehenden Einschränkungen, dem Entfernen aus einem Hub oder einer dauerhaften Sperre auf DeCave führen.

**Problem melden:** Klick mit der rechten Maustaste auf eine Nachricht oder ein Profil und wähle **Melden**. Meldungen sind privat und die Person erfährt nie, wer sie gemeldet hat.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='rules'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='DeCave Community Rules';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'de','Ist dieser Hub privat? Können andere mich hier sehen?','Ja, er ist privat. Alle treten DeCave Official automatisch bei, aber Mitglieder können sich gegenseitig nicht sehen: Mitgliederliste, Mitgliederzahlen und Online-Status sind ausgeblendet, und nur das DeCave-Team kann posten. Niemand kann erkennen, dass du hier bist.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Is this hub private? Can other people see me here?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'de','Wie richte ich mein Profil ein?','Klick unten links auf deinen Avatar → **Profil**. Du kannst ein Bild, ein Banner, eine Bio und die Spiele hinzufügen, die du spielst.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I set up my profile?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'de','Wie füge ich Freunde hinzu?','Öffne **Freunde**, wähle **Freund hinzufügen** und suche nach dem Benutzernamen. Sobald die Person annimmt, könnt ihr chatten, telefonieren und du kannst sie in Hubs einladen.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I add friends?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'de','Was ist Find a Squad?','Wähl ein Spiel und was du suchst, und DeCave bringt dich mit Spielern zusammen, die dasselbe suchen. Bei einem Match bekommt ihr einen Squad-Raum, um zusammen zu chatten und zu sprechen.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'de','Wie trete ich einem Hub bei oder erstelle einen?','Nutze den **+**-Button in der oberen Leiste. Du kannst öffentliche Hubs durchstöbern, über einen Einladungslink beitreten oder deinen eigenen aus einer Vorlage erstellen (auch mit dem Streamer-Layout).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I join or create a hub?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'de','Wie funktionieren Sprachräume?','Klick in einem beliebigen Hub auf einen Sprachraum, um beizutreten. Über die Sprachsteuerung kannst du dich stummschalten, taub schalten, deinen Bildschirm teilen und dein Eingabegerät wechseln. Push-to-Talk gibt es in der Desktop-App.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do voice rooms work?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'de','Soll ich die Desktop-App nutzen?','Sie ist optional, bietet aber Spielerkennung, Desktop-Benachrichtigungen, globales Push-to-Talk und automatische Updates. Lade sie für Windows oder Mac auf [de-cave.com](https://de-cave.com) herunter.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Should I use the desktop app?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'de','Wie melde ich jemanden?','Klick mit der rechten Maustaste auf die Nachricht oder das Profil der Person und wähle **Melden**. Meldungen sind privat.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I report someone?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'de','Wo sehe ich, was neu ist?','Lies **#announcements** für News und **#patch-notes** für jedes Update.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Where can I see what''s new?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'de','Wie lösche ich meinen Account oder meine Daten?','Geh zu **Einstellungen → Account**. In der [Datenschutzerklärung](https://de-cave.com/privacy) erfährst du, was gespeichert wird und wie es gelöscht wird.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I delete my account or my data?';

-- it
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'it','Regole della community di DeCave','Queste regole valgono ovunque su DeCave: Hub, DM, chat di gruppo, vocale e Trova una squadra.

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
SELECT m.id,'it','Questo Hub è privato? Gli altri possono vedermi qui?','Sì, è privato. Tutti entrano automaticamente in DeCave Official, ma i membri non possono vedersi a vicenda: l''elenco membri, il numero di membri e lo stato online sono nascosti, e solo il team DeCave può pubblicare. Nessuno può sapere che sei qui.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Is this hub private? Can other people see me here?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'it','Come configuro il mio profilo?','Fai clic sul tuo avatar nell''angolo in basso a sinistra → **Profilo**. Puoi aggiungere un''immagine, un banner, una bio e i giochi a cui giochi.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I set up my profile?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'it','Come aggiungo amici?','Apri **Amici**, scegli **Aggiungi amico** e cerca per nome utente. Quando accettano, puoi chattare, chiamarli e invitarli negli Hub.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I add friends?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'it','Cos''è Trova una squadra?','Scegli un gioco e cosa cerchi, e DeCave ti abbina a giocatori che cercano la stessa cosa. Quando trovi un match, ottieni una stanza della squadra per chattare e parlare in vocale insieme.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'it','Come entro in un Hub o ne creo uno?','Usa il pulsante **+** nella barra in alto. Puoi sfogliare gli Hub pubblici, entrare in uno con un link di invito o crearne uno tuo da un modello (incluso il layout Streamer).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I join or create a hub?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'it','Come funzionano le stanze vocali?','Fai clic su una stanza vocale in qualsiasi Hub per entrare. Dai controlli vocali puoi silenziarti, disattivare l''audio, condividere lo schermo e cambiare il dispositivo di input. Il push to talk è disponibile nell''app desktop.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do voice rooms work?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'it','Conviene usare l''app desktop?','È facoltativa, ma aggiunge il rilevamento dei giochi, le notifiche desktop, il push to talk globale e gli aggiornamenti automatici. Scaricala per Windows o Mac su [de-cave.com](https://de-cave.com).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Should I use the desktop app?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'it','Come segnalo qualcuno?','Fai clic destro sul suo messaggio o profilo e scegli **Segnala**. Le segnalazioni sono private.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I report someone?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'it','Dove vedo le novità?','Leggi **#announcements** per le notizie e **#patch-notes** per ogni aggiornamento.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Where can I see what''s new?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'it','Come elimino il mio account o i miei dati?','Vai su **Impostazioni → Account**. Consulta l''[Informativa sulla privacy](https://de-cave.com/privacy) per i dettagli su cosa viene salvato e come viene rimosso.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I delete my account or my data?';

-- pl
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pl','Zasady społeczności DeCave','Te zasady obowiązują wszędzie w DeCave: w Hubs, DM-ach, czatach grupowych, na kanałach głosowych i w Find a Squad.

1. **Szanuj innych.** Żadnego nękania, prześladowania, gróźb ani obraźliwych ataków na konkretne osoby.
2. **Zero mowy nienawiści.** Nic, co atakuje ludzi ze względu na rasę, pochodzenie etniczne, religię, płeć, orientację seksualną, niepełnosprawność lub narodowość.
3. **W przestrzeniach publicznych zachowaj treści SFW.** Żadnych treści seksualnych, drastycznych ani szokujących w Hubs, które się na to nie zgodziły. Nigdy niczego z udziałem nieletnich.
4. **Chroń prywatność.** Nie udostępniaj niczyich danych osobowych (prawdziwego imienia i nazwiska, adresu, zdjęć, kont) bez zgody tej osoby.
5. **Zero cheatów, oszustw i exploitów.** Żadnej sprzedaży cheatów, handlu kontami, linków phishingowych, fałszywych giveawayów ani podszywania się pod zespół DeCave.
6. **Zero spamu.** Żadnych masowych DM-ów, powtarzanych wiadomości, niechcianych reklam ani autopromocji poza miejscami, które na to pozwalają.
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
SELECT m.id,'pl','Czy ten Hub jest prywatny? Czy inni mnie tu widzą?','Tak, jest prywatny. Każdy automatycznie dołącza do DeCave Official, ale członkowie nie widzą siebie nawzajem: lista członków, ich liczba i status online są ukryte, a pisać może tylko zespół DeCave. Nikt nie wie, że tu jesteś.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Is this hub private? Can other people see me here?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pl','Jak ustawić profil?','Kliknij swój awatar w lewym dolnym rogu → **Profil**. Możesz dodać zdjęcie, baner, bio i gry, w które grasz.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I set up my profile?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pl','Jak dodać znajomych?','Otwórz **Znajomi**, wybierz **Dodaj znajomego** i wyszukaj po nazwie użytkownika. Gdy zaakceptuje, możecie pisać, dzwonić i zapraszać się do Hubs.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I add friends?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pl','Czym jest Find a Squad?','Wybierz grę i to, czego szukasz, a DeCave połączy cię z graczami, którzy szukają tego samego. Po dopasowaniu dostajecie pokój drużyny do wspólnego czatu i rozmów głosowych.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pl','Jak dołączyć do Hub lub go utworzyć?','Użyj przycisku **+** na górnym pasku. Możesz przeglądać publiczne Hubs, dołączyć do jednego przez link z zaproszeniem albo utworzyć własny z szablonu (w tym z układu dla streamerów).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I join or create a hub?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pl','Jak działają pokoje głosowe?','Kliknij pokój głosowy w dowolnym Hub, aby dołączyć. W sterowaniu głosem możesz wyciszyć mikrofon, wyciszyć dźwięk, udostępnić ekran i zmienić urządzenie wejściowe. Funkcja „naciśnij, by mówić” jest dostępna w aplikacji na komputer.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do voice rooms work?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pl','Czy warto używać aplikacji na komputer?','Jest opcjonalna, ale dodaje wykrywanie gier, powiadomienia na pulpicie, globalne „naciśnij, by mówić” i automatyczne aktualizacje. Pobierz ją na Windows lub Mac ze strony [de-cave.com](https://de-cave.com).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Should I use the desktop app?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pl','Jak kogoś zgłosić?','Kliknij prawym przyciskiem jego wiadomość lub profil i wybierz **Zgłoś**. Zgłoszenia są prywatne.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I report someone?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pl','Gdzie zobaczę, co nowego?','Czytaj **#announcements**, aby poznać nowości, i **#patch-notes**, aby śledzić każdą aktualizację.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Where can I see what''s new?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pl','Jak usunąć konto lub moje dane?','Wejdź w **Ustawienia → Konto**. Szczegóły o tym, co jest przechowywane i jak jest usuwane, znajdziesz w [Polityce prywatności](https://de-cave.com/privacy).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I delete my account or my data?';

-- uk
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'uk','Правила спільноти DeCave','Ці правила діють усюди в DeCave: у Hubs, особистих повідомленнях, групових чатах, голосі та «Пошуку загону».

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
SELECT m.id,'uk','Цей Hub приватний? Чи бачать мене тут інші?','Так, він приватний. Усі автоматично вступають у DeCave Official, але учасники не бачать одне одного: список учасників, їхня кількість і статус онлайн приховані, а публікувати може лише команда DeCave. Ніхто не дізнається, що ти тут.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Is this hub private? Can other people see me here?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'uk','Як налаштувати профіль?','Клацни свій аватар у нижньому лівому куті → **Профіль**. Можна додати фото, банер, біо та ігри, у які ти граєш.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I set up my profile?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'uk','Як додати друзів?','Відкрий **Друзі**, вибери **Додати друга** й знайди за іменем користувача. Коли запит приймуть, можна листуватися, дзвонити й запрошувати в Hubs.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I add friends?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'uk','Що таке «Пошук загону»?','Вибери гру й те, що шукаєш, і DeCave підбере тобі гравців, які шукають те саме. Коли збіг знайдено, ти отримуєш кімнату загону для чату й голосу.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='What is Find a Squad?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'uk','Як вступити в Hub або створити його?','Натисни кнопку **+** на верхній панелі. Можна переглядати публічні Hubs, вступити за посиланням-запрошенням або створити свій із шаблону (зокрема з макетом для стримерів).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I join or create a hub?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'uk','Як працюють голосові кімнати?','Клацни голосову кімнату в будь-якому Hub, щоб приєднатися. У голосових елементах керування можна вимкнути мікрофон чи звук, показати екран і змінити пристрій введення. «Натисни, щоб говорити» доступне в програмі для комп’ютера.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do voice rooms work?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'uk','Чи варто ставити програму для комп’ютера?','Це необов’язково, але вона додає розпізнавання ігор, сповіщення на робочому столі, глобальне «Натисни, щоб говорити» й автооновлення. Завантаж її для Windows чи Mac на [de-cave.com](https://de-cave.com).'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Should I use the desktop app?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'uk','Як поскаржитися на когось?','Клацни правою кнопкою на повідомленні чи профілі людини й вибери **Поскаржитися**. Скарги приватні.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I report someone?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'uk','Де дізнатися, що нового?','Читай **#announcements** із новинами та **#patch-notes** про кожне оновлення.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='Where can I see what''s new?';
INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'uk','Як видалити акаунт або свої дані?','Перейди в **Налаштування → Акаунт**. У [Політиці конфіденційності](https://de-cave.com/privacy) описано, що зберігається і як це видаляється.'
FROM decave_messages m
JOIN decave_rooms r ON r.id=m.room_id
JOIN decave_official_hubs o ON o.hub_id=r.hub_id
WHERE o.key='decave-community-v1' AND r.name='faq'
  AND substr(m.text,1,24)='__DECAVE_FORUM_POST_V1__'
  AND CASE WHEN json_valid(substr(m.text,25)) THEN json_extract(substr(m.text,25),'$.title') END='How do I delete my account or my data?';
