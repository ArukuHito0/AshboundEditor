const groups = {cards: 'カード', enemyActions: '敵', solo: '通常・単体', pairs: '通常・複数'};
const byId = id => document.getElementById(id);
const status = message => { byId('status').textContent = message; };
const frame = byId('game');
let live = globalThis.ASHBOUND_BALANCE_SETTINGS;
const draftKey = 'ashbound-balance-draft-v1';
let settings = {...structuredClone(live), cardEffects: {...live.cardEffects}};
let catalog;
let limits;
let weightGroups;
let weightPoolByRow;
let playRequest;
let previewTimer;
const cardFilters = {
  potentialOwner: row => [row.basic ? '基礎カード' : row.potentialOwner],
  keywords: row => row.keywords,
  cost: row => [String(live.cards[row.id] ?? row.value ?? 'X')],
  types: row => row.types,
  rarity: row => [row.rarity],
};
const normalizeName = name => name.trim().normalize('NFKC').toLocaleLowerCase();

const rarityLabels = {common:'コモン', rare:'レア', epic:'エピック', token:'トークン'};

function setupCardFilters() {
  for (const [id, valuesOf] of Object.entries(cardFilters)) {
    const values = [...new Set(catalog.cards.flatMap(valuesOf).filter(Boolean))];
    if (id === 'potentialOwner') values.sort((a, b) => Number(b === '基礎カード') - Number(a === '基礎カード'));
    if (id === 'cost') values.sort((a, b) => (a === 'X' ? Infinity : Number(a)) - (b === 'X' ? Infinity : Number(b)));
    if (id === 'keywords' || id === 'types') values.sort((a, b) => a.localeCompare(b, 'ja'));
    const select = byId(id);
    select.length = 1;
    for (const value of values) select.add(new Option(id === 'rarity' ? rarityLabels[value] : value, value));
  }
}

let group = 'cards';

const isWeight = () => group === 'solo' || group === 'pairs';
const valueOf = (config, row) => config[group][row.id] ?? row.value;
let resolveEffect;
let normalizePublishedSettings;
const effectValue = (config, field) => resolveEffect?.(config.cardEffects ?? {},field) ?? config.cardEffects?.[field.id] ?? field.value;
const effectChanged = field => effectValue(settings, field) !== effectValue(live, field);
const changed = row => valueOf(settings, row) !== valueOf(live, row) ||
  (row.effects ?? []).some(field=>!field.hidden&&effectChanged(field));
const effectFields = new Map();

const cardTextPatterns = {
  bleedRepeat: /発動回数\+(\d+)/gu, bleedDecay: /減少量\+(\d+)/gu,
  evolutionStrengthInterval: /カードが(\d+)回進化/gu, evolutionStrength: /筋力(\d+)/gu,
  beastHunt: /HPを(\d+)失い/gu, beastHuntBleed: /裂傷(\d+)を付与/gu,
  forge: /ダメージ\+(\d+)/gu, passionHp: /HPを(\d+)失い/gu,
  passionBlock: /(\d+)ブロックを得る/gu, engineBlock: /(\d+)ブロックを得る/gu,
  d: /(-?\d+)\s*ダメージ/gu, h: /ダメージを\s*(\d+)\s*回/gu,
  b: /(-?\d+)\s*ブロック|ブロック\s*(\d+)/gu,
  s: /筋力\s*[+＋]?\s*(\d+)/gu, agility: /(?:守護|敏捷)\s*[+＋]?\s*(-?\d+)/gu,
  p: /毒(?:を)?\s*(\d+)/gu, bleed: /裂傷(?:を)?\s*(\d+)/gu,
  vulnerable: /脆弱(?:を)?\s*(\d+)/gu, plate: /プレート(?:を)?\s*(\d+)/gu,
  thorns: /棘(?:を)?\s*(\d+)/gu, energy: /エナジー\s*[+＋]?\s*(\d+)/gu,
  heal: /HP(?:を)?\s*(\d+)\s*回復/gu, hpLoss: /HP(?:を)?\s*(\d+)\s*失/gu,
  draw: /(\d+)\s*枚(?:のカードを|カードを)?(?:引|ドロー)/gu,
  slot: /スロット\s*(\d+)/gu, strMultiplier: /筋力を\s*(\d+)\s*倍/gu,
  nextAttack: /ダメージを?\s*[+＋]\s*(\d+)/gu,
  nextBlock: /次のターン[^。]*?(\d+)\s*ブロック/gu,
  chooseExhaust: /(?:手札|カード)[^。]*?(\d+)\s*枚[^。]*?除外/gu,
  discard: /(\d+)\s*枚(?:選んで)?捨て/gu,
  evolutionDiscount: /コスト[-−]\s*(\d+)/gu,
  damageReduction: /(\d+(?:\.\d+)?)%/gu, lowHpOnly: /HP[^。]*?(\d+(?:\.\d+)?)%/gu,
};
const scriptedTextKeys = {baseDamage:'d', hitDamage:'d', slotDamage:'d', pokerDamage:'d', turnDamage:'d',
  successBlock:'b', matchBlock:'b', failBlock:'b', foldBlock:'b', pokerEnergy:'energy',
  pokerStrength:'s', successStrength:'s', drawStrength:'s', extraDraw:'draw', energyMultiplier:'strMultiplier'};
