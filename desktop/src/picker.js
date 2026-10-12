// Выбор экрана или окна для показа (main.js → setDisplayMediaRequestHandler)
let sources = [];
let kind = 'screen';
let selected = null;

const grid = document.getElementById('grid');
const share = document.getElementById('share');
const hint = document.getElementById('hint');

function render() {
  grid.textContent = '';
  const list = sources.filter((s) => (kind === 'screen') === s.screen);
  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'muted empty';
    empty.textContent = kind === 'screen' ? 'Экраны не найдены' : 'Нет открытых окон';
    grid.append(empty);
  }
  for (const s of list) {
    const item = document.createElement('button');
    item.className = 'src' + (selected === s.id ? ' on' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(selected === s.id));
    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    if (s.thumb) {
      const img = document.createElement('img');
      img.src = s.thumb;
      img.alt = '';
      thumb.append(img);
    }
    const label = document.createElement('span');
    label.className = 'label';
    if (s.icon) {
      const ic = document.createElement('img');
      ic.src = s.icon;
      ic.alt = '';
      ic.className = 'icon';
      label.append(ic);
    }
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = s.screen && list.length > 1 ? s.name : s.screen ? 'Весь экран' : s.name;
    label.append(name);
    item.append(thumb, label);
    item.addEventListener('click', () => {
      selected = s.id;
      share.disabled = false;
      render();
    });
    item.addEventListener('dblclick', () => window.picker.choose(s.id));
    grid.append(item);
  }
  hint.textContent = kind === 'screen' ? 'Экран показывается вместе со звуком компьютера' : 'Окно показывается без звука';
}

document.querySelectorAll('[role=tab]').forEach((tab) =>
  tab.addEventListener('click', () => {
    kind = tab.dataset.kind;
    document.querySelectorAll('[role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    selected = null;
    share.disabled = true;
    render();
  }),
);
share.addEventListener('click', () => selected && window.picker.choose(selected));
document.getElementById('cancel').addEventListener('click', () => window.picker.choose(null));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.picker.choose(null);
  if (e.key === 'Enter' && selected) window.picker.choose(selected);
});

window.picker.list().then((list) => {
  sources = list;
  // Один экран — сразу выбран
  const screens = list.filter((s) => s.screen);
  if (screens.length === 1) {
    selected = screens[0].id;
    share.disabled = false;
  }
  render();
});
