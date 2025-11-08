/**
 * BVL Sync Orchestrator
 * Coordinates fetching and storing BVL data with progress reporting
 */

import { fetchCollection, computeDatasetHashes } from './bvlClient.js';

const ENDPOINTS = ['mittel', 'awg', 'awg_kultur', 'awg_schadorg', 'awg_aufwand', 'awg_wartezeit'];

/**
 * Sync BVL data with progress and logging callbacks
 */
export async function syncBvlData(storage, options = {}) {
  const {
    onProgress = () => {},
    onLog = () => {}
  } = options;

  const startTime = Date.now();
  const log = (level, message, data = null) => {
    onLog({
      level,
      message,
      data,
      timestamp: new Date().toISOString()
    });
  };

  try {
    onProgress({ step: 'start', percent: 0, message: 'Starte Synchronisation...' });
    log('info', 'Starting BVL data sync');

    if (!navigator.onLine) {
      throw new Error('Keine Internetverbindung verfügbar');
    }

    const datasets = {};
    const fetchTimes = {};
    let totalProgress = 0;
    const progressPerEndpoint = 70 / ENDPOINTS.length;

    for (const endpoint of ENDPOINTS) {
      const endpointStart = Date.now();
      onProgress({
        step: `fetch:${endpoint}`,
        percent: Math.round(10 + totalProgress),
        message: `Lade ${endpoint}...`
      });
      log('info', `Fetching ${endpoint}`);

      try {
        const items = await fetchCollection(endpoint, {
          onProgress: (progress) => {
            log('debug', `Fetch progress for ${endpoint}`, progress);
          }
        });

        datasets[endpoint] = items;
        fetchTimes[endpoint] = Date.now() - endpointStart;
        
        log('info', `Fetched ${items.length} items from ${endpoint} in ${fetchTimes[endpoint]}ms`);
        totalProgress += progressPerEndpoint;
      } catch (error) {
        log('error', `Failed to fetch ${endpoint}`, {
          error: error.message,
          type: error.name,
          status: error.status,
          attempt: error.attempt
        });
        throw new Error(`Fehler beim Laden von ${endpoint}: ${error.message}`);
      }
    }

    onProgress({ step: 'transform', percent: 80, message: 'Verarbeite Daten...' });
    log('info', 'Transforming data');

    const transformed = transformBvlData(datasets);
    const hashes = await computeDatasetHashes(datasets);
    
    log('info', 'Data transformation complete', {
      counts: Object.entries(transformed).reduce((acc, [key, val]) => {
        acc[key] = Array.isArray(val) ? val.length : 0;
        return acc;
      }, {}),
      hashes
    });

    const previousHash = await storage.getBvlMeta('lastSyncHash');
    if (previousHash === hashes.combined) {
      onProgress({ step: 'done', percent: 100, message: 'Keine Aktualisierung erforderlich' });
      
      const meta = {
        lastSyncHash: hashes.combined,
        lastSyncIso: new Date().toISOString(),
        lastSyncCounts: Object.entries(transformed).reduce((acc, [key, val]) => {
          acc[key] = Array.isArray(val) ? val.length : 0;
          return acc;
        }, {}),
        lastError: null
      };

      await storage.appendBvlSyncLog({
        synced_at: meta.lastSyncIso,
        ok: 1,
        message: 'no-change',
        payload_hash: hashes.combined
      });

      log('info', 'No changes detected, sync complete');
      return { status: 'no-change', meta };
    }

    onProgress({ step: 'write', percent: 85, message: 'Schreibe in Datenbank...' });
    log('info', 'Writing to database');

    const writeStart = Date.now();
    await storage.importBvlDataset(transformed, {
      hash: hashes.combined,
      fetchTimes
    });
    const writeDuration = Date.now() - writeStart;

    log('info', `Database write complete in ${writeDuration}ms`);

    onProgress({ step: 'verify', percent: 95, message: 'Verifiziere Daten...' });
    log('info', 'Verifying data');

    const meta = {
      lastSyncHash: hashes.combined,
      lastSyncIso: new Date().toISOString(),
      lastSyncCounts: Object.entries(transformed).reduce((acc, [key, val]) => {
        acc[key] = Array.isArray(val) ? val.length : 0;
        return acc;
      }, {}),
      lastError: null
    };

    for (const [key, value] of Object.entries(meta)) {
      await storage.setBvlMeta(key, typeof value === 'object' ? JSON.stringify(value) : value);
    }

    const totalDuration = Date.now() - startTime;
    await storage.appendBvlSyncLog({
      synced_at: meta.lastSyncIso,
      ok: 1,
      message: `success (${totalDuration}ms)`,
      payload_hash: hashes.combined
    });

    onProgress({ step: 'done', percent: 100, message: 'Synchronisation abgeschlossen' });
    log('info', `Sync complete in ${totalDuration}ms`, { meta });

    return { status: 'success', meta };
  } catch (error) {
    const errorMessage = error.message || 'Unbekannter Fehler';
    log('error', 'Sync failed', { error: errorMessage, stack: error.stack });

    const meta = {
      lastError: errorMessage,
      lastErrorTime: new Date().toISOString()
    };

    try {
      await storage.setBvlMeta('lastError', errorMessage);
      await storage.appendBvlSyncLog({
        synced_at: new Date().toISOString(),
        ok: 0,
        message: errorMessage,
        payload_hash: null
      });
    } catch (e) {
      log('error', 'Failed to write error state', { error: e.message });
    }

    onProgress({
      step: 'error',
      percent: 0,
      message: `Fehler: ${errorMessage}`
    });

    throw error;
  }
}

