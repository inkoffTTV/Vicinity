// Эмодзи для палитры: системные символы (без картинок), категории и ключевые слова на английском
// и русском для поиска. Запись: «эмодзи английские слова|русские слова», по строке на эмодзи.

export interface Emoji {
  char: string;
  /** Короткое имя для подсказки — первое английское слово */
  name: string;
  keywords: string[];
}

export interface EmojiCategory {
  id: string;
  name: string;
  icon: string;
  emojis: Emoji[];
}

const RAW: [id: string, name: string, icon: string, data: string][] = [
  [
    'smileys',
    'Смайлики',
    '😀',
    `😀 grinning smile happy|улыбка радость
😃 smiley happy joy|улыбка радость
😄 smile happy laugh|улыбка смех
😁 grin beaming|ухмылка улыбка
😆 laughing satisfied|смех хохот
😅 sweat smile relief|пот смех облегчение
🤣 rofl rolling laughing|ржу катаюсь смех
😂 joy tears laughing lol|смех слёзы ржу
🙂 slightly smiling|улыбка
🙃 upside down|перевёрнутый
😉 wink|подмигивание
😊 blush smiling happy|улыбка румянец
😇 innocent halo angel|ангел невинный
🥰 love hearts adore|любовь влюблён сердечки
😍 heart eyes love|влюблён любовь
🤩 star struck wow|восторг звёзды
😘 kiss blow|поцелуй
😗 kissing|поцелуй
😚 kissing closed eyes|поцелуй
😋 yum delicious tongue|вкусно ням
😛 tongue|язык дразнить
😜 wink tongue crazy|язык подмигивание
🤪 zany crazy goofy|безумный дурачусь
😝 squinting tongue|язык
🤑 money mouth rich|деньги богатый
🤗 hugging hug|объятия обнимаю
🤭 hand over mouth oops|ой хихикать
🤫 shush quiet secret|тихо тсс секрет
🤔 thinking hmm|думаю хмм
🤐 zipper mouth silent|молчу
🤨 raised eyebrow suspicious|подозрительно бровь
😐 neutral|нейтрально
😑 expressionless|без эмоций
😶 no mouth silent|молчание
😏 smirk|ухмылка
😒 unamused meh|недоволен
🙄 eye roll|закатить глаза
😬 grimace awkward|неловко гримаса
🤥 lying pinocchio|ложь врун
😌 relieved calm|облегчение спокойствие
😔 pensive sad|грусть задумчивый
😪 sleepy|сонный
🤤 drooling|слюни
😴 sleeping zzz|сон спать
😷 mask sick|маска болею
🤒 thermometer sick ill|болею температура
🤕 bandage hurt|травма бинт
🤢 nauseated sick|тошнит
🤮 vomit|рвота тошнит
🤧 sneezing cold|чихаю простуда
🥵 hot heat|жарко
🥶 cold freezing|холодно мёрзну
🥴 woozy drunk|пьяный
😵 dizzy|головокружение
🤯 exploding head mind blown|взрыв мозга шок
🤠 cowboy|ковбой
🥳 party celebration|праздник вечеринка
😎 cool sunglasses|круто очки
🤓 nerd glasses|ботаник
🧐 monocle|монокль
😕 confused|растерян
😟 worried|беспокойство
🙁 frowning|хмурый
☹️ sad frowning|грусть
😮 open mouth wow surprised|удивление ого
😯 hushed surprised|удивление
😲 astonished shocked|шок изумление
😳 flushed embarrassed|смущение
🥺 pleading puppy eyes|умоляю жалобно
😦 frowning open mouth|испуг
😧 anguished|страдание
😨 fearful scared|страх
😰 anxious sweat|тревога
😥 sad relieved|грусть
😢 cry sad tear|плачу грусть слеза
😭 sob crying loud|рыдаю плачу
😱 scream fear|крик ужас
😖 confounded|расстроен
😣 persevering|терплю
😞 disappointed|разочарован
😓 downcast sweat|усталость
😩 weary tired|устал
😫 tired|устал
🥱 yawn bored|зевота скучно
😤 triumph huff|фырк
😡 pout angry rage|злость гнев
😠 angry mad|злой
🤬 cursing swearing|ругань мат
😈 smiling devil|чертёнок
👿 imp angry devil|чёрт
💀 skull dead|череп смерть
☠️ skull crossbones|череп
💩 poop|какашка
🤡 clown|клоун
👹 ogre|демон
👻 ghost|призрак привидение
👽 alien|инопланетянин
🤖 robot|робот
😺 cat smile|кот улыбка
😹 cat joy|кот смех
😻 cat heart eyes|кот любовь
🙈 see no evil monkey|обезьянка не вижу
🙉 hear no evil monkey|обезьянка не слышу
🙊 speak no evil monkey|обезьянка молчу`,
  ],
  [
    'people',
    'Люди и жесты',
    '👋',
    `👋 wave hello hi bye|привет пока машу
🤚 raised back of hand|рука
🖐️ hand fingers|ладонь
✋ raised hand stop high five|рука стоп
🖖 vulcan|вулкан
👌 ok okay|окей хорошо
🤌 pinched fingers|щепотка
🤏 pinching small|чуть-чуть
✌️ victory peace|мир победа
🤞 crossed fingers luck|удача скрещённые пальцы
🤟 love you|люблю
🤘 rock horns metal|рок коза
🤙 call me|позвони
👈 point left|влево
👉 point right|вправо
👆 point up|вверх
👇 point down|вниз
☝️ index up|внимание
👍 thumbs up like yes +1|лайк класс да
👎 thumbs down dislike no -1|дизлайк нет
✊ fist raised|кулак
👊 punch fist bump|удар кулак
🤛 left fist|кулак
🤜 right fist|кулак
👏 clap applause|аплодисменты хлопаю
🙌 raising hands hooray|ура
👐 open hands|руки
🤲 palms up|ладони
🤝 handshake deal|рукопожатие сделка
🙏 pray please thanks|спасибо пожалуйста молюсь
✍️ writing|пишу
💅 nail polish|маникюр
💪 muscle strong flex|сила мускулы
🧠 brain smart|мозг умный
👀 eyes look|глаза смотрю
👁️ eye|глаз
👅 tongue|язык
👄 mouth lips|губы рот
👶 baby|малыш младенец
🧒 child kid|ребёнок
👦 boy|мальчик
👧 girl|девочка
🧑 person adult|человек
👨 man|мужчина
👩 woman|женщина
👴 old man grandpa|дедушка
👵 old woman grandma|бабушка
🙋 raising hand|поднятая рука
🤷 shrug|пожимаю плечами не знаю
🤦 facepalm|фейспалм рукалицо
🙇 bow|поклон
💁 tipping hand|подсказка
🙅 no gesture|нет
🙆 ok gesture|ок
🧑‍💻 technologist coder developer|программист разработчик
👨‍🍳 cook chef|повар
🧑‍🎓 student graduate|студент
🧑‍🚀 astronaut|космонавт
👮 police|полиция
🕵️ detective|детектив
👷 construction worker|строитель
🤴 prince|принц
👸 princess|принцесса
🦸 superhero|супергерой
🧙 mage wizard|волшебник маг
🧛 vampire|вампир
🧟 zombie|зомби
🧜 merperson mermaid|русалка
🧚 fairy|фея
🏃 running run|бег бегу
💃 dancing woman|танцую
🕺 dancing man|танцую
👯 party dancers|вечеринка
🧘 yoga meditation|йога медитация
🛌 sleeping bed|сплю
👫 couple|пара
💏 kiss couple|поцелуй
💑 couple heart|пара любовь
👪 family|семья
🗣️ speaking head|говорю
👤 silhouette user|пользователь
👥 users group|группа люди`,
  ],
  [
    'nature',
    'Животные и природа',
    '🐶',
    `🐶 dog puppy|собака щенок пёс
🐱 cat kitten|кошка кот котик
🐭 mouse|мышь
🐹 hamster|хомяк
🐰 rabbit bunny|кролик заяц
🦊 fox|лиса
🐻 bear|медведь
🐼 panda|панда
🐨 koala|коала
🐯 tiger|тигр
🦁 lion|лев
🐮 cow|корова
🐷 pig|свинья
🐸 frog|лягушка
🐵 monkey|обезьяна
🐔 chicken|курица
🐧 penguin|пингвин
🐦 bird|птица
🐤 chick|цыплёнок
🦆 duck|утка
🦅 eagle|орёл
🦉 owl|сова
🦇 bat|летучая мышь
🐺 wolf|волк
🐗 boar|кабан
🐴 horse|лошадь
🦄 unicorn|единорог
🐝 bee|пчела
🐛 bug caterpillar|гусеница жук
🦋 butterfly|бабочка
🐌 snail slow|улитка
🐞 ladybug|божья коровка
🐜 ant|муравей
🕷️ spider|паук
🐢 turtle slow|черепаха
🐍 snake|змея
🦎 lizard|ящерица
🦖 trex dinosaur|динозавр
🐙 octopus|осьминог
🦑 squid|кальмар
🦀 crab|краб
🐠 tropical fish|рыбка
🐟 fish|рыба
🐬 dolphin|дельфин
🐳 whale|кит
🦈 shark|акула
🐊 crocodile|крокодил
🐘 elephant|слон
🦒 giraffe|жираф
🐪 camel|верблюд
🐑 sheep|овца
🐐 goat|коза
🐿️ chipmunk squirrel|белка
🦔 hedgehog|ёж
🐾 paw prints|лапки следы
🌵 cactus|кактус
🎄 christmas tree|ёлка новый год
🌲 evergreen tree|ель дерево
🌳 tree|дерево
🌴 palm tree|пальма
🌱 seedling sprout|росток
🌿 herb|трава
🍀 four leaf clover luck|клевер удача
🍁 maple leaf|клён лист
🍂 fallen leaves autumn|листья осень
🍄 mushroom|гриб
🌷 tulip|тюльпан
🌹 rose|роза
🌻 sunflower|подсолнух
🌸 cherry blossom|сакура цветок
💐 bouquet flowers|букет цветы
🌙 moon crescent night|луна ночь
🌕 full moon|полнолуние
⭐ star|звезда
🌟 glowing star|звезда сияние
✨ sparkles|блёстки искры
⚡ lightning zap|молния
🔥 fire hot lit|огонь пожар жара
🌈 rainbow|радуга
☀️ sun sunny|солнце
⛅ cloud sun|облачно
☁️ cloud|облако
🌧️ rain|дождь
⛈️ storm thunder|гроза
❄️ snowflake snow|снежинка снег
☃️ snowman|снеговик
💧 droplet water|капля вода
🌊 wave ocean sea|волна море
🌍 earth globe world|земля мир планета`,
  ],
  [
    'food',
    'Еда и напитки',
    '🍔',
    `🍏 green apple|яблоко
🍎 apple red|яблоко
🍐 pear|груша
🍊 orange tangerine|апельсин мандарин
🍋 lemon|лимон
🍌 banana|банан
🍉 watermelon|арбуз
🍇 grapes|виноград
🍓 strawberry|клубника
🫐 blueberries|черника
🍒 cherries|вишня черешня
🍑 peach|персик
🥭 mango|манго
🍍 pineapple|ананас
🥥 coconut|кокос
🥝 kiwi|киви
🍅 tomato|помидор
🥑 avocado|авокадо
🍆 eggplant|баклажан
🥔 potato|картошка
🥕 carrot|морковь
🌽 corn|кукуруза
🌶️ hot pepper|перец острый
🥒 cucumber|огурец
🥦 broccoli|брокколи
🧄 garlic|чеснок
🧅 onion|лук
🍞 bread|хлеб
🥐 croissant|круассан
🥨 pretzel|крендель
🧀 cheese|сыр
🥚 egg|яйцо
🍳 cooking fried egg|яичница
🥞 pancakes|блины
🥓 bacon|бекон
🍗 poultry leg chicken|курица ножка
🍖 meat bone|мясо
🌭 hotdog|хот-дог
🍔 burger hamburger|бургер гамбургер
🍟 fries|картошка фри
🍕 pizza|пицца
🥪 sandwich|бутерброд сэндвич
🌮 taco|тако
🌯 burrito|буррито
🥗 salad|салат
🍝 spaghetti pasta|паста спагетти
🍜 ramen noodles|лапша рамен
🍲 stew pot soup|суп
🍣 sushi|суши
🍱 bento|бенто
🥟 dumpling|пельмени
🍤 shrimp|креветка
🍚 rice|рис
🍦 icecream|мороженое
🍩 doughnut donut|пончик
🍪 cookie|печенье
🎂 birthday cake|торт день рождения
🍰 cake shortcake|пирожное торт
🧁 cupcake|кекс
🍫 chocolate|шоколад
🍬 candy|конфета
🍭 lollipop|леденец
🍯 honey|мёд
🥛 milk|молоко
☕ coffee tea hot|кофе чай
🍵 tea|чай
🧃 juice|сок
🥤 cup soda|газировка
🍺 beer|пиво
🍻 beers cheers|пиво тост
🥂 champagne cheers|бокалы тост
🍷 wine|вино
🥃 whisky|виски
🍸 cocktail|коктейль
🍾 champagne bottle|шампанское
🧊 ice|лёд`,
  ],
  [
    'activity',
    'Занятия',
    '⚽',
    `⚽ soccer football|футбол мяч
🏀 basketball|баскетбол
🏈 american football|американский футбол
⚾ baseball|бейсбол
🎾 tennis|теннис
🏐 volleyball|волейбол
🏉 rugby|регби
🎱 billiards|бильярд
🏓 pingpong|пинг-понг
🏸 badminton|бадминтон
🏒 hockey|хоккей
⛳ golf|гольф
🏹 bow arrow|лук стрела
🎣 fishing|рыбалка
🥊 boxing|бокс
🥋 martial arts|единоборства
⛸️ ice skate|коньки
🎿 ski|лыжи
🏂 snowboard|сноуборд
🏋️ weight lifting gym|штанга спортзал
🚴 cycling bike|велосипед
🏊 swimming|плавание
🏆 trophy winner|кубок победа
🥇 gold medal first|золото первое место
🥈 silver medal second|серебро второе место
🥉 bronze medal third|бронза третье место
🏅 medal|медаль
🎫 ticket|билет
🎪 circus|цирк
🎭 theater masks|театр
🎨 art palette paint|рисование искусство
🎬 movie clapper film|кино фильм
🎤 microphone sing karaoke|микрофон караоке
🎧 headphones music|наушники музыка
🎼 score music|ноты
🎹 piano keyboard|пианино
🥁 drum|барабан
🎷 saxophone|саксофон
🎺 trumpet|труба
🎸 guitar|гитара
🎻 violin|скрипка
🎲 dice game|кубик игра
♟️ chess|шахматы
🎯 target bullseye dart|мишень дартс цель
🎳 bowling|боулинг
🎮 video game controller gaming|игра геймпад
🕹️ joystick|джойстик
🧩 puzzle|пазл
🎉 party popper tada celebration|праздник ура хлопушка
🎊 confetti|конфетти
🎈 balloon|шарик
🎁 gift present|подарок
🎀 ribbon|бант`,
  ],
  [
    'travel',
    'Путешествия',
    '🚗',
    `🚗 car|машина автомобиль
🚕 taxi|такси
🚙 suv|джип
🚌 bus|автобус
🚎 trolleybus|троллейбус
🏎️ racing car|гонка болид
🚓 police car|полиция
🚑 ambulance|скорая
🚒 fire engine|пожарная
🚚 truck delivery|грузовик доставка
🚜 tractor|трактор
🛴 scooter|самокат
🚲 bicycle bike|велосипед
🛵 motor scooter|мопед
🏍️ motorcycle|мотоцикл
🚨 siren alert|сирена тревога
🚦 traffic light|светофор
🚧 construction|ремонт стройка
⚓ anchor|якорь
⛵ sailboat|парусник
🚤 speedboat|катер
🚢 ship|корабль
✈️ airplane plane|самолёт
🛫 departure|вылет
🛬 arrival|прилёт
🚁 helicopter|вертолёт
🚀 rocket launch|ракета запуск
🛸 ufo|нло
🚂 locomotive train|поезд паровоз
🚆 train|поезд
🚇 metro subway|метро
🗺️ map|карта
🧭 compass|компас
🏔️ snow mountain|гора
⛰️ mountain|гора
🌋 volcano|вулкан
🏕️ camping|кемпинг поход
🏖️ beach|пляж
🏝️ island|остров
🏠 house home|дом
🏡 garden house|дом сад
🏢 office building|офис здание
🏥 hospital|больница
🏦 bank|банк
🏨 hotel|отель
🏫 school|школа
🏰 castle|замок
🗼 tower|башня
🗽 liberty statue|статуя свободы
⛪ church|церковь
⛲ fountain|фонтан
🎡 ferris wheel|колесо обозрения
🎢 roller coaster|американские горки
🌃 night city|ночь город
🌅 sunrise|рассвет
🌇 sunset|закат
🌉 bridge night|мост`,
  ],
  [
    'objects',
    'Предметы',
    '💡',
    `⌚ watch|часы
📱 phone mobile|телефон смартфон
💻 laptop computer|ноутбук компьютер
⌨️ keyboard|клавиатура
🖥️ desktop computer|компьютер монитор
🖱️ mouse|мышь
💾 floppy save|дискета сохранить
💿 cd disc|диск
📷 camera photo|камера фото
📹 video camera|видеокамера
🎥 movie camera|кинокамера
📞 telephone call|звонок телефон
☎️ phone|телефон
📺 tv television|телевизор
📻 radio|радио
🎙️ studio microphone podcast|микрофон подкаст
⏰ alarm clock|будильник
⏳ hourglass waiting|песочные часы ждать
🔋 battery|батарея
🔌 plug|вилка розетка
💡 bulb idea|лампочка идея
🔦 flashlight|фонарик
🕯️ candle|свеча
💸 money flying|деньги трата
💵 dollar banknote|доллар деньги
💰 money bag|деньги мешок
💳 credit card|карта оплата
💎 gem diamond|алмаз бриллиант
⚖️ scales justice|весы
🔧 wrench tool|гаечный ключ
🔨 hammer|молоток
🛠️ tools|инструменты
⛏️ pick|кирка
🔩 nut bolt|болт
⚙️ gear settings|шестерёнка настройки
🧱 brick|кирпич
⛓️ chains|цепь
🧲 magnet|магнит
💣 bomb|бомба
🔪 knife|нож
🗡️ dagger|кинжал
⚔️ swords|мечи
🛡️ shield|щит
🔮 crystal ball|шар предсказание
💊 pill medicine|таблетка лекарство
💉 syringe vaccine|шприц прививка
🧬 dna|днк
🔬 microscope|микроскоп
🔭 telescope|телескоп
🧹 broom|метла
🧻 toilet paper|туалетная бумага
🛁 bathtub|ванна
🔑 key|ключ
🗝️ old key|ключ старый
🚪 door|дверь
🛋️ couch sofa|диван
🛏️ bed|кровать
🧸 teddy bear|мишка игрушка
🖼️ picture frame|картина
🛒 shopping cart|корзина покупки
✉️ envelope mail|письмо конверт
📧 email|почта
📦 package box|посылка коробка
📫 mailbox|почтовый ящик
📝 memo note|заметка записка
📄 document page|документ страница
📅 calendar date|календарь
📊 bar chart stats|график статистика
📈 chart up growth|рост график
📉 chart down|падение график
📋 clipboard|буфер планшет
📌 pin pushpin|закреп кнопка
📎 paperclip attachment|скрепка вложение
✂️ scissors cut|ножницы
🖊️ pen|ручка
✏️ pencil edit|карандаш
🔍 search magnifier|поиск лупа
🔒 lock locked|замок закрыто
🔓 unlock|открыто
📚 books|книги
📖 book open read|книга читать
🔔 bell notification|колокольчик уведомление
🔕 bell mute|без звука
📣 megaphone|мегафон
📢 loudspeaker announcement|объявление
💬 speech balloon chat|сообщение чат
💭 thought|мысль
🗯️ anger bubble|злость`,
  ],
  [
    'symbols',
    'Символы',
    '❤️',
    `❤️ heart love red|сердце любовь
🧡 orange heart|оранжевое сердце
💛 yellow heart|жёлтое сердце
💚 green heart|зелёное сердце
💙 blue heart|синее сердце
💜 purple heart|фиолетовое сердце
🖤 black heart|чёрное сердце
🤍 white heart|белое сердце
🤎 brown heart|коричневое сердце
💔 broken heart|разбитое сердце
❣️ heart exclamation|сердце
💕 two hearts|сердечки
💞 revolving hearts|сердечки
💓 beating heart|сердцебиение
💗 growing heart|сердце
💖 sparkling heart|сердце блеск
💘 cupid arrow|купидон
💝 heart ribbon|сердце подарок
💯 hundred perfect 100|сто идеально
💢 anger|злость
💥 boom collision|бум взрыв
💫 dizzy star|головокружение
💦 sweat drops|капли брызги
💨 dash wind fast|ветер быстро
🕳️ hole|дыра
💤 zzz sleep|сон
✅ check yes done|готово да галочка
☑️ checkbox|галочка
✔️ check mark|галочка
❌ cross no wrong|нет крестик ошибка
❎ cross mark button|крестик
➕ plus|плюс
➖ minus|минус
➗ divide|деление
✖️ multiply|умножение
❓ question|вопрос
❔ white question|вопрос
❗ exclamation|восклицание
❕ white exclamation|восклицание
‼️ double exclamation|восклицание
⁉️ interrobang|вопрос восклицание
⚠️ warning|внимание предупреждение
⛔ no entry|запрещено
🚫 prohibited forbidden|запрещено нельзя
🔞 under eighteen|восемнадцать
♻️ recycle|переработка
🆗 ok button|ок
🆕 new|новое
🆒 cool|круто
🆘 sos help|помощь
🔴 red circle|красный круг
🟠 orange circle|оранжевый круг
🟡 yellow circle|жёлтый круг
🟢 green circle|зелёный круг
🔵 blue circle|синий круг
🟣 purple circle|фиолетовый круг
⚫ black circle|чёрный круг
⚪ white circle|белый круг
🔶 orange diamond|ромб
🔷 blue diamond|ромб
▶️ play|играть
⏸️ pause|пауза
⏹️ stop|стоп
⏺️ record|запись
⏭️ next track|следующий
🔀 shuffle|перемешать
🔁 repeat|повтор
🔄 refresh arrows|обновить
⬆️ up arrow|вверх
⬇️ down arrow|вниз
⬅️ left arrow|влево
➡️ right arrow|вправо
↩️ reply return|ответ назад
🔝 top|топ
🔜 soon|скоро
♈ aries|овен
♉ taurus|телец
♊ gemini|близнецы
♋ cancer|рак
♌ leo|лев
♍ virgo|дева
♎ libra|весы
♏ scorpio|скорпион
♐ sagittarius|стрелец
♑ capricorn|козерог
♒ aquarius|водолей
♓ pisces|рыбы
☮️ peace|мир
☯️ yin yang|инь ян
🎵 music note|музыка нота
🎶 notes music|музыка ноты
©️ copyright|копирайт
®️ registered|зарегистрировано
™️ trademark|торговая марка
🔟 ten|десять
#️⃣ hash number|решётка
*️⃣ asterisk|звёздочка
0️⃣ zero|ноль
1️⃣ one|один
2️⃣ two|два
3️⃣ three|три`,
  ],
  [
    'flags',
    'Флаги',
    '🏁',
    `🏁 checkered finish|финиш
🚩 red flag|флаг
🏳️ white flag surrender|белый флаг
🏴 black flag|чёрный флаг
🏳️‍🌈 rainbow flag pride|радуга флаг
🏴‍☠️ pirate|пиратский
🇷🇺 russia ru|россия
🇺🇦 ukraine ua|украина
🇧🇾 belarus by|беларусь
🇰🇿 kazakhstan kz|казахстан
🇺🇸 usa us america|сша америка
🇬🇧 uk britain gb|британия англия
🇩🇪 germany de|германия
🇫🇷 france fr|франция
🇮🇹 italy it|италия
🇪🇸 spain es|испания
🇵🇱 poland pl|польша
🇹🇷 turkey tr|турция
🇨🇳 china cn|китай
🇯🇵 japan jp|япония
🇰🇷 korea kr|корея
🇮🇳 india in|индия
🇧🇷 brazil br|бразилия
🇨🇦 canada ca|канада
🇦🇺 australia au|австралия
🇬🇪 georgia ge|грузия
🇦🇲 armenia am|армения
🇺🇿 uzbekistan uz|узбекистан
🇮🇱 israel il|израиль
🇪🇺 european union eu|евросоюз`,
  ],
];

