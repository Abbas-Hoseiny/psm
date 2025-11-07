import { getState } from '../../core/state.js';
import { setFieldLabelByPath } from '../../core/labels.js';
import { getDatabaseSnapshot } from '../../core/database.js';
import { saveDatabase, getActiveDriverKey } from '../../core/storage/index.js';
import { buildMediumTableHead, buildMediumTableRows } from '../shared/mediumTable.js';

let initialized = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function createSection(labels, defaultsState) {
  const formDefaults = defaultsState?.form || {
    creator: '',
    location: '',
    crop: '',
    quantity: ''
  };
  const section = document.createElement('section');
  section.className = 'section-container d-none';
  section.dataset.section = 'calc';
  section.innerHTML = `
    <div class="section-inner">
      <div class="card card-dark mb-4 no-print">
        <div class="card-body">
          <form id="calculationForm" class="row g-3 no-print">
            <div class="col-md-3">
              <input type="text" class="form-control form-control-sm label-editor mb-2" data-label-editor="calculation.fields.creator.label" data-default-label="${escapeAttr(labels.calculation.fields.creator.label)}" value="${escapeAttr(labels.calculation.fields.creator.label)}" placeholder="${escapeAttr(labels.calculation.fields.creator.label)}" aria-label="Bezeichnung für Feld" />
              <input type="text" class="form-control" id="calc-ersteller" name="calc-ersteller" required data-placeholder-id="calc-form-creator" placeholder="${escapeAttr(labels.calculation.fields.creator.placeholder)}" aria-label="${escapeAttr(labels.calculation.fields.creator.label)}" value="${escapeAttr(formDefaults.creator || '')}" />
            </div>
            <div class="col-md-3">
              <input type="text" class="form-control form-control-sm label-editor mb-2" data-label-editor="calculation.fields.location.label" data-default-label="${escapeAttr(labels.calculation.fields.location.label)}" value="${escapeAttr(labels.calculation.fields.location.label)}" placeholder="${escapeAttr(labels.calculation.fields.location.label)}" aria-label="Bezeichnung für Feld" />
              <input type="text" class="form-control" id="calc-standort" name="calc-standort" data-placeholder-id="calc-form-location" placeholder="${escapeAttr(labels.calculation.fields.location.placeholder)}" aria-label="${escapeAttr(labels.calculation.fields.location.label)}" value="${escapeAttr(formDefaults.location || '')}" />
            </div>
            <div class="col-md-3">
              <input type="text" class="form-control form-control-sm label-editor mb-2" data-label-editor="calculation.fields.crop.label" data-default-label="${escapeAttr(labels.calculation.fields.crop.label)}" value="${escapeAttr(labels.calculation.fields.crop.label)}" placeholder="${escapeAttr(labels.calculation.fields.crop.label)}" aria-label="Bezeichnung für Feld" />
              <input type="text" class="form-control" id="calc-kultur" name="calc-kultur" data-placeholder-id="calc-form-crop" placeholder="${escapeAttr(labels.calculation.fields.crop.placeholder)}" aria-label="${escapeAttr(labels.calculation.fields.crop.label)}" value="${escapeAttr(formDefaults.crop || '')}" />
            </div>
            <div class="col-md-3">
              <input type="text" class="form-control form-control-sm label-editor mb-2" data-label-editor="calculation.fields.quantity.label" data-default-label="${escapeAttr(labels.calculation.fields.quantity.label)}" value="${escapeAttr(labels.calculation.fields.quantity.label)}" placeholder="${escapeAttr(labels.calculation.fields.quantity.label)}" aria-label="Bezeichnung für Feld" />
              <input type="number" min="0" step="any" class="form-control" id="calc-kisten" name="calc-kisten" required data-placeholder-id="calc-form-quantity" placeholder="${escapeAttr(labels.calculation.fields.quantity.placeholder)}" aria-label="${escapeAttr(labels.calculation.fields.quantity.label)}" value="${escapeAttr(formDefaults.quantity || '')}" />
            </div>
            <div class="col-12 text-center">
              <button type="submit" class="btn btn-success px-4">Berechnen</button>
            </div>
          </form>
        </div>
      </div>
      <div id="calc-result" class="card card-dark d-none">
        <div class="card-body">
          <div class="calc-summary mb-3">
            <div class="calc-summary-columns">
              <div class="calc-summary-column calc-summary-main">
                <div class="calc-summary-row">
                  <span class="calc-summary-label" data-label-id="calc-summary-creator">${escapeHtml(labels.calculation.fields.creator.label)}</span>
                  <span class="calc-summary-value" data-field="ersteller"></span>
                </div>
                <div class="calc-summary-row">
                  <span class="calc-summary-label" data-label-id="calc-summary-location">${escapeHtml(labels.calculation.fields.location.label)}</span>
                  <span class="calc-summary-value" data-field="standort"></span>
                </div>
                <div class="calc-summary-row">
                  <span class="calc-summary-label" data-label-id="calc-summary-crop">${escapeHtml(labels.calculation.fields.crop.label)}</span>
                  <span class="calc-summary-value" data-field="kultur"></span>
                </div>
                <div class="calc-summary-row">
                  <span class="calc-summary-label" data-label-id="calc-summary-date">${escapeHtml(labels.calculation.summary.dateLabel || 'Datum')}</span>
                  <span class="calc-summary-value" data-field="datum"></span>
                </div>
              </div>
              <div class="calc-summary-column calc-summary-company">
                <div class="calc-summary-row d-none" data-company-row="headline">
                  <span class="calc-summary-label">Claim</span>
                  <span class="calc-summary-value" data-field="company-headline"></span>
                </div>
                <div class="calc-summary-row d-none" data-company-row="address">
                  <span class="calc-summary-label">Anschrift</span>
                  <span class="calc-summary-value calc-summary-value--multiline" data-field="company-address"></span>
                </div>
                <div class="calc-summary-row d-none" data-company-row="email">
                  <span class="calc-summary-label">E-Mail</span>
                  <a class="calc-summary-value" data-field="company-email"></a>
                </div>
              </div>
            </div>
          </div>
          <div class="calc-table-wrapper">
            <table class="table table-dark table-striped align-middle calc-medium-table" id="calc-results-table">
              <thead></thead>
              <tbody></tbody>
            </table>
          </div>
          <div class="mt-3 no-print">
            <button class="btn btn-outline-secondary" data-action="print">Drucken / PDF</button>
            <button class="btn btn-primary ms-2" data-action="save">Aktuelle Berechnung speichern</button>
          </div>
        </div>
      </div>
    </div>
  `;
  return section;
}

