-- DeCave Official Hub: patch notes for release 0.1.153, with translations
-- for every shipped locale. Same format as 0086. Idempotent: fixed id,
-- inserted only when absent; translations use INSERT OR REPLACE.

INSERT INTO decave_messages(id,room_id,hub_id,author_user_id,text,created_at,pinned)
SELECT 'official-0096-patch-notes-0153',
  (SELECT MIN(r.id) FROM decave_rooms r WHERE r.hub_id=o.hub_id AND r.name='patch-notes' AND r.type='text'),
  o.hub_id,h.owner_id,
  '__DECAVE_FORUM_POST_V1__{"version":1,"title":"Release 0.1.153","tags":[],"body":"• Settings: linked accounts now show each service''s logo\n• Home: dashboard icons are brighter and easier to see on every skin\n• Friends sidebar: avatars without a picture get a colored circle, all avatars are round, the online/offline dot sits on the avatar, and rows are more compact\n• Offline friends without a role now just show \"Offline\"\n• Scrollbars are thin and only appear when you hover the area that scrolls","type":"guide","repliesLocked":true}',
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  0
FROM decave_official_hubs o
JOIN decave_hubs h ON h.id=o.hub_id
WHERE o.key='decave-community-v1'
  AND EXISTS (SELECT 1 FROM decave_rooms r WHERE r.hub_id=o.hub_id AND r.name='patch-notes' AND r.type='text')
  AND NOT EXISTS (SELECT 1 FROM decave_messages m WHERE m.id='official-0096-patch-notes-0153');

INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'de','Release 0.1.153','• Einstellungen: Verknüpfte Konten zeigen jetzt das Logo des jeweiligen Dienstes
• Startseite: Die Dashboard-Symbole sind heller und auf jedem Skin besser zu sehen
• Freundesleiste: Avatare ohne Bild bekommen einen farbigen Kreis, alle Avatare sind rund, der Online-/Offline-Punkt sitzt am Avatar und die Zeilen sind kompakter
• Offline-Freunde ohne Rolle zeigen jetzt nur noch „Offline“
• Scrollleisten sind schmal und erscheinen nur, wenn du mit der Maus über den scrollbaren Bereich fährst'
FROM decave_messages m WHERE m.id='official-0096-patch-notes-0153';

INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'el','Έκδοση 0.1.153','• Ρυθμίσεις: οι συνδεδεμένοι λογαριασμοί δείχνουν πλέον το λογότυπο κάθε υπηρεσίας
• Αρχική: τα εικονίδια του πίνακα είναι πιο φωτεινά και φαίνονται καλύτερα σε κάθε skin
• Λίστα φίλων: τα avatar χωρίς εικόνα παίρνουν χρωματιστό κύκλο, όλα τα avatar είναι στρογγυλά, η κουκκίδα κατάστασης βρίσκεται πάνω στο avatar και οι γραμμές είναι πιο συμπαγείς
• Οι φίλοι εκτός σύνδεσης χωρίς ρόλο δείχνουν πλέον μόνο «Εκτός σύνδεσης»
• Οι γραμμές κύλισης είναι λεπτές και εμφανίζονται μόνο όταν περνάς το ποντίκι πάνω από την περιοχή που κυλά'
FROM decave_messages m WHERE m.id='official-0096-patch-notes-0153';

INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'es','Versión 0.1.153','• Ajustes: las cuentas vinculadas ahora muestran el logo de cada servicio
• Inicio: los iconos del panel son más brillantes y se ven mejor en todos los skins
• Barra de amigos: los avatares sin imagen tienen un círculo de color, todos los avatares son redondos, el punto de conectado/desconectado está sobre el avatar y las filas son más compactas
• Los amigos desconectados sin rol ahora solo muestran «Desconectado»
• Las barras de desplazamiento son finas y solo aparecen al pasar el ratón por la zona que se desplaza'
FROM decave_messages m WHERE m.id='official-0096-patch-notes-0153';

INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'fr','Version 0.1.153','• Paramètres : les comptes liés affichent désormais le logo de chaque service
• Accueil : les icônes du tableau de bord sont plus claires et plus visibles sur tous les skins
• Barre d’amis : les avatars sans image ont un cercle coloré, tous les avatars sont ronds, le point en ligne/hors ligne est sur l’avatar et les lignes sont plus compactes
• Les amis hors ligne sans rôle affichent maintenant simplement « Hors ligne »
• Les barres de défilement sont fines et n’apparaissent qu’au survol de la zone qui défile'
FROM decave_messages m WHERE m.id='official-0096-patch-notes-0153';

INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'it','Versione 0.1.153','• Impostazioni: gli account collegati ora mostrano il logo di ogni servizio
• Home: le icone della dashboard sono più luminose e si vedono meglio con ogni skin
• Barra amici: gli avatar senza immagine hanno un cerchio colorato, tutti gli avatar sono rotondi, il pallino online/offline è sull’avatar e le righe sono più compatte
• Gli amici offline senza ruolo ora mostrano solo «Offline»
• Le barre di scorrimento sono sottili e compaiono solo passando il mouse sull’area che scorre'
FROM decave_messages m WHERE m.id='official-0096-patch-notes-0153';

INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'nl','Release 0.1.153','• Instellingen: gekoppelde accounts tonen nu het logo van elke dienst
• Home: de dashboardpictogrammen zijn helderder en beter zichtbaar op elke skin
• Vriendenbalk: avatars zonder afbeelding krijgen een gekleurde cirkel, alle avatars zijn rond, de online/offline-stip staat op de avatar en de rijen zijn compacter
• Offline vrienden zonder rol tonen nu gewoon „Offline”
• Scrollbalken zijn smal en verschijnen alleen als je met de muis over het scrollgebied gaat'
FROM decave_messages m WHERE m.id='official-0096-patch-notes-0153';

INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pl','Wydanie 0.1.153','• Ustawienia: połączone konta pokazują teraz logo każdej usługi
• Strona główna: ikony panelu są jaśniejsze i lepiej widoczne w każdym motywie
• Pasek znajomych: awatary bez zdjęcia mają kolorowe kółko, wszystkie awatary są okrągłe, kropka statusu jest na awatarze, a wiersze są bardziej zwarte
• Znajomi offline bez roli pokazują teraz tylko „Offline”
• Paski przewijania są cienkie i pojawiają się tylko po najechaniu myszą na przewijany obszar'
FROM decave_messages m WHERE m.id='official-0096-patch-notes-0153';

INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'pt-BR','Versão 0.1.153','• Configurações: as contas vinculadas agora mostram o logo de cada serviço
• Início: os ícones do painel estão mais claros e fáceis de ver em todos os skins
• Barra de amigos: avatares sem imagem ganham um círculo colorido, todos os avatares são redondos, o ponto de online/offline fica no avatar e as linhas estão mais compactas
• Amigos offline sem cargo agora mostram apenas "Offline"
• As barras de rolagem são finas e só aparecem ao passar o mouse sobre a área que rola'
FROM decave_messages m WHERE m.id='official-0096-patch-notes-0153';

INSERT OR REPLACE INTO decave_official_post_translations(post_id,locale,title,body)
SELECT m.id,'uk','Випуск 0.1.153','• Налаштування: пов’язані акаунти тепер показують логотип кожного сервісу
• Головна: іконки панелі яскравіші й краще видно в кожній темі
• Панель друзів: аватари без зображення отримують кольорове коло, усі аватари круглі, позначка статусу розміщена на аватарі, а рядки компактніші
• Друзі не в мережі без ролі тепер показують лише «Не в мережі»
• Смуги прокрутки тонкі й з’являються лише при наведенні на область, що прокручується'
FROM decave_messages m WHERE m.id='official-0096-patch-notes-0153';
