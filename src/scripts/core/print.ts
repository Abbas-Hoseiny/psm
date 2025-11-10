const BASE_FONT_STACK = '"Helvetica Neue", Helvetica, Arial, sans-serif';

let overlayElement: HTMLDivElement | null = null;

function ensureOverlay(): HTMLDivElement {
  if (!overlayElement) {
    overlayElement = document.createElement('div');
    overlayElement.id = 'print-overlay';
    overlayElement.className = 'print-overlay';
    document.body.appendChild(overlayElement);
  }
  return overlayElement;
}

function cleanupOverlay(): void {
  if (!overlayElement) {
    return;
  }
  overlayElement.innerHTML = '';
  document.body.classList.remove('print-overlay-active');
}

function openPopup(html: string, onFail?: (popup?: Window | null) => void): Window | null {
  let popup: Window | null = null;
  try {
    popup = window.open('', '_blank', 'noopener,noreferrer,width=1024,height=768');
  } catch (err) {
    console.warn('window.open failed', err);
  }
  if (!popup) {
    if (onFail) {
      onFail();
    }
    return null;
  }
  try {
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
  } catch (err) {
    console.error('Unable to write into print window', err);
    if (onFail) {
      onFail(popup);
    }
    return null;
  }
  return popup;
}

export function printHtml({ title = 'Druck', styles = '', content = '' }: { title?: string; styles?: string; content: string }): void {
  const safeTitle = String(title ?? 'Druck').replace(/[<>]/g, '');
  const pageStyles = `@page { size: A4; margin: 18mm; }
    body { font-family: ${BASE_FONT_STACK}; color: #111; line-height: 1.45; }
    h1, h2, h3 { margin: 0 0 0.75rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #555; padding: 6px 8px; text-align: left; vertical-align: top; }
    .nowrap { white-space: nowrap; }
    .print-meta { margin-bottom: 1rem; }
    .print-meta p { margin: 0; }
    ${styles}`;

  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>${pageStyles}</style>
  </head><body>${content}</body></html>`;

  const popup = openPopup(html, (blockedPopup) => {
    const overlay = ensureOverlay();
    overlay.innerHTML = `<style>${pageStyles}</style>${content}`;
    document.body.classList.add('print-overlay-active');

    const handleAfterPrint = () => {
      cleanupOverlay();
      window.removeEventListener('afterprint', handleAfterPrint);
    };
    window.addEventListener('afterprint', handleAfterPrint, { once: true });
    window.print();

    if (blockedPopup) {
      try {
        blockedPopup.close();
      } catch (err) {
        console.warn('Unable to close blocked popup', err);
      }
    }
  });

  if (!popup) {
    return;
  }

  const triggerPrint = () => {
    try {
      popup.focus();
    } catch (err) {
      console.warn('Cannot focus print popup', err);
    }
    try {
      popup.print();
    } catch (err) {
      console.error('Popup print failed', err);
    }
    const close = () => {
      try {
        popup.close();
      } catch (err) {
        console.warn('Cannot close print popup', err);
      }
    };
    if (popup.addEventListener) {
      popup.addEventListener('afterprint', close, { once: true });
    }
    setTimeout(close, 800);
  };

  if (popup.document.readyState === 'complete') {
    setTimeout(triggerPrint, 50);
  } else {
    popup.addEventListener('load', () => {
      setTimeout(triggerPrint, 50);
    });
  }
}