function applyFieldLabels(section, labels) {
  if (!section) {
    return;
  }
  const labelMap = {
    'calc-form-creator': labels.calculation.fields.creator.label,
    'calc-form-location': labels.calculation.fields.location.label,
    'calc-form-crop': labels.calculation.fields.crop.label,
    'calc-form-quantity': labels.calculation.fields.quantity.label,
    'calc-summary-creator': labels.calculation.fields.creator.label,
    'calc-summary-location': labels.calculation.fields.location.label,
    'calc-summary-crop': labels.calculation.fields.crop.label,
    'calc-summary-date': labels.calculation.summary.dateLabel || 'Datum'
  };

  Object.entries(labelMap).forEach(([key, text]) => {
    const element = section.querySelector(`[data-label-id="${key}"]`);
    if (element) {
      element.textContent = typeof text === 'string' ? text : '';
    }
  });

  section.querySelectorAll('.label-editor').forEach(input => {
    const path = input.dataset.labelEditor;
    if (!path) {
      return;
    }
    const value = path.split('.').reduce((acc, segment) => (acc && acc[segment] !== undefined ? acc[segment] : null), labels);
    if (typeof value === 'string') {
      input.placeholder = value;
      input.dataset.defaultLabel = value;
      if (!input.matches(':focus')) {
        input.value = value;
      }
    }
  });

  const placeholderMap = {
    'calc-form-creator': labels.calculation.fields.creator.placeholder,
    'calc-form-location': labels.calculation.fields.location.placeholder,
    'calc-form-crop': labels.calculation.fields.crop.placeholder,
    'calc-form-quantity': labels.calculation.fields.quantity.placeholder
  };

  Object.entries(placeholderMap).forEach(([key, text]) => {
    const element = section.querySelector(`[data-placeholder-id="${key}"]`);
    if (element) {
      element.setAttribute('placeholder', typeof text === 'string' ? text : '');
    }
  });

  const tableHead = section.querySelector('#calc-results-table thead');
  if (tableHead) {
    tableHead.innerHTML = buildMediumTableHead(labels, 'calculation');
  }
}

