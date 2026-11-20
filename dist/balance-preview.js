// Keep test-play saves in memory and disable cloud-save requests.
const balancePreviewStorage = new Map();
const localStorage = {
  getItem: key => balancePreviewStorage.get(key) ?? null,
  setItem: (key, value) => balancePreviewStorage.set(key, String(value)),
  removeItem: key => balancePreviewStorage.delete(key),
};
const fetch = () => Promise.resolve(new Response(null, {status: 401}));

window.addEventListener('load', () => {
  window.parent.postMessage({
    type: 'ashbound-balance-ready',
    snapshot: document.documentElement.dataset.balanceSnapshot === 'true',
    catalog: balanceDefaults,
    characters: Object.values(CHARACTERS).map(({id,name})=>({id,name,starter:[...S.characterProfiles[id].deck]})),
    testCards: C.filter(card=>card?.id>=0&&!card.retired&&!card.fx?.unplayable)
      .map(({id,name,characterId,runOnly})=>({id,name,characterId:runOnly?(characterId??'wanderer'):null})),
    limits: balanceLimits,
    weightGroups: balanceWeightGroups,
  }, location.origin);
});

window.addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== location.origin || event.data?.type !== 'ashbound-balance-play') return;
  try {
    balanceApply(event.data.settings);
    const act = event.data.act;
    if (!Number.isInteger(act) || act < 1 || act > 7) throw Error('ACTを選択してください。');
    const {character,deck}=event.data;
    if(!Object.hasOwn(CHARACTERS,character)) throw Error('探索者を選択してください。');
    if(!Array.isArray(deck)||!deck.length||deck.some(id=>{
      const card=C[id];
      return !Number.isInteger(id)||id<0||!card||card.retired||card.fx?.unplayable||
        (card.runOnly&&(card.characterId??'wanderer')!==character);
    })) throw Error('使用できるカードを1枚以上選択してください。');
    const basicCounts=new Map();
    let basicTotal=0;
    for(const id of deck) {
      const card=C[id];
      if(card.runOnly) continue;
      basicTotal++;
      const count=(basicCounts.get(card.name)??0)+1;
      if(count>3) throw Error('同名の基礎カードは3枚までです。');
      basicCounts.set(card.name,count);
    }
    if(basicTotal<10) throw Error('基礎カードを10枚以上入れてください。');
    selectCharacter(character);
    S.clearedActs = [1, 2, 3, 4, 5, 6];
    S.destinationAct = act;
    startSelectedCharacter();
    if (!S.run || S.run.act !== act) throw Error('ACT' + act + 'を開始できませんでした。');
    S.run.deck=[...deck];
    if (act === 7 && event.data.group === 'pairs') S.run.goldFights = 3;
    choose(event.data.group === 'boss' ? 'boss' : event.data.group === 'elite' ? 'elite' : 'fight');
    if (S.run.mode !== 'battle') throw Error('戦闘を開始できませんでした。');
    window.parent.postMessage({type: 'ashbound-balance-playing'}, location.origin);
  } catch (error) {
    window.parent.postMessage({type: 'ashbound-balance-error', message: error.message}, location.origin);
  }
});
