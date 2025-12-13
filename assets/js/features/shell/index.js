const SECTION_MAP = [
  { id: 'calc', label: 'Berechnung' },
  { id: 'history', label: 'Historie' },
  { id: 'zulassung', label: 'Zulassung', requiresDb: true },
  { id: 'settings', label: 'Einstellungen' },
  { id: 'report', label: 'Auswertung' }
];

let initialized = false;
let printHooksInstalled = false;
let isPrinting = false;
let activeDocumentTitle = document.title || 'Pflanzenschutz';

function ensurePrintHooks() {
  if (printHooksInstalled) {
    return;
  }
  const beforePrint = () => {
    if (isPrinting) {
      return;
    }
    isPrinting = true;
    document.title = ' ';
  };
  const afterPrint = () => {
    if (!isPrinting) {
      return;
    }
    isPrinting = false;
    document.title = activeDocumentTitle;
  };
  window.addEventListener('beforeprint', beforePrint);
  window.addEventListener('afterprint', afterPrint);
  printHooksInstalled = true;
}

export function initShell(regions, services) {
  if (initialized) {
    return;
  }
  const { shell, footer } = regions;
  if (!shell) {
    console.warn('shell region fehlt');
    return;
  }

  const nav = document.createElement('nav');
  nav.className = 'navbar navbar-dark shell-navbar mb-4 no-print';
  nav.innerHTML = `
    <div class="container">
      <a class="navbar-brand d-flex align-items-center gap-2" href="#">
        <img class="brand-logo" alt="Firmalogo" />
        <div class="brand-copy d-flex flex-column">
          <span class="brand-title h4 mb-0"></span>
          <span class="brand-tagline small text-muted"></span>
        </div>
      </a>
      <div class="d-flex flex-wrap gap-2"></div>
    </div>
  `;
  const actionContainer = nav.querySelector('.d-flex');

  SECTION_MAP.forEach(section => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm btn-outline-light nav-btn';
    button.dataset.section = section.id;
    button.dataset.requiresDb = section.requiresDb ? 'true' : 'false';
    button.textContent = section.label;
    button.addEventListener('click', evt => {
      evt.preventDefault();
      services.state.updateSlice('app', app => ({
        ...app,
        activeSection: section.id
      }));
    });
    actionContainer.appendChild(button);
  });

  const brandLogo = nav.querySelector('.brand-logo');
  const brandTitle = nav.querySelector('.brand-title');
  const brandTagline = nav.querySelector('.brand-tagline');

  function updateShell(state) {
    const { company, app } = state;
    if (company.logoUrl) {
      brandLogo.src = company.logoUrl;
      brandLogo.classList.remove('d-none');
    } else {
      brandLogo.classList.add('d-none');
    }
    brandLogo.alt = company.name || 'Logo';
    brandTitle.textContent = company.name || 'Pflanzenschutz';
    brandTagline.textContent = company.headline || '';
  brandTagline.classList.toggle('d-none', !company.headline);
    if (company.accentColor) {
      brandTagline.style.color = company.accentColor;
    } else {
      brandTagline.style.removeProperty('color');
    }

    nav.style.setProperty('--accent-color', company.accentColor || '');
    const nextTitle = company.name ? `${company.name} – Pflanzenschutz` : 'Pflanzenschutz';
    activeDocumentTitle = nextTitle;
    if (!isPrinting) {
      document.title = nextTitle;
    }

    const buttons = nav.querySelectorAll('[data-section]');
    buttons.forEach(btn => {
      const requiresDb = btn.dataset.requiresDb === 'true';
      
      if (btn.dataset.section === app.activeSection) {
        btn.classList.add('active');
        btn.classList.remove('btn-outline-light');
        btn.classList.add('btn-success');
      } else {
        btn.classList.remove('active');
        btn.classList.add('btn-outline-light');
        btn.classList.remove('btn-success');
      }
      
      // Hide Zulassung tab if no database, disable all others
      if (requiresDb && !app.hasDatabase) {
        btn.style.display = 'none';
      } else if (requiresDb && app.hasDatabase) {
        btn.style.display = '';
      }
      
      btn.disabled = !app.hasDatabase;
    });
    nav.classList.toggle('d-none', !app.hasDatabase);
  }

  updateShell(services.state.getState());
  ensurePrintHooks();
  services.state.subscribe((nextState) => updateShell(nextState));

  shell.innerHTML = '';
  shell.appendChild(nav);

  if (footer) {
    footer.innerHTML = '';
    const footerEl = document.createElement('footer');
    footerEl.className = 'site-footer no-print';
    const currentYear = new Date().getFullYear();
    footerEl.innerHTML = `
      <div class="container d-flex justify-content-between align-items-center flex-wrap gap-2">
        <span class="footer-copy">&copy; ${currentYear} Digitale PSM</span>
        <a class="footer-link footer-link--icon" href="https://www.digitale-psm.de" target="_blank" rel="noopener" aria-label="Digitale PSM Website">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm7.5-6.923c-.67.204-1.335.82-1.887 1.855A7.97 7.97 0 0 0 5.145 4H7.5V1.077zM4.09 4a9.267 9.267 0 0 1 .64-1.539 6.7 6.7 0 0 1 .597-.933A7.025 7.025 0 0 0 2.255 4H4.09zm-.582 3.5c.03-.877.138-1.718.312-2.5H1.674a6.958 6.958 0 0 0-.656 2.5h2.49zM4.847 5a12.5 12.5 0 0 0-.338 2.5H7.5V5H4.847zM8.5 5v2.5h2.99a12.495 12.495 0 0 0-.337-2.5H8.5zM4.51 8.5a12.5 12.5 0 0 0 .337 2.5H7.5V8.5H4.51zm3.99 0V11h2.653c.187-.765.306-1.608.338-2.5H8.5zM5.145 12c.138.386.295.744.468 1.068.552 1.035 1.218 1.65 1.887 1.855V12H5.145zm.182 2.472a6.696 6.696 0 0 1-.597-.933A9.268 9.268 0 0 1 4.09 12H2.255a7.024 7.024 0 0 0 3.072 2.472zM3.82 11a13.652 13.652 0 0 1-.312-2.5h-2.49c.062.89.291 1.733.656 2.5H3.82zm6.853 3.472A7.024 7.024 0 0 0 13.745 12H11.91a9.27 9.27 0 0 1-.64 1.539 6.688 6.688 0 0 1-.597.933zM8.5 12v2.923c.67-.204 1.335-.82 1.887-1.855.173-.324.33-.682.468-1.068H8.5zm3.68-1h2.146c.365-.767.594-1.61.656-2.5h-2.49a13.65 13.65 0 0 1-.312 2.5zm2.802-3.5a6.959 6.959 0 0 0-.656-2.5H12.18c.174.782.282 1.623.312 2.5h2.49zM11.27 2.461c.247.464.462.98.64 1.539h1.835a7.024 7.024 0 0 0-3.072-2.472c.218.284.418.598.597.933zM10.855 4a7.966 7.966 0 0 0-.468-1.068C9.835 1.897 9.17 1.282 8.5 1.077V4h2.355z"/>
          </svg>
        </a>
      </div>
    `;
    footer.appendChild(footerEl);
  }

  initialized = true;
}