async function persistHistory(services) {
  const driverKey = getActiveDriverKey();
  if (!driverKey || driverKey === 'memory') {
    return;
  }
  try {
    const snapshot = getDatabaseSnapshot();
    await saveDatabase(snapshot);
    services.events.emit('database:saved', { scope: 'history', driver: driverKey });
  } catch (err) {
    console.error('Automatisches Speichern der Historie fehlgeschlagen', err);
    services.events.emit('database:error', { scope: 'history', error: err });
    alert('Berechnung gespeichert, aber die Datei konnte nicht aktualisiert werden. Bitte manuell sichern.');
  }
}

function getWaterVolume(kisten, defaults) {
  const arValue = kisten / (defaults.kistenProAr || 1);
  return arValue * (defaults.waterPerKisteL || 0);
}

function executeFormula(medium, method, inputs, defaults) {
  if (!method) {
    return 0;
  }
  const value = Number(medium.value) || 0;
  switch (method.type) {
    case 'factor': {
      const base = inputs[method.config?.sourceField || 'kisten'] || 0;
      return value * base;
    }
    case 'percentOf': {
      const base = inputs[method.config?.baseField || 'waterVolume'] || 0;
      return (base * value) / 100;
    }
    case 'fixed':
      return value;
    default:
      console.warn('Unbekannter Methodentyp', method.type);
      return value;
  }
}

