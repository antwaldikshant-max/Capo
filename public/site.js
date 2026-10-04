const icons = ['✦', '◈', '▣', '◉', '⌘'];
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const formatUsd = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(amount));

const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('.primary-nav');
menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  nav.classList.toggle('open', open);
});
nav.addEventListener('click', (event) => {
  if (event.target.closest('a')) {
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open navigation');
    nav.classList.remove('open');
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && nav.classList.contains('open')) {
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open navigation');
    nav.classList.remove('open');
    menuButton.focus();
  }
});

function renderServices(services) {
  const host = document.querySelector('#service-list');
  if (!services.length) {
    host.innerHTML = '<p class="loading-card">Services will be added here by Capo.</p>';
    return;
  }
  host.innerHTML = services.map((item, index) => `
    <article class="service-card">
      <div class="service-icon" aria-hidden="true">${icons[index % icons.length]}</div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.summary)}</p>
      <div class="service-bottom">${item.price !== '' && item.price != null ? `<span class="service-price">${escapeHtml(formatUsd(item.price))} USD</span>` : ''}</div>
    </article>`).join('');
}

function renderProjects(projects) {
  const host = document.querySelector('#project-list');
  const empty = document.querySelector('#empty-work');
  empty.hidden = projects.length > 0;
  host.innerHTML = projects.map((item, index) => `
    <article class="project-card">
      <div class="project-preview" aria-hidden="true"><span>${icons[(index + 1) % icons.length]}</span></div>
      <div class="project-info"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Visit project ↗</a>` : ''}</div>
    </article>`).join('');
}

function renderProcess(steps) {
  document.querySelector('#process-list').innerHTML = steps.map((item, index) => `
    <article class="process-step"><div class="step-number">${String(index + 1).padStart(2, '0')}</div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p></article>`).join('');
}

function renderFaqs(faqs) {
  const host = document.querySelector('#faq-list');
  host.innerHTML = faqs.length ? faqs.map((item) => `
    <details class="faq-item"><summary>${escapeHtml(item.question)}</summary><div class="faq-answer">${escapeHtml(item.answer)}</div></details>`).join('') : '<div class="faq-empty">Questions and answers will be added here.</div>';
}

async function loadSite() {
  try {
    const response = await fetch('/api/site', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Site content is temporarily unavailable.');
    const data = await response.json();
    for (const [key, value] of Object.entries(data.site || {})) {
      const nodes = document.querySelectorAll(`[data-site="${CSS.escape(key)}"]`);
      nodes.forEach((node) => { node.textContent = value; });
      if (key === 'heroTitle') document.title = `${value} | Capo`;
    }
    renderServices(data.services || []);
    renderProjects(data.projects || []);
    renderProcess(data.process || []);
    renderFaqs(data.faqs || []);
  } catch {
    document.querySelector('#service-list').innerHTML = '<p class="loading-card">Services could not be loaded just now. Please refresh the page.</p>';
    document.querySelector('#process-list').innerHTML = '<p class="loading-card">Please refresh to load the process.</p>';
  }
}

const form = document.querySelector('#inquiry-form');
const status = document.querySelector('#form-status');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const button = form.querySelector('button[type="submit"]');
  const buttonLabel = button.querySelector('span');
  const original = buttonLabel.textContent;
  button.disabled = true;
  buttonLabel.textContent = 'Sending…';
  status.classList.remove('error');
  status.textContent = '';
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    const response = await fetch('/api/inquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Your inquiry could not be sent. Please try again.');
    form.reset();
    status.textContent = 'Thanks — your inquiry is saved in Capo’s private inbox.';
  } catch (error) {
    status.classList.add('error');
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    buttonLabel.textContent = original;
  }
});

document.querySelector('#year').textContent = new Date().getFullYear();
loadSite();