const percentTextKeys = new Set(['damageReduction','lowHpOnly']);

function cardEffectPreview(row) {
  const description = row.detail;
  const replacements = new Map();
  const pending = [];
  const entries = row.effects.filter(field => !field.hidden && effectValue(settings, field) !== field.value);
  // Resolve the more specific clauses before matching their generic counterparts.
  entries.sort((a, b) => Number(['d', 'b'].includes(a.key)) - Number(['d', 'b'].includes(b.key)));
  for (const field of entries) {
    const key = field.key ?? scriptedTextKeys[field.id.split('script.')[1]];
    const percent = percentTextKeys.has(key);
    const value = effectValue(settings, field);
    let matched = false;
    const pattern = cardTextPatterns[key];
    for (const match of pattern ? description.matchAll(pattern) : []) {
      const token = match.slice(1).find(part => part !== undefined);
      const index = match.index + match[0].lastIndexOf(token);
      const expected = percent ? Number((field.value * 100).toFixed(8)) : field.value;
      if (Number(token) !== expected || replacements.has(index)) continue;
      replacements.set(index, {token, value: percent ? Number((value * 100).toFixed(8)) : value});
      matched = true;
      break;
    }
    if (!matched) pending.push(field.label + ' ' + value);
  }
  let updated = description;
  for (const [index, {token, value}] of [...replacements].sort((a, b) => b[0] - a[0])) {
    updated = updated.slice(0, index) + value + updated.slice(index + token.length);
  }
  return {updated, pending};
}

let renderCardKeywords;
function appendCardPreview(cell, row) {
  const article = document.createElement('article');
  article.className = 'card-preview';
  article.dataset.rarity = row.rarity;
  const cost = document.createElement('span');
  cost.className = 'preview-cost';
  const art = document.createElement('div');
  art.className = 'preview-art';
  art.setAttribute('aria-hidden', 'true');
  // Artwork is the SVG or glyph registered in the same-origin game catalog.
  art.innerHTML = row.art ?? '';
  const types = document.createElement('div');
  types.className = 'preview-types';
  types.textContent = row.previewType;
  if (row.latent) {
    const badge = document.createElement('span');
    badge.className = 'preview-latent';
    badge.textContent = '潜在';
    article.append(badge);
  }
  if (row.evolution) {
    const badge = document.createElement('span');
    badge.className = 'preview-evolution';
    badge.textContent = '進化';
    article.append(badge);
  }
  const name = document.createElement('h3');
  name.textContent = row.name;
  const effect = document.createElement('p');
  effect.className = 'preview-effect';
  const supplemental = document.createElement('p');
  supplemental.className = 'preview-adjusted-effects';
  article.append(cost, art, types, name, effect, supplemental);
  cell.append(article);
}

function updateCardPreview(cell, row) {
  cell.querySelector('.preview-cost').textContent = row.unplayable ? '—' : valueOf(settings, row) ?? 'X';
  const {updated, pending} = cardEffectPreview(row);
  const effect = cell.querySelector('.preview-effect');
  if (effect.dataset.description !== updated) {
    effect.dataset.description = updated;
    effect.innerHTML = renderCardKeywords(updated);
  }
  const supplemental = cell.querySelector('.preview-adjusted-effects');
  supplemental.hidden = pending.length === 0;
  supplemental.textContent = pending.length ? '調整効果　' + pending.join(' / ') : '';
}

function appendCardValue(cell, label, value, effectId) {
  const item = document.createElement('div');
  item.className = 'card-field';
  const number = document.createElement('span');
  number.className = 'card-field-value';
  number.textContent = value;
  if (effectId !== undefined) number.dataset.effectId = effectId;
  item.append(label, number);
  cell.append(item);
}

