/**
 * Zulassung Feature Module
 * Handles BVL approval data display and synchronization
 */

import { syncBvlData } from '../../core/bvlSync.js';
import * as storage from '../../core/storage/sqlite.js';

let container = null;
let services = null;

export function initZulassung(mainContainer, appServices) {
  container = mainContainer;
  services = appServices;

  services.events.subscribe('section:change', (data) => {
    if (data.section === 'zulassung') {
      render();
    } else {
      hide();
    }
  });

  services.events.subscribe('database:connected', async () => {
    await loadInitialData();
  });
}

function hide() {
  const existingSection = container.querySelector('[data-section="zulassung"]');
  if (existingSection) {
    existingSection.style.display = 'none';
  }
}

async function loadInitialData() {
  try {
    const lastSync = await storage.getBvlMeta('lastSyncIso');
    const lastSyncCounts = await storage.getBvlMeta('lastSyncCounts');
    
    services.state.updateSlice('zulassung', (prev) => ({
      ...prev,
      lastSync: lastSync || null,
      lastResultCounts: lastSyncCounts ? JSON.parse(lastSyncCounts) : null
    }));

    const cultures = await storage.listBvlCultures();
    const pests = await storage.listBvlSchadorg();
    
    services.state.updateSlice('zulassung', (prev) => ({
      ...prev,
      lookups: { cultures, pests }
    }));
  } catch (error) {
    console.error('Failed to load initial Zulassung data:', error);
  }
}

function render() {
  let section = container.querySelector('[data-section="zulassung"]');
  
  if (!section) {
    section = document.createElement('div');
    section.setAttribute('data-section', 'zulassung');
    section.className = 'section-content';
    container.appendChild(section);
  }
  
  section.style.display = 'block';
  
  const state = services.state.getState();
  const { zulassung } = state;
  
  section.innerHTML = `
    <div class="container py-4">
      <h2>BVL Zulassungsdaten</h2>
      
      ${renderStatusSection(zulassung)}
      ${renderSyncSection(zulassung)}
      ${renderFilterSection(zulassung)}
      ${renderResultsSection(zulassung)}
      ${renderDebugSection(zulassung)}
    </div>
  `;
  
  attachEventHandlers(section);
}

function renderStatusSection(zulassung) {
  if (!zulassung.lastSync) {
    return `
      <div class="alert alert-info mb-3">
        <strong>Keine Daten vorhanden.</strong> Bitte führen Sie eine Synchronisation durch, um BVL-Daten zu laden.
      </div>
    `;
  }
  
  const lastSyncDate = new Date(zulassung.lastSync).toLocaleString('de-DE');
  const counts = zulassung.lastResultCounts || {};
  
  return `
    <div class="alert alert-success mb-3">
      <strong>Letzte Synchronisation:</strong> ${lastSyncDate}<br>
      <small>
        Mittel: ${counts.mittel || 0}, 
        Anwendungen: ${counts.awg || 0}, 
        Kulturen: ${counts.awg_kultur || 0}, 
        Schadorganismen: ${counts.awg_schadorg || 0}
      </small>
    </div>
  `;
}