export function initCalculation(container, services) {
  if (!container || initialized) {
    return;
  }

  const initialState = getState();
  const section = createSection(initialState.fieldLabels, initialState.defaults);
  container.appendChild(section);
  applyFieldLabels(section, getState().fieldLabels);

  const form = section.querySelector('#calculationForm');
  const resultCard = section.querySelector('#calc-result');
  const resultsTable = section.querySelector('#calc-results-table');
  const resultsHead = resultsTable.querySelector('thead');
  const resultsBody = resultsTable.querySelector('tbody');
  const fieldEls = {
    ersteller: resultCard.querySelector('[data-field="ersteller"]'),
    standort: resultCard.querySelector('[data-field="standort"]'),
    kultur: resultCard.querySelector('[data-field="kultur"]'),
    datum: resultCard.querySelector('[data-field="datum"]'),
    companyHeadline: resultCard.querySelector('[data-field="company-headline"]'),
    companyAddress: resultCard.querySelector('[data-field="company-address"]'),
    companyEmail: resultCard.querySelector('[data-field="company-email"]')
  };

  function resolveFieldEl(key) {
    if (!fieldEls[key]) {
      fieldEls[key] = resultCard.querySelector(`[data-field="${key}"]`);
    }
    return fieldEls[key];
  }

  function toggleVisibility(state) {
    const active = state.app.activeSection === 'calc';
    const ready = state.app.hasDatabase;
    section.classList.toggle('d-none', !(active && ready));
  }

  toggleVisibility(getState());
  services.state.subscribe((nextState) => {
    toggleVisibility(nextState);
    applyFieldLabels(section, nextState.fieldLabels);
  });

  section.querySelectorAll('.label-editor').forEach(input => {
    input.addEventListener('change', event => {
      const path = event.target.dataset.labelEditor;
      if (!path) {
        return;
      }
      const trimmed = event.target.value.trim();
      const fallback = event.target.dataset.defaultLabel || event.target.getAttribute('placeholder') || event.target.value;
      const nextValue = trimmed || fallback || '';
      if (!trimmed) {
        event.target.value = nextValue;
      }
      services.state.updateSlice('fieldLabels', currentLabels => setFieldLabelByPath(currentLabels, path, nextValue));
    });
  });

  function renderResults(calculation, labels) {
    if (!calculation) {
      resultCard.classList.add('d-none');
      resultsBody.innerHTML = '';
      return;
    }
    const { header, items } = calculation;
    const stateSnapshot = getState();
    const companyData = stateSnapshot.company || {};
    const setFieldText = (key, value) => {
      const el = resolveFieldEl(key);
      if (el) {
        el.textContent = value ?? '';
      }
      return el;
    };
    setFieldText('ersteller', header.ersteller);
    setFieldText('standort', header.standort);
    setFieldText('kultur', header.kultur);
    setFieldText('datum', header.datum);

    const updateCompanyRowVisibility = (rowKey, visible) => {
      const row = resultCard.querySelector(`[data-company-row="${rowKey}"]`);
      if (row) {
        row.classList.toggle('d-none', !visible);
      }
    };

    const headlineValue = companyData.headline?.trim() || '';
    const headlineEl = setFieldText('companyHeadline', headlineValue);
    updateCompanyRowVisibility('headline', Boolean(headlineValue));

    const addressEl = resolveFieldEl('companyAddress');
    const addressValue = companyData.address?.trim() || '';
    if (addressEl) {
      addressEl.textContent = addressValue;
      updateCompanyRowVisibility('address', Boolean(addressValue));
    }

    const emailEl = resolveFieldEl('companyEmail');
    const emailValue = companyData.contactEmail?.trim() || '';
    if (emailEl) {
      if (emailValue) {
        emailEl.textContent = emailValue;
        emailEl.setAttribute('href', `mailto:${emailValue}`);
      } else {
        emailEl.textContent = '';
        emailEl.removeAttribute('href');
      }
      updateCompanyRowVisibility('email', Boolean(emailValue));
    }

    const companyColumn = resultCard.querySelector('.calc-summary-company');
    if (companyColumn) {
      const hasVisibleRow = Array.from(companyColumn.querySelectorAll('[data-company-row]')).some(row => !row.classList.contains('d-none'));
      companyColumn.classList.toggle('d-none', !hasVisibleRow);
    }

    if (resultsHead) {
      resultsHead.innerHTML = buildMediumTableHead(labels, 'calculation');
    }
    resultsBody.innerHTML = buildMediumTableRows(items, labels, 'calculation');
    resultCard.classList.remove('d-none');
  }

  services.state.subscribe((nextState) => renderResults(nextState.calcContext, nextState.fieldLabels));

  form.addEventListener('submit', event => {
    event.preventDefault();
    const formData = new FormData(form);
    const rawErsteller = (formData.get('calc-ersteller') || '').toString().trim();
    const rawStandort = (formData.get('calc-standort') || '').toString().trim();
    const rawKultur = (formData.get('calc-kultur') || '').toString().trim();
    const rawKisten = (formData.get('calc-kisten') || '').toString().trim();
    const ersteller = rawErsteller;
    const standort = rawStandort || '-';
    const kultur = rawKultur || '-';
    const kisten = Number(rawKisten);
    if (!ersteller || Number.isNaN(kisten)) {
      alert('Bitte Felder korrekt ausfüllen!');
      return;
    }

    const state = getState();
    const defaults = state.defaults;
    const measurementMethods = state.measurementMethods;
    const waterVolume = getWaterVolume(kisten, defaults);
    const areaAr = defaults.kistenProAr ? kisten / defaults.kistenProAr : 0;
    const areaSqm = areaAr * 100;

    const inputs = {
      kisten,
      waterVolume,
      areaAr,
      areaSqm
    };

    const items = state.mediums.map(medium => {
      const method = measurementMethods.find(m => m.id === medium.methodId);
      const total = executeFormula(medium, method, inputs, defaults);
      return {
        id: medium.id,
        name: medium.name,
        unit: medium.unit,
        methodLabel: method ? method.label : medium.methodId,
        methodId: medium.methodId,
        value: medium.value,
        total,
        inputs
      };
    });

    const header = {
      ersteller,
      standort,
      kultur,
      kisten,
      datum: new Date().toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' }),
      waterVolume,
      areaAr,
      areaSqm
    };

    const calculation = {
      header,
      items
    };

    services.state.updateSlice('defaults', defaultsState => ({
      ...defaultsState,
      form: {
        ...(defaultsState.form || { creator: '', location: '', crop: '', quantity: '' }),
        creator: rawErsteller,
        location: rawStandort,
        crop: rawKultur,
        quantity: rawKisten
      }
    }));

    services.state.updateSlice('calcContext', () => calculation);
  });

  resultCard.addEventListener('click', event => {
    const action = event.target.dataset.action;
    if (!action) {
      return;
    }
    if (action === 'print') {
      window.print();
    } else if (action === 'save') {
      const calc = getState().calcContext;
      if (!calc) {
        alert('Keine Berechnung vorhanden.');
        return;
      }
      services.state.updateSlice('history', history => {
        const entry = {
          ...calc.header,
          items: calc.items,
          savedAt: new Date().toISOString()
        };
        return [...history, entry];
      });
      persistHistory(services).catch(err => {
        console.error('Persist history promise error', err);
      });
      alert('Berechnung gespeichert! (Siehe Historie)');
    }
  });

  renderResults(getState().calcContext, getState().fieldLabels);

  initialized = true;
}