function appendEffectInputs(adjustment, published, difference, row) {
  const hasExplicitHits = /\d+\s*ダメージを\s*\d+\s*回/u.test(row.detail.normalize('NFKC'));
  for (const field of row.effects) {
    if (field.hidden) continue;
    if (field.key === 'h' && !hasExplicitHits) continue;
    const label = document.createElement('label');
    label.className = 'card-field';
    label.textContent = field.label;
    label.title = '公開設定 ' + effectValue(live, field);
    const input = document.createElement('input');
    input.type = 'number';
    input.min = field.min;
    input.max = field.max;
    input.step = field.step;
    input.value = effectValue(settings, field);
    input.setAttribute('aria-label', row.name + 'の' + field.label);
    input.addEventListener('input', () => {
      const value = input.value === '' && !input.validity.badInput
        ? effectValue(live, field) : input.valueAsNumber;
      if (!balanceNumberValid(field, value)) {
        status('入力できる範囲は ' + field.min + '〜' + field.max + ' です。');
        return;
      }
      const linkedKey = {beastHunt:'beastHuntBleed',bleedRepeat:'bleedDecay'}[field.key];
      const linked = row.effects.find(effect=>effect.key===linkedKey);
      const linkedBefore = linked && effectValue(settings,linked);
      delete settings.cardEffects[field.id];
      if (value !== effectValue(settings,field)) settings.cardEffects[field.id] = value;
      if(linked && linkedBefore!==effectValue(settings,linked)) settings.cardEffects[linked.id]=linkedBefore;
      status('変更しました。下書きを保存できます。');
      updateDifferences();
    });
    input.addEventListener('change', () => {
      input.value = effectValue(settings, field);
      if (byId('changes').checked && !changed(row)) showRows();
    });
    label.append(input);
    adjustment.append(label);
    appendCardValue(published, field.label, effectValue(live, field));
    appendCardValue(difference, field.label, '', field.id);
  }
}

function balanceNumberValid(field, value) {
  return !!field && Number.isFinite(value) && value >= field.min && value <= field.max &&
    (field.step !== 1 || Number.isSafeInteger(value));
}
function validate(config) {
  if (config?.version !== 1) throw Error('下書きの形式を確認してください。');
  for (const [key, rows] of Object.entries(catalog)) {
    if (key === 'enemyActions' && config[key] === undefined) config[key] = {};
    const values = config[key];
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw Error('設定項目が不足しています。');
    const [min, max] = limits[key];
    for (const [id, value] of Object.entries(values)) {
      if (key === 'cards' && !rows.some(row => row.id === id)) { delete values[id]; continue; }
      if (!rows.some(row => row.id === id && row.value !== null) || !Number.isSafeInteger(value) || value < (rows.find(row => row.id === id)?.min ?? min) || value > (rows.find(row => row.id === id)?.max ?? max)) {
        throw Error('無効なIDまたは数値が含まれています。');
      }
    }

  }
  if (weightGroups.some(rows => rows.every(row => (config[row.key][row.id] ?? row.value) === 0))) {
    throw Error('同じ遭遇枠の重みをすべて0にはできません。');
  }
  config.cardEffects ??= {};
  if (!config.cardEffects || typeof config.cardEffects !== 'object' || Array.isArray(config.cardEffects)) {
    throw Error('カード効果の形式を確認してください。');
  }
  for (const [id, value] of Object.entries(config.cardEffects)) {
    if (!balanceNumberValid(effectFields.get(id), value)) throw Error('カード効果に無効な項目または数値があります。');
  }
}

function signedDifference(value, base) {
  const delta = Number((value - base).toFixed(12));
  return (delta > 0 ? '+' : '') + delta;
}

const enemyDisclosureState = new Set();
let enemyValueCells = [];
const rowValue = (config,key,row) => config[key][row.id] ?? row.value;

function enemyDisclosure(parent,id,title) {
  const details=document.createElement('details');
  const summary=document.createElement('summary');
  summary.textContent=title;
  details.append(summary);
  details.open=enemyDisclosureState.has(id);
  summary.addEventListener('click',()=>{
    if (details.open) enemyDisclosureState.delete(id);
    else enemyDisclosureState.add(id);
  });
  parent.append(details);
  return details;
}