function renderSyncSection(zulassung) {
  const isBusy = zulassung.busy;
  const progress = zulassung.progress;
  const error = zulassung.error;
  
  return `
    <div class="card mb-3">
      <div class="card-body">
        <h5 class="card-title">Synchronisation</h5>
        
        <button 
          id="btn-sync" 
          class="btn btn-primary" 
          ${isBusy ? 'disabled' : ''}
        >
          ${isBusy ? '<span class="spinner-border spinner-border-sm me-2"></span>' : ''}
          ${isBusy ? 'Synchronisiere...' : 'Daten aktualisieren'}
        </button>
        
        ${progress.step && isBusy ? `
          <div class="progress mt-3" style="height: 25px;">
            <div 
              class="progress-bar progress-bar-striped progress-bar-animated" 
              role="progressbar" 
              style="width: ${progress.percent}%"
              aria-valuenow="${progress.percent}" 
              aria-valuemin="0" 
              aria-valuemax="100"
            >
              ${progress.percent}% - ${progress.message}
            </div>
          </div>
        ` : ''}
        
        ${error ? `
          <div class="alert alert-danger mt-3">
            <strong>Fehler:</strong> ${error}
            <button class="btn btn-sm btn-link" id="btn-show-debug">Details einblenden</button>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function renderFilterSection(zulassung) {
  const { filters, lookups, busy } = zulassung;
  
  return `
    <div class="card mb-3">
      <div class="card-body">
        <h5 class="card-title">Filter</h5>
        
        <div class="row g-3">
          <div class="col-md-4">
            <label for="filter-culture" class="form-label">Kultur</label>
            <select id="filter-culture" class="form-select">
              <option value="">Alle Kulturen</option>
              ${lookups.cultures.map(c => 
                `<option value="${c}" ${filters.culture === c ? 'selected' : ''}>${c}</option>`
              ).join('')}
            </select>
          </div>
          
          <div class="col-md-4">
            <label for="filter-pest" class="form-label">Schadorganismus</label>
            <select id="filter-pest" class="form-select">
              <option value="">Alle Schadorganismen</option>
              ${lookups.pests.map(p => 
                `<option value="${p}" ${filters.pest === p ? 'selected' : ''}>${p}</option>`
              ).join('')}
            </select>
          </div>
          
          <div class="col-md-4">
            <label for="filter-text" class="form-label">Text</label>
            <input 
              type="text" 
              id="filter-text" 
              class="form-control" 
              placeholder="Mittel oder Kennnummer"
              value="${filters.text || ''}"
            >
          </div>
        </div>
        
        <div class="form-check mt-3">
          <input 
            class="form-check-input" 
            type="checkbox" 
            id="filter-expired"
            ${filters.includeExpired ? 'checked' : ''}
          >
          <label class="form-check-label" for="filter-expired">
            Abgelaufene Zulassungen einschließen
          </label>
        </div>
        
        <button 
          id="btn-search" 
          class="btn btn-primary mt-3"
          ${busy ? 'disabled' : ''}
        >
          Suchen
        </button>
        
        <button id="btn-clear-filters" class="btn btn-secondary mt-3 ms-2">
          Filter zurücksetzen
        </button>
      </div>
    </div>
  `;
}

function renderResultsSection(zulassung) {
  const { results } = zulassung;
  
  if (results.length === 0) {
    return `
      <div class="card mb-3">
        <div class="card-body">
          <h5 class="card-title">Ergebnisse</h5>
          <p class="text-muted">Keine Ergebnisse. Bitte wählen Sie Filter aus und klicken Sie auf "Suchen".</p>
        </div>
      </div>
    `;
  }
  
  return `
    <div class="card mb-3">
      <div class="card-body">
        <h5 class="card-title">Ergebnisse (${results.length})</h5>
        
        <div class="list-group">
          ${results.map(result => renderResultItem(result)).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderResultItem(result) {
  const status = result.status_json ? JSON.parse(result.status_json) : {};
  
  return `
    <div class="list-group-item">
      <div class="d-flex w-100 justify-content-between">
        <h6 class="mb-1">${result.name}</h6>
        <small class="text-muted">${result.kennr}</small>
      </div>
      
      <p class="mb-1">
        <strong>Formulierung:</strong> ${result.formulierung || '-'}<br>
        <strong>Status:</strong> ${status.status || '-'}<br>
        ${result.geringes_risiko ? '<span class="badge bg-success">Geringes Risiko</span>' : ''}
        ${result.zul_ende ? `<span class="badge bg-warning text-dark">Gültig bis: ${result.zul_ende}</span>` : ''}
      </p>
      
      ${result.kulturen && result.kulturen.length > 0 ? `
        <div class="mt-2">
          <strong>Kulturen:</strong>
          ${result.kulturen.map(k => 
            `<span class="badge ${k.ausgenommen ? 'bg-danger' : 'bg-info'}">${k.kultur}${k.ausgenommen ? ' (ausgenommen)' : ''}</span>`
          ).join(' ')}
        </div>
      ` : ''}
      
      ${result.schadorganismen && result.schadorganismen.length > 0 ? `
        <div class="mt-2">
          <strong>Schadorganismen:</strong>
          ${result.schadorganismen.map(s => 
            `<span class="badge ${s.ausgenommen ? 'bg-danger' : 'bg-secondary'}">${s.schadorg}${s.ausgenommen ? ' (ausgenommen)' : ''}</span>`
          ).join(' ')}
        </div>
      ` : ''}
      
      ${result.aufwaende && result.aufwaende.length > 0 ? `
        <div class="mt-2">
          <strong>Aufwände:</strong>
          <ul class="small mb-0">
            ${result.aufwaende.map(a => `
              <li>
                ${a.aufwand_bedingung || 'Standard'}: 
                ${a.mittel_menge || '-'} ${a.mittel_einheit || ''} Mittel
                ${a.wasser_menge ? `, ${a.wasser_menge} ${a.wasser_einheit || ''} Wasser` : ''}
              </li>
            `).join('')}
          </ul>
        </div>
      ` : ''}
      
      ${result.wartezeiten && result.wartezeiten.length > 0 ? `
        <div class="mt-2">
          <strong>Wartezeiten:</strong>
          <ul class="small mb-0">
            ${result.wartezeiten.map(w => `
              <li>
                ${w.kultur}: ${w.tage || '-'} Tage
                ${w.anwendungsbereich ? ` (${w.anwendungsbereich})` : ''}
              </li>
            `).join('')}
          </ul>
        </div>
      ` : ''}
    </div>
  `;
}

function renderDebugSection(zulassung) {
  const { debug, logs } = zulassung;
  
  return `
    <div class="card mb-3">
      <div class="card-body">
        <h5 class="card-title">
          <button 
            class="btn btn-sm btn-link text-decoration-none p-0" 
            type="button" 
            data-bs-toggle="collapse" 
            data-bs-target="#debug-panel"
          >
            Debug-Informationen ▼
          </button>
        </h5>
        
        <div class="collapse" id="debug-panel">
          <div class="mt-3">
            <h6>Sync-Logs (letzte 10)</h6>
            <div class="table-responsive">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>Zeit</th>
                    <th>Status</th>
                    <th>Nachricht</th>
                  </tr>
                </thead>
                <tbody>
                  ${debug.lastSyncLog && debug.lastSyncLog.length > 0 
                    ? debug.lastSyncLog.map(log => `
                      <tr>
                        <td><small>${new Date(log.synced_at).toLocaleString('de-DE')}</small></td>
                        <td>${log.ok ? '<span class="badge bg-success">OK</span>' : '<span class="badge bg-danger">Fehler</span>'}</td>
                        <td><small>${log.message}</small></td>
                      </tr>
                    `).join('')
                    : '<tr><td colspan="3" class="text-muted">Keine Logs vorhanden</td></tr>'
                  }
                </tbody>
              </table>
            </div>
          </div>
          
          ${logs.length > 0 ? `
            <div class="mt-3">
              <h6>Aktuelle Session Logs</h6>
              <div class="bg-dark text-light p-2" style="max-height: 200px; overflow-y: auto; font-family: monospace; font-size: 12px;">
                ${logs.slice(-50).map(log => 
                  `<div>[${log.level.toUpperCase()}] ${log.message}</div>`
                ).join('')}
              </div>
            </div>
          ` : ''}
          
          ${debug.schema ? `
            <div class="mt-3">
              <h6>Schema-Informationen</h6>
              <p><strong>User Version:</strong> ${debug.schema.user_version}</p>
              <details>
                <summary>Tabellen</summary>
                <pre class="bg-dark text-light p-2" style="font-size: 11px;">${JSON.stringify(debug.schema.tables, null, 2)}</pre>
              </details>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

function attachEventHandlers(section) {
  const btnSync = section.querySelector('#btn-sync');
  const btnSearch = section.querySelector('#btn-search');
  const btnClearFilters = section.querySelector('#btn-clear-filters');
  const btnShowDebug = section.querySelector('#btn-show-debug');
  
  if (btnSync) {
    btnSync.addEventListener('click', handleSync);
  }
  
  if (btnSearch) {
    btnSearch.addEventListener('click', handleSearch);
  }
  
  if (btnClearFilters) {
    btnClearFilters.addEventListener('click', handleClearFilters);
  }
  
  if (btnShowDebug) {
    btnShowDebug.addEventListener('click', () => {
      const debugPanel = section.querySelector('#debug-panel');
      if (debugPanel) {
        const collapse = new bootstrap.Collapse(debugPanel, { toggle: true });
      }
    });
  }
  
  const filterCulture = section.querySelector('#filter-culture');
  const filterPest = section.querySelector('#filter-pest');
  const filterText = section.querySelector('#filter-text');
  const filterExpired = section.querySelector('#filter-expired');
  
  if (filterCulture) {
    filterCulture.addEventListener('change', (e) => {
      services.state.updateSlice('zulassung', (prev) => ({
        ...prev,
        filters: { ...prev.filters, culture: e.target.value || null }
      }));
    });
  }
  
  if (filterPest) {
    filterPest.addEventListener('change', (e) => {
      services.state.updateSlice('zulassung', (prev) => ({
        ...prev,
        filters: { ...prev.filters, pest: e.target.value || null }
      }));
    });
  }
  
  if (filterText) {
    filterText.addEventListener('input', (e) => {
      services.state.updateSlice('zulassung', (prev) => ({
        ...prev,
        filters: { ...prev.filters, text: e.target.value }
      }));
    });
  }
  
  if (filterExpired) {
    filterExpired.addEventListener('change', (e) => {
      services.state.updateSlice('zulassung', (prev) => ({
        ...prev,
        filters: { ...prev.filters, includeExpired: e.target.checked }
      }));
    });
  }
}

async function handleSync() {
  services.state.updateSlice('zulassung', (prev) => ({
    ...prev,
    busy: true,
    error: null,
    logs: [],
    progress: { step: 'start', percent: 0, message: 'Starte...' }
  }));
  
  render();
  
  try {
    const result = await syncBvlData(storage, {
      onProgress: (progress) => {
        services.state.updateSlice('zulassung', (prev) => ({
          ...prev,
          progress
        }));
        render();
      },
      onLog: (log) => {
        services.state.updateSlice('zulassung', (prev) => ({
          ...prev,
          logs: [...prev.logs, log]
        }));
      }
    });
    
    services.state.updateSlice('zulassung', (prev) => ({
      ...prev,
      busy: false,
      lastSync: result.meta.lastSyncIso,
      lastResultCounts: result.meta.lastSyncCounts,
      progress: { step: null, percent: 0, message: '' }
    }));
    
    await loadInitialData();
    
    const syncLog = await storage.listBvlSyncLog({ limit: 10 });
    const schema = await storage.diagnoseBvlSchema();
    
    services.state.updateSlice('zulassung', (prev) => ({
      ...prev,
      debug: { schema, lastSyncLog: syncLog }
    }));
    
    render();
  } catch (error) {
    services.state.updateSlice('zulassung', (prev) => ({
      ...prev,
      busy: false,
      error: error.message,
      progress: { step: null, percent: 0, message: '' }
    }));
    
    render();
  }
}

async function handleSearch() {
  const state = services.state.getState();
  const { filters } = state.zulassung;
  
  services.state.updateSlice('zulassung', (prev) => ({
    ...prev,
    busy: true
  }));
  
  render();
  
  try {
    const results = await storage.queryZulassung(filters);
    
    services.state.updateSlice('zulassung', (prev) => ({
      ...prev,
      busy: false,
      results
    }));
    
    render();
  } catch (error) {
    services.state.updateSlice('zulassung', (prev) => ({
      ...prev,
      busy: false,
      error: error.message
    }));
    
    render();
  }
}

function handleClearFilters() {
  services.state.updateSlice('zulassung', (prev) => ({
    ...prev,
    filters: { culture: null, pest: null, text: '', includeExpired: false },
    results: []
  }));
  
  render();
}
