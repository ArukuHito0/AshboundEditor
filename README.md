# ASHBOUND バランス調整エディター

本編の指定コミットから、試遊に使う JavaScript と CSS を取り込めます。試遊画面の読み込み順は本編の `dist/index.html` に従います。調整画面、調整値の適用、試遊時の保存の分離はエディター側のコードが担当します。

## 本編を更新する

Node.js と Git を用意し、エディターのリポジトリのルートから実行します。本編のチェックアウトには対象コミットが必要です。

```sh
node scripts/import-game.mjs ../RogueLightDeckBuilding <本編コミットの40桁のSHA>
node scripts/build-worker.mjs
```

取り込んだ本編のコミットは `game-source.json` に記録されます。生成した差分を確認し、調整画面のカード・敵の一覧、試遊の開始と効果処理を検証してから反映します。このコマンドによる変更はローカルファイルに保存されます。

[本編リポジトリ](https://github.com/ArukuHito0/RogueLightDeckBuilding)