function appendEnemyField(parent, key, row, label, sectionTitle='') {
  const line=document.createElement('div');
  line.className='enemy-field';
  const title=document.createElement('label');
  const published=document.createElement('span');
  const input=document.createElement('input');
  const difference=document.createElement('span');
  const fieldId='enemy-field-'+key+'-'+row.id;
  title.htmlFor=fieldId;
  title.textContent=label;
  published.textContent=rowValue(live,key,row);
  input.id=fieldId;
  input.type='number';
  input.min=row.min??limits[key][0];
  input.max=row.max??limits[key][1];
  input.value=rowValue(settings,key,row);
  input.setAttribute('aria-label',[row.name,sectionTitle,label,'調整値'].filter(Boolean).join(' '));
  input.addEventListener('input',()=>{
    if (input.value===''&&!input.validity.badInput) {
      const value=live[key][row.id];
      if(value===undefined) delete settings[key][row.id];
      else settings[key][row.id]=value;
    } else if(input.validity.valid&&Number.isSafeInteger(input.valueAsNumber)) {
      if(input.valueAsNumber===row.value) delete settings[key][row.id];
      else settings[key][row.id]=input.valueAsNumber;
    } else return;
    status('変更しました。下書きを保存できます。');
    updateDifferences();
  });
  input.addEventListener('change',()=>{
    input.value=rowValue(settings,key,row);
    if(byId('changes').checked) showRows();
  });
  line.append(title,published,input,difference);
  parent.append(line);
  enemyValueCells.push({line,difference,row,key});
}

function showEnemies(query,onlyChanges) {
  const panel=byId('enemy-list');
  panel.replaceChildren();
  enemyValueCells=[];
  const selectedAct=Number(byId('enemy-act').value);
  const selectedKind=byId('enemy-kind').value;
  const actionsByEnemy=new Map();
  for (const row of catalog.enemyActions) {
    if(!actionsByEnemy.has(row.enemyId)) actionsByEnemy.set(row.enemyId,[]);
    actionsByEnemy.get(row.enemyId).push(row);
  }
  let shown=0;
  for (const enemy of catalog.enemyHp) {
    if ((selectedAct&&enemy.act!==selectedAct)||(selectedKind&&enemy.kind!==selectedKind)) continue;
    const actions=actionsByEnemy.get(enemy.id)??[];
    const text=[enemy.name,enemy.id,...actions.map(row=>row.detail),...enemy.abilities.flat(),...enemy.sections.map(({section})=>section.title)].join(' ');
    if(!normalizeName(text).includes(query)) continue;
    if(onlyChanges&&![['enemyHp',enemy],...actions.map(row=>['enemyActions',row])].some(
      ([key,row])=>rowValue(settings,key,row)!==rowValue(live,key,row))) continue;
    shown++;
    const kind={normal:'通常',elite:'強敵',boss:'ボス'}[enemy.kind];
    const details=enemyDisclosure(panel,enemy.id,enemy.name+'（ACT'+enemy.act+'・'+kind+'）');
    const headings=document.createElement('div');
    headings.className='enemy-field enemy-headings';
    for (const heading of ['項目','公開設定','調整値','差分']) {
      const span=document.createElement('span');
      span.textContent=heading;
      headings.append(span);
    }
    details.append(headings);
    appendEnemyField(details,'enemyHp',enemy,'最大HP');
    for(const [title,text] of enemy.abilities) {
      const nested=enemyDisclosure(details,enemy.id+':ability:'+title,title);
      const description=document.createElement('p');
      description.textContent=text;
      nested.append(description);
    }
    const sections=new Map();
    for(const row of actions) {
      if(!sections.has(row.phase)) sections.set(row.phase,[]);
      sections.get(row.phase).push(row);
    }
    const ordered=[...enemy.sections].sort((a,b)=>Number(b.section.category==='ability')-Number(a.section.category==='ability'));
    for(const {section,phase} of ordered) {
      const rows=sections.get(phase)??[];
      const title=section.title+(section.category==='action'?'（'+(typeof phase==='number'?'行動 '+phase:phase)+'）':'');
      const nested=enemyDisclosure(details,enemy.id+':'+phase,title);
      if(section.description) {
        const description=document.createElement('p');
        description.textContent=section.description;
        nested.append(description);
      }
      if(!rows.length && !section.description) {
        const description=document.createElement('p');
        description.textContent='調整項目なし';
        nested.append(description);
      }
      for(const row of rows) appendEnemyField(nested,'enemyActions',row,row.label,section.title);
    }
  }
  byId('no-results').hidden=shown>0;
  updateDifferences();
}

