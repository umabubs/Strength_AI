'use strict';

const scanStatus = document.querySelector('#scan-status');
const suggestion = document.querySelector('#suggestion');
const guide = document.querySelector('#guide');
const photo = document.querySelector('#photo');
let photoUrl;
let activeScan;

const machinesRequest = fetch('machines.json').then(response => {
  if (!response.ok) throw new Error('Catalogue unavailable');
  return response.json();
});

function button(label, onClick, style = 'quiet') {
  const control = document.createElement('button');
  control.type = 'button';
  control.className = `button ${style}`;
  control.textContent = label;
  control.onclick = onClick;
  return control;
}

function element(tag, text, className) {
  const item = document.createElement(tag);
  if (text) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function chooseMachine(machine) {
  const title = element('h3', machine.name);
  title.tabIndex = -1;
  const muscles = element('div', '', 'muscles');
  muscles.append(...machine.muscles.map(muscle => element('span', muscle)));
  const steps = element('ol');
  steps.append(...machine.steps.map(step => element('li', step)));
  const add = element('a', 'Add to workout', 'button primary');
  add.href = 'tracker/?add=' + encodeURIComponent(machine.exercise);
  add.setAttribute('aria-describedby', 'workout-target');
  const target = element('p', 'Adds to the experimental tracker on this device.', 'muted');
  target.id = 'workout-target';
  const source = element('a', 'Guide reference ↗');
  source.href = machine.source;
  source.target = '_blank';
  source.rel = 'noopener noreferrer';

  guide.replaceChildren(
    title, muscles, element('h3', 'Setup and technique'), steps,
    element('p', 'Follow the placard on your machine if its settings or safety catches differ.', 'muted')
  );

  if (machine.animated) {
    const demonstration = element('exercise-motion');
    demonstration.dataset.machine = machine.id;
    guide.append(demonstration);
  } else {
    const illustration = element('img', '', 'demo');
    illustration.src = 'tracker/images/' + machine.image;
    illustration.alt = `${machine.name} exercise demonstration`;
    guide.append(illustration);
  }
  const reference = element('p', '', 'muted');
  reference.append(source);
  guide.append(reference, add, target, button('Choose another machine', showCatalogue));
  title.focus();
}

async function showCatalogue() {
  const heading = element('p', 'Pick a machine to see its setup, muscles and demonstration.', 'muted');
  const list = element('div', '', 'catalogue');
  try {
    const machines = await machinesRequest;
    list.append(...machines.map(machine => button(machine.name, () => chooseMachine(machine))));
    guide.replaceChildren(heading, list);
  } catch {
    guide.replaceChildren(element('p', 'The machine catalogue could not load.', 'muted'));
  }
}

function showMatch(result, machines) {
  const match = machines.find(machine => machine.id === result.machine);
  if (!match) {
    suggestion.replaceChildren(element('p', 'No reliable match. Try another angle, include the equipment label, or pick a machine under Learn machine.', 'muted'));
    return;
  }

  const card = element('div', '', 'result');
  card.append(
    element('h3', `Suggested match: ${match.name}`),
    element('p', match.hint, 'muted'),
    element('p', result.reason === 'label' ? 'Matched the equipment label. Check the machine before continuing.' : 'Tentative visual match. Check the machine before continuing.', 'muted'),
    button('Confirm match', () => chooseMachine(match), 'primary')
  );
  const alternatives = result.alternatives.map(id => machines.find(machine => machine.id === id)).filter(Boolean);
  const change = element('details');
  change.append(element('summary', 'Choose a different machine'));
  const buttons = element('div', '', 'catalogue');
  buttons.append(...alternatives.map(machine => button(machine.name, () => chooseMachine(machine))));
  change.append(buttons);
  card.append(change);
  suggestion.replaceChildren(card);
}

async function scanFile(file) {
  activeScan?.abort();
  const scan = new AbortController();
  activeScan = scan;
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photo.hidden = true;
  document.querySelector('#empty-photo').hidden = false;
  document.querySelector('#photo-caption').hidden = false;
  suggestion.replaceChildren();
  showCatalogue();
  scanStatus.textContent = 'Reading the machine photo…';

  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('Choose a photo smaller than 20 MB.');
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error('This photo format could not be opened. Try JPEG, PNG or WebP.');
    }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1440 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (scan.signal.aborted) return;
    if (!image) throw new Error('Could not prepare the machine photo.');
    photoUrl = URL.createObjectURL(image);
    photo.src = photoUrl;
    photo.hidden = false;
    document.querySelector('#empty-photo').hidden = true;
    document.querySelector('#photo-caption').hidden = true;

    const [response, machines] = await Promise.all([
      fetch('api/scan', {method:'POST', body:image, signal:scan.signal}),
      machinesRequest
    ]);
    if (!response.ok) throw new Error(response.status === 503 ? 'The scanner is unavailable. You can still pick a machine manually.' : 'The photo could not be scanned. Try another image.');
    const result = await response.json();
    if (scan.signal.aborted) return;
    scanStatus.textContent = result.machine ? 'Scan complete.' : 'The photo did not produce a reliable match.';
    showMatch(result, machines);
  } catch (error) {
    if (!scan.signal.aborted) scanStatus.textContent = error.message === 'Failed to fetch' ? 'Could not reach the scanner. You can still pick a machine manually.' : error.message;
  }
}

for (const input of document.querySelectorAll('input[type=file]')) {
  input.addEventListener('change', () => {
    const file = input.files[0];
    input.value = '';
    if (file) scanFile(file);
  });
}
document.querySelector('#sample').addEventListener('click', async () => {
  try {
    const response = await fetch('tracker/images/ua2.webp');
    if (!response.ok) throw new Error('Example not found');
    await scanFile(await response.blob());
  } catch {
    scanStatus.textContent = 'The example could not load. You can still choose a photo.';
  }
});
showCatalogue();
