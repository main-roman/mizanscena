# Модели людей

Шесть персонажей из наборов Ultimate Modular Men и Ultimate Modular Women, автор Quaternius (https://quaternius.com), скачаны с https://poly.pizza.
Наборы распространяются по лицензии CC0; на Poly Pizza часть женских моделей помечена CC-BY, поэтому автора нужно указывать: Quaternius.

- m1 Casual Character, m2 Hoodie Character, m3 Business Man
- f1 Animated Woman, f2 Suit, f3 Worker

У всех общий скелет (кости UpperLeg, LowerLeg, Foot и другие) и поза Idle_Neutral, которую берёт приложение.
Чтобы добавить типаж, положите сюда файл `имя.glb` на том же скелете и допишите его в `LOOKS` в `shapes.js` и в `TOP` в `view3d.js`.

## Сканы реальных людей (r1, r2, r3)

Папки `rp_eric`, `rp_carla`, `rp_claudia`: модели Renderpeople со Sketchfab, лицензия CC BY 4.0, при показе работы нужно указывать автора.

- «Eric Rigged 001 - Rigged 3D Business Man» (https://sketchfab.com/3d-models/a46bc9f67aaa415bb4f3241eef900e7f) by Renderpeople
- «Carla Rigged 001 - Rigged 3D Business Women» (https://sketchfab.com/3d-models/acf520f450d14dd799f98a6fede3edf5) by Renderpeople
- «Claudia Rigged 002 - 3D Rigged Business Women» (https://sketchfab.com/3d-models/c659bd0accab47c6bbe390cf822a2b92) by Renderpeople

Фактуры уменьшены с 8K до 2K. Модели приходят в позе «руки в стороны», приложение само опускает руки и сажает фигуру (`poseScan` в `view3d.js`). Цвет одежды у них свой, из скана.