function updateDifferences() {
  if(group==='enemyActions') for(const {line,difference,row,key} of enemyValueCells) {
    const before=rowValue(live,key,row), after=rowValue(settings,key,row);
    difference.textContent=signedDifference(after,before);
    line.classList.toggle('changed',before!==after);
  }
  const rows = catalog[group];

  const percentage = (config, row) => {
    const pool = weightPoolByRow.get(group+row.id);
    const sum = pool.reduce((total, item) => total + (config[item.key][item.id] ?? item.value), 0);
    return sum ? (100 * valueOf(config, row) / sum).toFixed(1) + '%' : '—';
  };
  for (const difference of byId('rows').querySelectorAll('[data-entry-index]')) {
    const row = rows[Number(difference.dataset.entryIndex)];
    const adjustment = difference.previousElementSibling;
    const published = adjustment.previousElementSibling;
    const targetCell = published.previousElementSibling;
    for (const cell of [targetCell, published, adjustment, difference]) {
      cell.classList.toggle('changed', changed(row));
    }
    if (group === 'cards') {
      updateCardPreview(targetCell, row);
      for (const number of difference.querySelectorAll('[data-effect-id]')) {
        const field = effectFields.get(number.dataset.effectId);
        number.textContent = field
          ? signedDifference(effectValue(settings, field), effectValue(live, field))
          : row.value === null ? '—' : signedDifference(valueOf(settings, row), valueOf(live, row));
      }
    } else {
      difference.textContent = isWeight()
        ? percentage(live, row) + ' → ' + percentage(settings, row)
        : signedDifference(valueOf(settings, row), valueOf(live, row));
    }
  }
  const count = Object.entries(catalog).reduce((sum, [key, entries]) => sum +
    entries.filter(row => (settings[key][row.id] ?? row.value) !== (live[key][row.id] ?? row.value)).length, 0);
  byId('count').textContent = '変更 ' + (count + [...effectFields.values()].filter(effectChanged).length) + ' 件';
}

function showRows() {
  const tbody = byId('rows');
  const isCards = group === 'cards';
  const query = normalizeName(byId('search').value);
  const filters = isCards ? Object.entries(cardFilters)
    .map(([id, valuesOf]) => [byId(id).value, valuesOf])
    .filter(([value]) => value) : [];
  const onlyChanges = byId('changes').checked;
  const isEnemies=group==='enemyActions';
  byId('enemy-list').hidden=!isEnemies;
  tbody.closest('.table-wrap').hidden=isEnemies;
  if(isEnemies) {
    tbody.replaceChildren();
    showEnemies(query,onlyChanges);
    return;
  }
  byId('difference').textContent = isWeight() ? '出現率（公開 → 調整）' : '差分';
  tbody.closest('table').classList.toggle('card-table', isCards);
  for (const heading of tbody.closest('table').querySelectorAll('[data-second-card]')) heading.hidden = !isCards;
  tbody.replaceChildren();
  let shown = 0;
  catalog[group].forEach((row, index) => {
    if (!isCards && byId('enemy-act').value && Number(byId('enemy-act').value) !== row.act) return;
    const kind = byId('enemy-kind').value;
    if ((group==='enemyHp'||group==='enemyActions') && kind && row.kind!==kind) return;
    const searchText = isCards ? row.name : [row.name,row.id,row.detail].filter(Boolean).join(' ');
    if (!normalizeName(searchText).includes(query) || (onlyChanges && !changed(row))) return;
    if (!filters.every(([value, valuesOf]) => valuesOf(row).includes(value))) return;
    const secondCard = isCards && shown % 2 === 1;
    const tr = secondCard ? tbody.rows[tbody.rows.length - 1] : tbody.insertRow();
    if (secondCard) {
      const gutter = tr.insertCell();
      gutter.className = 'card-gutter';
      gutter.setAttribute('aria-hidden', 'true');
    }
    shown += 1;
    const name = tr.insertCell();
    if (isCards) name.className = 'card-target';
    if (isCards) appendCardPreview(name, row);
    else name.textContent = row.name;
    const detail = document.createElement('small');
    detail.textContent = (row.act ? 'ACT' + row.act : row.id) + (row.detail ? ' · ' + row.detail : '');
    if (!isCards) name.append(detail);
    const published = tr.insertCell();
    const adjustment = tr.insertCell();
    const difference = tr.insertCell();
    difference.dataset.entryIndex = index;
    const cost = isCards ? document.createElement('label') : adjustment;
    if (isCards) {
      appendCardValue(published, 'コスト', valueOf(live, row) ?? 'X');
      appendCardValue(difference, 'コスト', '', '');
      cost.className = 'card-field';
      cost.textContent = 'コスト';
      adjustment.append(cost);
    } else {
      published.textContent = valueOf(live, row);
    }
    if (row.value !== null) {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = row.min ?? limits[group][0];
      input.max = row.max ?? limits[group][1];
      input.value = valueOf(settings, row);
      input.setAttribute('aria-label', row.name + (isCards ? 'のコスト' : ' '+(row.detail||'')+' の調整値'));
      input.addEventListener('input', () => {
        if (input.value === '' && !input.validity.badInput) {
          if (Object.hasOwn(live[group], row.id)) settings[group][row.id] = live[group][row.id];
          else delete settings[group][row.id];
        } else if (input.validity.valid && Number.isSafeInteger(input.valueAsNumber)) {
          if (input.valueAsNumber === row.value) delete settings[group][row.id];
          else settings[group][row.id] = input.valueAsNumber;
        } else {
          status('入力できる範囲は ' + input.min + '〜' + input.max + ' の整数です。');
          return;
        }
        status('変更しました。下書きを保存できます。');
        updateDifferences();
      });
      input.addEventListener('change', () => {
        input.value = valueOf(settings, row);
        if (onlyChanges && !changed(row)) showRows();
      });
      cost.append(input);
    } else {
      const value = document.createElement('span');
      value.className = 'card-field-value';
      value.textContent = 'X';
      cost.append(value);
    }
    if (isCards) appendEffectInputs(adjustment, published, difference, row);
  });
  if (isCards && shown % 2 === 1) {
    const lastRow = tbody.rows[tbody.rows.length - 1];
    const gutter = lastRow.insertCell();
    gutter.className = 'card-gutter';
    gutter.setAttribute('aria-hidden', 'true');
    lastRow.insertCell().colSpan = 4;
  }
  byId('no-results').hidden = shown > 0;
  updateDifferences();
}

