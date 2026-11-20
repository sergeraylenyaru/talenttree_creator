# Локальная арена / Local Training Arena

## Файлы и запуск

Помести свои экспорты в игнорируемый каталог `local-assets/wow/`. Сохрани регистр имён.

| Назначение / Role | Файл / Path |
| --- | --- |
| Герой / Hero | `character/hero.glb` |
| Помещение / Environment | `world/guildhouseb.glb` |
| Манекен / Target | `targets/Training-dummy.glb` |
| Меч / Weapon | `weapons/sword-one-hand.glb` |
| Настройки / Manifest | `manifest.json` |

В PowerShell из корня репозитория:

```powershell
npm.cmd ci
npm.cmd run build:world
$env:TALENT_LOCAL_WOW_ASSETS = "1"
$env:HOST = "127.0.0.1"
python server.py
```

Открой [http://127.0.0.1:8000](http://127.0.0.1:8000) и тренировочную площадку. Раздел **Диагностика ассетов** показывает состояния загрузки и ошибки по ролям. JSON-отчёт содержит доступные клипы, границы, количество мешей, текстур, материалов, и суставов. Локальные экспорты раздаются только по прямому loopback-запросу при явно включённом режиме.

## Профиль для проверенных экспортов гильдхауса

[Пример манифеста](../static/world/assets/guildhouse-training.example.json) рассчитан на четыре локальных GLB из приватного репозитория. Сохрани текущие настройки отдельно и установи пример как `local-assets/wow/manifest.json`. Файлы моделей и текстур остаются в этом игнорируемом каталоге. Сервер по-прежнему раздаёт их только при `TALENT_LOCAL_WOW_ASSETS=1` и привязке к loopback.

- Экспорт героя смотрит вдоль +X. Поворот 90° переводит это направление в −Z контроллера. У `bone_WeaponR` есть смещение от ладони в клипах без оружия. Пример использует анимированный `bone_HandR`. Лезвие меча идёт вдоль +X модели, центр рукояти близок к (0, 0, −0.008). Смещение и углы сопоставляют ось рукояти с линией между суставами указательного пальца и мизинца. `gripClip` берёт повороты пальцев правой руки из `Attack1H`, сохраняя анимацию кисти и руки. Свойства `attachmentBone`, `position`, `rotation` (XYZ в градусах) и `scale` доступны в манифесте, трансформацию можно уточнить в калибровке оружия и скачать.
- Экспорт содержит два жёстких меша наплечников в начале координат. `rigidAttachments` перемещает их на кости плеч до расчёта высоты героя. Смещения взяты из точек крепления верхней руки в исходном скелете.
- Высота пола −0.0545 измерена по горизонтальным треугольникам помещения. Объёмы северной и западной стены, выступов, стола и потолка размечены отдельно по сечениям мешей. Профиль покрывает один участок этажа. Лестницы, подвал и остальные этажи требуют отдельной разметки.
- Флажок **Отладка сцены** включает координаты, поворот, клип, параметры меча, пол, коллизионные объёмы, состояние камеры и расстояние до манекена. `debug` в манифесте задаёт начальное состояние. Флажок можно менять во время игры.

Для проверки с настоящими GLB после сборки модуля запусти `python tests/real_guildhouse_browser.py /path/outside/checkout`. Нужны Playwright, Chromium и установленный профиль. Сценарий использует тестовый набор способностей и настоящие локальные GLB. `tests/browser_local_arena.py` отдельно проверяет синтетические модели и резервные сценарии.

## Настройка манифеста

Сохрани настройки своего героя. Добавь объекты `environment`, `target` и `weapons.mainHand` по необходимости. Значения ниже демонстрируют формат. Координаты помещения нужно измерить для твоего экспорта.

```json
{
  "model": "character/hero.glb",
  "scale": 1,
  "rotation": 180,
  "heightOffset": 0,
  "debug": true,
  "animations": {
    "idle": "Stand (ID 0 variation 0)",
    "walk": "Walk (ID 4 variation 0)",
    "run": "Run (ID 5 variation 0)",
    "walkBack": "Walkbackwards (ID 13 variation 0)",
    "runBack": "RunBackwards (ID 1146 variation 0)",
    "strafeLeft": "ShuffleLeft (ID 11 variation 0)",
    "strafeRight": "ShuffleRight (ID 12 variation 0)",
    "jump": "Jump (ID 38 variation 0)",
    "fall": "Fall (ID 40 variation 0)",
    "meleeAttack": "Attack1H (ID 17 variation 0)",
    "spellCast": "SpellCastDirected (ID 53 variation 0)"
  },
  "playerSpawn": {"x": 0, "z": 3},
  "environment": {
    "model": "world/guildhouseb.glb",
    "scale": 1, "rotation": 0, "position": {"x": 0, "y": 0, "z": 0},
    "ground": {"minX": -4, "maxX": 4, "minZ": -4, "maxZ": 4, "y": 0},
    "walls": []
  },
  "target": {
    "model": "targets/Training-dummy.glb",
    "scale": 1, "rotation": 0, "position": {"x": 0, "z": -2}
  },
  "weapons": {
    "mainHand": {
      "model": "weapons/sword-one-hand.glb",
      "attachmentBone": "bone_WeaponR", "enabled": true,
      "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": 1
    }
  }
}
```

1. Открой гильдхаус в Blender или glTF-просмотрщике. Найди внутреннюю ровную площадку. Перенеси её границы и высоту пола в координаты сцены **после** применения масштаба, поворота и позиции из `environment`. При необходимости задай боксы стен в `walls`. Каждый бокс принимает `minX`, `maxX`, `minZ`, `maxZ`, `minY` и `maxY`. Встроенная сцена используется при ошибке загрузки или непригодном прямоугольнике.
2. Выставь точки героя и манекена внутри пола. Координата Y обеих точек берётся из `ground.y`. Попадание в стену, в манекен или за пределы прямоугольника приводит к поиску свободной точки. Проверь отметки в режиме `debug`, границы помещения и стрелку вперёд.
3. В **Калибровке оружия** проверь выбранный узел, сдвиг XYZ, поворот XYZ в градусах и масштаб. Кнопка **Скачать манифест** сохраняет текущие значения в JSON. Скопируй файл в `local-assets/wow/manifest.json`, чтобы они сохранились при следующем запуске. Если меч уже запечён в герое, установи `enabled: false`.
4. Пройди к манекену, проверь прыжок и посадку, ближнее и дальнее попадание, крит, восстановление цели и повторный вход. Для манекена можно переопределить точные имена `target.animations.idle`, `hit`, `criticalHit`. Без переопределения используются имена Stand, CombatWound и CombatCritical с идентификаторами wow.export.

## English

Keep your character-only manifest as-is and add the optional sections above. Run the PowerShell commands and open Training Grounds from localhost. Asset Diagnostics shows per-role loading or fallback status and downloads a local JSON report with clip names, mesh and material counts, rig details and bounds.

Measure an interior floor rectangle in the exported environment after its configured transform. Enter its world-space floor elevation in `environment.ground.y`, and add wall boxes for movement, camera collision and combat line of sight. Configure separate player and target X/Z spawns. Debug mode displays bounds, floor, walls, spawn markers, axes and the controller forward arrow. A single flat rectangular floor is supported. Stairs and mesh-wide automatic collision extraction are outside this setup.

The existing hero rig and mixer remain in use. Optional directional clip mappings enable backward movement and strafing poses. Set `meleeAttack` or `spellCast` to a different exported clip to use that clip. The target plays idle and impact reactions from its own rig. Weapon attachment defaults to `bone_WeaponR` and falls back to `bone_HandR`. Debug calibration exports an updated manifest that you can install locally. Set the weapon's `enabled` flag to false if the hero already includes the mesh.

The repository contains synthetic test models generated in tests. Check the actual exported environment, collision proxy and attachment transform on the machine that holds the game exports.

## Оформление способностей в бою

В редакторе способности раскрой **Оформление в бою**. Пресеты подбирают клипы, тип доставки, визуальные эффекты и звук. Урон, лечение, стоимость и перезарядка по-прежнему настраиваются в существующих полях редактора. Нулевая дальность выбирает стандарт профиля. Для ближнего боя это 2 м, для дальнего — 30 м, для области — 8 м. Защитный пресет даёт анимацию блока и эффект, а перемещение использует прыжок героя. Способность области проверяет расстояние и видимость единственного манекена вокруг героя без предварительного выбора цели.

Поле **Поддержание, сек.** добавляет отдельную фазу после подготовки. Эффект срабатывает один раз при завершении поддержания. Применение можно отменить кнопкой или клавишей Escape. Отмена или потеря допустимой цели до выпуска оставляет ресурс и перезарядку без изменений. После выпуска снаряд проверяет столкновение с моделью цели и препятствиями. Урон при попадании рассчитывает прежний боевой модуль.

Звуки синтезируются в браузере при ручном применении, если браузер разрешил звук. Цвета, импульсы и кольца создаются процедурно. Направленные, поддерживаемые и оружейные клипы берутся из установленной локальной модели, при отсутствии клипа применяется запасной вариант.

## Исследование гильдхауса и полноэкранный интерфейс

Установленный профиль гильдхауса включает `environment.exploration`. В режиме исследования одна капсула персонажа взаимодействует с треугольной коллизией модели, поднимается по ступеням и опирается на ближайшую доступную поверхность на текущей высоте. Камера и боевые лучи проверяют ту же геометрию. У старых манифестов по-прежнему работает профиль с прямоугольным полом и объёмами стен.

Из тренировочного зала западная лестница ведёт на верхнюю галерею. Выход с первого этажа проходит на юго-восток через входной пролёт и существующую мостовую. За ней находится процедурная территория около 152 × 152 единиц, с дорожками, рельефом, отрисованными пакетами декораций и видимой границей. Внешний декор служит ориентиром. Геометрия дороги, здания и рельефа участвует в коллизиях.

На настольном экране 3D-режим открывается на весь экран приложения. WASD — бег, Shift — ходьба, Space — прыжок. Потяни мышью по сцене для поворота камеры и используй колесо для приближения. Выбери манекен щелчком. Нажми **Базовая атака** в ближнем бою либо выбери способность клавишей **1–9** или мышью. **Назначить ячейки** сохраняет раскладку в браузере. Если у класса ещё нет боевых эффектов, первые три ячейки занимают учебные способности. Учебный набор существует только в сеансе и не записывается в класс.

Игровые панели показывают локальные портреты из GLB, уровень тренировочной сцены, здоровье и основной ресурс. **Журнал боя** открывает статистику и события поверх сцены. При наличии GLB запусти `python tests/real_exploration_browser.py /путь/для/кадров` для проверки исследования и игрового интерфейса.
