# ASHBOUND バランス調整エディター

本編の指定コミットから、試遊に使う JavaScript と CSS を取り込めます。試遊画面の読み込み順は本編の `dist/index.html` に従います。調整画面、調整値の適用、試遊時の保存の分離はエディター側のコードが担当します。

## 本編を更新する

Node.js と Git を用意し、エディターのリポジトリのルートから実行します。本編のチェックアウトには対象コミットが必要です。新しくクローンしたエディターでも、取り込みを実行してからビルドします。

```sh
node scripts/import-game.mjs ../RogueLightDeckBuilding 932a66f19e74fe8e09e66cc036eb2ca69d4a9a2a
node scripts/build-worker.mjs
```

例の SHA は試遊開始まで確認した本編コミットです。取り込んだ本編アセットと `play.html`、取り込み元を記録する `game-source.json` はローカルに生成されます。Sites 用の成果物を作るときも同じ手順で生成してからビルドします。

[本編リポジトリ](https://github.com/ArukuHito0/RogueLightDeckBuilding)