function action(callback) {
  try { validate(settings); callback(); }
  catch (error) { status(error.message); }
}

function loadPreview() {
  clearTimeout(previewTimer);
  frame.src = 'play.html';
  previewTimer = setTimeout(() => {
    status('公開中の本編データを読み込めませんでした。ページを再読み込みしてください。');
  }, 15000);
}

window.addEventListener('message', event => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
  if (event.data?.type === 'ashbound-balance-playing') {
    clearTimeout(previewTimer);
    status('調整値でテストプレイを開始しました。');
    frame.scrollIntoView({block: 'start'});
  }
  if (event.data?.type === 'ashbound-balance-error') {
    clearTimeout(previewTimer);
    status('テストプレイ開始時にエラーが発生しました。 ' + event.data.message);
  }
  if (event.data?.type !== 'ashbound-balance-ready') return;
  if (playRequest) {
    frame.contentWindow.postMessage(playRequest, location.origin);
    playRequest = null;
    return;
  }
  clearTimeout(previewTimer);
  renderCardKeywords = frame.contentWindow.rich;
  resolveEffect = frame.contentWindow.balanceEffectiveEffect;
  normalizePublishedSettings = frame.contentWindow.balanceValidate;
  catalog = event.data.catalog;
  setupTestDeck(event.data.characters,event.data.testCards);
  limits = event.data.limits;
  weightGroups = event.data.weightGroups;
  weightPoolByRow = new Map(weightGroups.flatMap(pool => pool.map(row => [row.key+row.id,pool])));
  effectFields.clear();
  for (const row of catalog.cards) for (const field of row.effects) effectFields.set(field.id, field);
  setupCardFilters();
  status(event.data.snapshot ? '本編の直接取得に失敗したため、公開時に取り込んだ本編データを使用しています。' : '本編データを読み込みました。');
  refreshPublishedBalance();
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey));
    if (saved) { validate(saved); settings = saved; status('保存済みの下書きを読み込みました。'); }
  } catch { status('保存済みの下書きを確認できなかったため、公開設定を表示しています。'); }
  byId('editor').hidden = false;
  showRows();
});

for (const [key, label] of Object.entries(groups)) {
  const button = document.createElement('button');
  button.textContent = label;
  button.setAttribute('aria-pressed', String(group === key));
  button.onclick = () => {
    group = key;
    const isCards = group === 'cards';
    for (const label of document.querySelectorAll('[data-card-filter]')) label.hidden = !isCards;
    byId('enemy-act').parentElement.hidden = isCards;
    byId('enemy-kind').parentElement.hidden = key !== 'enemyHp' && key !== 'enemyActions';
    if (key === 'enemyActions') byId('play-act').value = byId('enemy-act').value || byId('play-act').value;
    updateEncounterOptions();
    byId('search-label').textContent = isCards ? '名前' : '検索';
    byId('search').placeholder = isCards ? 'カード名' : '名前・ID';
    for (const entry of byId('groups').children) entry.setAttribute('aria-pressed', String(entry === button));
    showRows();
  };
  byId('groups').append(button);
}
function updateEncounterOptions() {
  const isGold = byId('play-act').value === '7';
  const encounter = byId('encounter');
  encounter.querySelector('[value=pairs]').disabled = !isGold;
  encounter.querySelector('[value=solo]').textContent = isGold ? '通常・単体' : '通常';
  if (!isGold && encounter.value === 'pairs') encounter.value = 'solo';
}
byId('enemy-act').addEventListener('change', () => {
  if (byId('enemy-act').value) byId('play-act').value = byId('enemy-act').value;
  updateEncounterOptions();
  showRows();
});
byId('enemy-kind').addEventListener('change', showRows);
byId('play-act').addEventListener('change', updateEncounterOptions);
byId('search').addEventListener('input', showRows);
for (const id of Object.keys(cardFilters)) byId(id).addEventListener('change', showRows);
byId('changes').addEventListener('change', showRows);
let balanceRelease;
let balanceHistory = [];
const publishDialog = byId('publish-dialog');