/**
 * Transform raw BVL data into database-ready format
 */
function transformBvlData(datasets) {
  const result = {
    mittel: [],
    awg: [],
    awg_kultur: [],
    awg_schadorg: [],
    awg_aufwand: [],
    awg_wartezeit: []
  };

  if (datasets.mittel) {
    result.mittel = datasets.mittel.map(item => ({
      kennr: item.kennr || '',
      name: item.mittelname || '',
      formulierung: item.formulierung || '',
      zul_erstmalig: item.zul_erstmalig || null,
      zul_ende: item.zul_ende || null,
      geringes_risiko: item.geringes_risiko === 'J' ? 1 : 0,
      payload_json: JSON.stringify(item)
    }));
  }

  if (datasets.awg) {
    result.awg = datasets.awg.map(item => ({
      awg_id: item.awg_id || '',
      kennr: item.kennr || '',
      status_json: JSON.stringify({
        status: item.status || '',
        wachstumsstadium: item.wachstumsstadium || ''
      }),
      zulassungsende: item.zulassungsende || null
    }));
  }

  if (datasets.awg_kultur) {
    result.awg_kultur = datasets.awg_kultur.map(item => ({
      awg_id: item.awg_id || '',
      kultur: item.kultur || '',
      ausgenommen: item.ausgenommen === 'J' ? 1 : 0,
      sortier_nr: parseInt(item.sortier_nr) || 0
    }));
  }

  if (datasets.awg_schadorg) {
    result.awg_schadorg = datasets.awg_schadorg.map(item => ({
      awg_id: item.awg_id || '',
      schadorg: item.schadorg || '',
      ausgenommen: item.ausgenommen === 'J' ? 1 : 0,
      sortier_nr: parseInt(item.sortier_nr) || 0
    }));
  }

  if (datasets.awg_aufwand) {
    result.awg_aufwand = datasets.awg_aufwand.map(item => ({
      awg_id: item.awg_id || '',
      aufwand_bedingung: item.aufwandbedingung || '',
      sortier_nr: parseInt(item.sortier_nr) || 0,
      mittel_menge: parseFloat(item.max_aufwandmenge) || null,
      mittel_einheit: item.aufwandmenge_einheit || null,
      wasser_menge: parseFloat(item.wassermenge) || null,
      wasser_einheit: item.wassermenge_einheit || null,
      payload_json: JSON.stringify(item)
    }));
  }

  if (datasets.awg_wartezeit) {
    result.awg_wartezeit = datasets.awg_wartezeit.map(item => ({
      awg_wartezeit_nr: parseInt(item.awg_wartezeit_nr) || 0,
      awg_id: item.awg_id || '',
      kultur: item.kultur || '',
      sortier_nr: parseInt(item.sortier_nr) || 0,
      tage: parseInt(item.wartezeit_tage) || null,
      bemerkung_kode: item.bemerkung_kode || null,
      anwendungsbereich: item.anwendungsbereich || null,
      erlaeuterung: item.erlaeuterung || null,
      payload_json: JSON.stringify(item)
    }));
  }

  return result;
}