let parsed: EmojiCategory[] | null = null;

/** Категории разбираются один раз — при первом открытии палитры */
export function emojiCategories(): EmojiCategory[] {
  if (!parsed)
    parsed = RAW.map(([id, name, icon, data]) => ({
      id,
      name,
      icon,
      emojis: data.split('\n').map((line) => {
        const space = line.indexOf(' ');
        const [en, ru] = line.slice(space + 1).split('|');
        const keywords = `${en} ${ru}`.split(' ').filter(Boolean);
        return { char: line.slice(0, space), name: en.split(' ')[0], keywords };
      }),
    }));
  return parsed;
}

/** Поиск по словам на любом из языков: каждое слово запроса — начало какого-то ключевого слова */
export function searchEmoji(query: string): Emoji[] {
  const words = query.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const norm = (k: string) => k.toLowerCase().replace(/ё/g, 'е');
  const out: Emoji[] = [];
  for (const cat of emojiCategories())
    for (const e of cat.emojis) {
      const keys = e.keywords.map(norm);
      if (words.every((w) => e.char === w || keys.some((k) => k.startsWith(w)))) out.push(e);
    }
  return out;
}

export function findEmoji(char: string): Emoji | undefined {
  for (const cat of emojiCategories()) {
    const e = cat.emojis.find((x) => x.char === char);
    if (e) return e;
  }
  return undefined;
}

// ── Недавние: localStorage этого браузера ──

const RECENT_KEY = 'vicinity.emoji.recent';
const RECENT_MAX = 24;

export function recentEmoji(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(char: string) {
  const list = [char, ...recentEmoji().filter((x) => x !== char)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* приватный режим — недавние не сохраняются */
  }
}