async function requestBalanceRelease(options) {
  const signed = await fetch('/api/publish-balance', {cache:'no-store', ...options});
  if (!signed.ok) throw Error('このアカウントで本編への反映を認証できませんでした。');
  const {proof} = await signed.json();
  const response = await fetch('https://ashbound-deck-hunt.takeshita0205ayumu.chatgpt.site/api/balance-admin', {
    cache:'no-store', ...options, headers:{...options?.headers,'X-Balance-Proof':proof},
  });
  if (!response.ok) throw Error(response.status === 409
    ? '公開設定が更新されました。最新の差分を確認してください。'
    : '本編のバランス設定に接続できませんでした。');
  return response.json();
}

async function refreshPublishedBalance() {
  try {
    const {current, history} = await requestBalanceRelease();
    if(normalizePublishedSettings) current.settings = normalizePublishedSettings(current.settings);
    validate(current.settings);
    const untouched = JSON.stringify(settings) === JSON.stringify({...structuredClone(live),cardEffects:{...live.cardEffects}});
    balanceRelease = current;
    live = current.settings;
    if (untouched) settings = structuredClone(live);
    balanceHistory = history;
    const select = byId('balance-history');
    select.length = 1;
    for (const [index, release] of history.entries()) {
      select.add(new Option(release.publishedAt ? new Date(release.publishedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}) : '初期設定', String(index)));
    }
    select.disabled = history.length === 0;
    byId('load-release').disabled = true;
    byId('publish').disabled = false;
    setupCardFilters();
    showRows();
  } catch (error) {
    byId('publish').disabled = true;
    status(error.message);
  }
}

function listReleaseChanges() {
  const changes = [];
  for (const [key,rows] of Object.entries(catalog)) {
    for (const row of rows) {
      const before = live[key][row.id] ?? row.value;
      const after = settings[key][row.id] ?? row.value;
      if (before !== after) changes.push(row.name + ' · ' + (key === 'cards' ? 'コスト' : key === 'enemyHp' ? 'HP' : key === 'enemyActions' ? row.detail : '重み') + ' ' + before + ' → ' + after);
      for (const field of row.effects ?? []) {
        if (!field.hidden && effectChanged(field)) changes.push(row.name + ' · ' + field.label + ' ' + effectValue(live,field) + ' → ' + effectValue(settings,field));
      }
    }
  }
  return changes;
}

byId('publish').onclick = () => action(() => {
  const changes = listReleaseChanges();
  if (!changes.length) { status('本編に反映する変更はありません。'); return; }
  byId('publish-diff').replaceChildren(...changes.map(change => {
    const item = document.createElement('li');
    item.textContent = change;
    return item;
  }));
  publishDialog.showModal();
});
byId('confirm-publish').onclick = async () => {
  const confirm = byId('confirm-publish');
  confirm.disabled = true;
  try {
    validate(settings);
    const {current} = await requestBalanceRelease({
      method:'PUT', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({revision:balanceRelease.revision,settings}),
    });
    live = current.settings;
    settings = structuredClone(live);
    try { localStorage.setItem(draftKey, JSON.stringify(settings)); } catch {}
    publishDialog.close();
    await refreshPublishedBalance();
    status('本編に反映しました。次の探索から適用されます。');
  } catch (error) {
    publishDialog.close();
    await refreshPublishedBalance();
    status(error.message);
  } finally {
    confirm.disabled = false;
  }
};
byId('balance-history').onchange = () => {
  byId('load-release').disabled = byId('balance-history').value === '';
};
byId('load-release').onclick = () => {
  settings = structuredClone(balanceHistory[Number(byId('balance-history').value)].settings);
  showRows();
  status('履歴を読み込みました。内容を確認して本編に反映できます。');
};

byId('save').onclick = () => action(() => {
  localStorage.setItem(draftKey, JSON.stringify(settings));
  status('下書きをこのブラウザーに保存しました。');
});
byId('export').onclick = () => action(() => {
  const blob = new Blob(['globalThis.ASHBOUND_BALANCE_SETTINGS = ', JSON.stringify(settings, null, 2), ';\n'], {type: 'application/javascript'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'balance-settings.js';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  status('反映用ファイルを出力しました。本番への反映にはゲームの再公開が必要です。');
});
let testCharacters = [];
let testCards = [];
const testDecks = new Map();
const selectedTestCharacter = () => testCharacters.find(character=>character.id===byId('play-character').value);
const testDeck = () => testDecks.get(selectedTestCharacter()?.id);
function setupTestDeck(characters,cards) {
  testCharacters=characters;
  testCards=cards;
  const select=byId('play-character');
  select.replaceChildren(...characters.map(({id,name})=>new Option(name,id)));
  for(const {id,starter} of characters) testDecks.set(id,[...starter]);
  renderTestDeck();
}
function filterTestCards() {
  const query=normalizeName(byId('play-card-search').value);
  const character=selectedTestCharacter()?.id;
  const cards=testCards.filter(card=>(!card.characterId||card.characterId===character)&&normalizeName(card.name).includes(query));
  const select=byId('play-card');
  const previous=select.value;
  select.replaceChildren(...cards.map(({id,name})=>new Option(name,String(id))));
  if(cards.some(({id})=>String(id)===previous)) select.value=previous;
  updateTestAddButton();
}
function testCardLimit(id) {
  const card=testCards.find(card=>card.id===id);
  if(!card || card.characterId) return Infinity;
  const sameNameIds=new Set(testCards.filter(entry=>!entry.characterId&&entry.name===card.name).map(entry=>entry.id));
  return 3-testDeck().filter(entry=>entry!==id&&sameNameIds.has(entry)).length;
}
function updateTestAddButton() {
  const value=byId('play-card').value;
  const id=Number(value);
  byId('play-add-card').disabled=!value||testDeck().filter(card=>card===id).length>=testCardLimit(id);
}
function renderTestDeck() {
  filterTestCards();
  const deck=testDeck()??[];
  const basics=new Set(testCards.filter(card=>!card.characterId).map(card=>card.id));
  const basicCount=deck.filter(id=>basics.has(id)).length;
  byId('play-deck-count').textContent='基礎 '+basicCount+'枚 ／ 合計 '+deck.length+'枚';
  byId('play-deck-requirement').textContent=basicCount<10?'開始まで基礎カードがあと'+(10-basicCount)+'枚必要です。':'';
  const counts=new Map();
  for(const id of deck) counts.set(id,(counts.get(id)??0)+1);
  byId('play-deck-list').replaceChildren(...Array.from(counts,([id,count])=>{
    const name=testCards.find(card=>card.id===id)?.name??String(id);
    const row=document.createElement('li');
    const label=document.createElement('label');
    label.textContent=name;
    const quantity=document.createElement('input');
    quantity.type='number';
    quantity.min=0;
    const limit=testCardLimit(id);
    if(Number.isFinite(limit)) quantity.max=limit;
    quantity.value=count;
    quantity.setAttribute('aria-label',name+'の枚数');
    quantity.addEventListener('change',()=>{
      if(!quantity.validity.valid||!Number.isInteger(quantity.valueAsNumber)) {
        quantity.value=count;
        return;
      }
      setTestCardCount(id,quantity.valueAsNumber);
    });
    label.append(quantity);
    const remove=document.createElement('button');
    remove.type='button';
    remove.textContent='外す';
    remove.setAttribute('aria-label',name+'を外す');
    remove.onclick=()=>setTestCardCount(id,0);
    row.append(label,remove);
    return row;
  }));
  byId('preview').disabled=basicCount<10;
}
function setTestCardCount(id,count) {
  if(!Number.isSafeInteger(count)||count<0||count>testCardLimit(id)) return;
  testDecks.set(selectedTestCharacter().id,[...testDeck().filter(card=>card!==id),...Array(count).fill(id)]);
  renderTestDeck();
}
byId('play-character').addEventListener('change',renderTestDeck);
byId('play-card-search').addEventListener('input',filterTestCards);
byId('play-card').addEventListener('change',updateTestAddButton);
byId('play-add-card').onclick=()=>{
  const id=Number(byId('play-card').value);
  const count=testDeck().filter(card=>card===id).length;
  if(byId('play-card').value) setTestCardCount(id,count+1);
};
byId('play-reset-deck').onclick=()=>{
  const {id,starter}=selectedTestCharacter();
  testDecks.set(id,[...starter]);
  renderTestDeck();
};

byId('preview').onclick = () => action(() => {
  playRequest = {type: 'ashbound-balance-play', settings: structuredClone(settings), character:selectedTestCharacter().id, deck:[...testDeck()], group: byId('encounter').value, act: Number(byId('play-act').value)};
  frame.hidden = false;
  status('テストプレイを準備しています。');
  loadPreview();
});

loadPreview();
