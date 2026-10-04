const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let csrfToken = '';
let siteData = { site: {}, services: [], projects: [], process: [], faqs: [] };
let inquiries = [];
let emailReady = false;
let selectedInquiry = '';
let activeView = 'overview';
let statusTimer;

const contentFields = [
  ['heroTitle', 'Main headline', true],
  ['heroBody', 'Short introduction', true],
  ['heroPrimaryLabel', 'Primary project button'],
  ['heroSecondaryLabel', 'Services link label'],
  ['servicesHeading', 'Services heading'],
  ['servicesIntro', 'Services introduction', true],
  ['workHeading', 'Portfolio heading'],
  ['workIntro', 'Portfolio introduction', true],
  ['processHeading', 'Process heading'],
  ['processIntro', 'Process introduction', true],
  ['pricingHeading', 'Pricing heading'],
  ['pricingIntro', 'Pricing introduction', true],
  ['faqHeading', 'FAQs heading'],
  ['faqIntro', 'FAQs introduction', true],
  ['contactHeading', 'Contact heading'],
  ['contactIntro', 'Contact introduction', true],
  ['footerNote', 'Footer note']
];

function showAuthMessage(message, isError = false) {
  const box = $('#auth-message');
  box.textContent = message;
  box.classList.toggle('error', isError);
}

async function request(url, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (options.method && options.method !== 'GET' && csrfToken) headers['X-Capo-CSRF'] = csrfToken;
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  let result = {};
  try { result = await response.json(); } catch { /* keep the network error below useful */ }
  if (!response.ok) throw new Error(result.error || `The request failed (${response.status}).`);
  return result;
}

function showLogin() {
  $('#auth-screen').hidden = false;
  $('#admin-app').hidden = true;
}

function showDashboard(email) {
  $('#auth-screen').hidden = true;
  $('#admin-app').hidden = false;
  $('#owner-email').textContent = email;
}

function toggleAuthForm(kind) {
  $('#login-form').hidden = kind !== 'login';
  $('#setup-form').hidden = kind !== 'setup';
  $('#auth-message').textContent = '';
  $('#auth-message').classList.remove('error');
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `capo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function esc(value) { return escapeHTML(value ?? ''); }

function renderContentFields() {
  $('#content-fields').innerHTML = contentFields.map(([key, label, full]) => {
    const value = esc(siteData.site[key] || '');
    const id = `content-${key}`;
    return `<label class="admin-field${full ? ' full' : ''}" for="${id}">${label}${full ? `<span class="field-hint">This is public. Keep personal details out unless you intend to share them.</span>` : ''}${full ? `<textarea id="${id}" data-site-key="${key}" maxlength="1200">${value}</textarea>` : `<input id="${id}" data-site-key="${key}" value="${value}" maxlength="1200">`}</label>`;
  }).join('');
}

function editorCard({ id, title, summary, visible, price, url, question, answer }, type, index) {
  const head = type === 'faq' ? question : title;
  let fields = '';
  if (type === 'service') {
    fields = `<div class="editor-fields">
      <label class="admin-field" for="service-title-${esc(id)}">Service name<input id="service-title-${esc(id)}" data-id="${esc(id)}" data-field="title" maxlength="100" value="${esc(title)}" placeholder="Service name"></label>
      <label class="admin-field" for="service-price-${esc(id)}">Price in USD <span class="field-hint">Leave blank to discuss a custom quote.</span><input id="service-price-${esc(id)}" data-id="${esc(id)}" data-field="price" type="number" min="0" step="0.01" value="${price === '' || price == null ? '' : esc(price)}" placeholder="Enter your price"></label>
      <label class="admin-field full" for="service-summary-${esc(id)}">Description<textarea id="service-summary-${esc(id)}" data-id="${esc(id)}" data-field="summary" maxlength="1200" placeholder="Describe what this service includes">${esc(summary)}</textarea></label>
    </div>`;
  } else if (type === 'project') {
    fields = `<div class="editor-fields">
      <label class="admin-field" for="project-title-${esc(id)}">Project name<input id="project-title-${esc(id)}" data-id="${esc(id)}" data-field="title" maxlength="120" value="${esc(title)}" placeholder="Project name"></label>
      <label class="admin-field" for="project-url-${esc(id)}">Public link <span class="field-hint">Optional. Use a public https:// link.</span><input id="project-url-${esc(id)}" data-id="${esc(id)}" data-field="url" type="url" maxlength="300" value="${esc(url)}" placeholder="https://"></label>
      <label class="admin-field full" for="project-summary-${esc(id)}">Project description<textarea id="project-summary-${esc(id)}" data-id="${esc(id)}" data-field="summary" maxlength="1200" placeholder="Add details you are ready to publish">${esc(summary)}</textarea></label>
    </div>`;
  } else if (type === 'process') {
    fields = `<div class="editor-fields"><label class="admin-field" for="process-title-${esc(id)}">Step name<input id="process-title-${esc(id)}" data-id="${esc(id)}" data-field="title" maxlength="120" value="${esc(title)}" placeholder="Step name"></label><label class="admin-field" for="process-summary-${esc(id)}">Description<textarea id="process-summary-${esc(id)}" data-id="${esc(id)}" data-field="summary" maxlength="1200" placeholder="Explain this step">${esc(summary)}</textarea></label></div>`;
  } else {
    fields = `<div class="editor-fields"><label class="admin-field" for="faq-question-${esc(id)}">Question<input id="faq-question-${esc(id)}" data-id="${esc(id)}" data-field="question" maxlength="300" value="${esc(question)}" placeholder="What do clients ask?"></label><label class="admin-field" for="faq-answer-${esc(id)}">Answer<textarea id="faq-answer-${esc(id)}" data-id="${esc(id)}" data-field="answer" maxlength="1500" placeholder="Write your answer">${esc(answer)}</textarea></label></div>`;
  }
  const switchRow = type === 'process' ? '' : `<div class="visibility-line"><label class="check-label"><input type="checkbox" data-id="${esc(id)}" data-field="visible" ${visible ? 'checked' : ''}> Show this ${type === 'faq' ? 'question' : type} on the website</label><span>Changes appear after you save</span></div>`;
  return `<article class="editor-card"><div class="editor-card-top"><b>${type === 'process' ? `Step ${index + 1}` : esc(head || `${type === 'faq' ? 'New question' : `New ${type}`}`)}</b>${type === 'process' ? '<span class="drag-hint">Displayed in order</span>' : ''}<button class="delete-button" type="button" data-delete-id="${esc(id)}" data-type="${type}" aria-label="Delete ${type}: ${esc(head || 'item')}">Delete</button></div>${fields}${switchRow}</article>`;
}

function renderEditors() {
  const definitions = [
    ['service-editor', 'services', 'service'],
    ['project-editor', 'projects', 'project'],
    ['process-editor', 'process', 'process'],
    ['faq-editor', 'faqs', 'faq']
  ];
  for (const [elementId, key, type] of definitions) {
    const items = siteData[key] || [];
    const host = $(`#${elementId}`);
    host.innerHTML = items.length ? items.map((item, index) => editorCard(item, type, index)).join('') : `<div class="panel empty-editor">Nothing here yet. Use “Add ${type === 'faq' ? 'question' : type}” to get started.</div>`;
  }
  renderStats();
}

function renderStats() {
  $('#stat-services').textContent = (siteData.services || []).filter((item) => item.visible && item.title).length;
  $('#stat-projects').textContent = (siteData.projects || []).filter((item) => item.visible && item.title).length;
  $('#stat-inquiries').textContent = inquiries.length;
  $('#inbox-count').textContent = inquiries.length;
}

function renderConnectionStatus() {
  const entries = [
    ['Site content & inquiry storage', true, 'Saved in a private file under the server data directory.'],
    ['Owner login', true, 'Password protected, with a secure one-way password hash.'],
    ['Email replies', emailReady, emailReady ? 'Connected through Resend.' : 'Needs a Resend API key and verified sender address.']
  ];
  $('#connection-status').innerHTML = entries.map(([name, ready, detail]) => `<div class="connection-row"><span class="connection-dot${ready ? ' ready' : ''}"></span><span>${esc(name)}<small>${esc(detail)}</small></span><span class="connection-state${ready ? ' ready' : ''}">${ready ? 'Ready' : 'Setup needed'}</span></div>`).join('');
  $('#email-notice').classList.toggle('ready', emailReady);
  $('#email-notice').innerHTML = emailReady
    ? 'Email replies are connected. Replies sent here will be sent to the selected client by email and recorded in this inbox.'
    : 'Client inquiries are saved here, but email replies are not connected yet. Set <code>RESEND_API_KEY</code> and <code>CAPO_FROM_EMAIL</code> on the server. The sender must be verified with Resend. Restart the server after adding both values.';
}

function relativeDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function renderInquiryList() {
  const host = $('#inquiry-list');
  const rows = inquiries.map((item) => `<button class="inquiry-row${item.id === selectedInquiry ? ' active' : ''}" type="button" data-inquiry-id="${esc(item.id)}"><span class="inquiry-row-top"><b>${esc(item.name)}</b><time>${esc(new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(item.createdAt)))}</time></span><p>${esc(item.details)}</p></button>`).join('');
  host.innerHTML = `<div class="inbox-list-heading"><span>INQUIRIES</span><span>${inquiries.length}</span></div>${rows || '<div class="inbox-list-empty">No project inquiries yet.</div>'}`;
  $$('.inquiry-row', host).forEach((button) => button.addEventListener('click', () => {
    selectedInquiry = button.dataset.inquiryId;
    renderInquiryList();
    renderInquiryDetail();
  }));
}

function renderInquiryDetail() {
  const item = inquiries.find((entry) => entry.id === selectedInquiry);
  const host = $('#inquiry-detail');
  if (!item) {
    host.innerHTML = '<div class="inbox-empty"><span class="empty-envelope">✉</span><h2>Select an inquiry</h2><p>Choose a message from the list to read and reply.</p></div>';
    return;
  }
  const metadata = [item.business ? `<span>Business: ${esc(item.business)}</span>` : '', item.website ? `<span>Website: <a href="${esc(item.website)}" target="_blank" rel="noopener noreferrer">${esc(item.website)}</a></span>` : '', item.budget ? `<span>Budget: ${esc(item.budget)} USD</span>` : '', item.timeline ? `<span>Timeline: ${esc(item.timeline)}</span>` : ''].filter(Boolean).join('');
  const history = (item.replies || []).map((reply) => `<div class="reply-item"><time>Sent ${esc(relativeDate(reply.createdAt))}</time>${esc(reply.body)}</div>`).join('');
  const replyArea = emailReady
    ? `<form class="reply-box" id="reply-form"><label for="reply-message">Reply by email</label><textarea id="reply-message" name="message" maxlength="8000" required placeholder="Write a reply to ${esc(item.name)}…"></textarea><div class="reply-actions"><span class="reply-status" id="reply-status" role="status" aria-live="polite"></span><button class="admin-button admin-button-primary" type="submit">Send email reply <span aria-hidden="true">↗</span></button></div></form>`
    : '<div class="reply-locked">Email replies are not connected. Set <code>RESEND_API_KEY</code> and <code>CAPO_FROM_EMAIL</code> on the server before sending a reply.</div>';
  host.innerHTML = `<div class="inquiry-detail-header"><div><h2>${esc(item.name)}</h2><p><a href="mailto:${esc(item.email)}">${esc(item.email)}</a></p></div><time class="inquiry-date">${esc(relativeDate(item.createdAt))}</time></div><div class="inquiry-meta">${metadata}</div><div class="inquiry-body">${esc(item.details)}</div>${history ? `<div class="reply-history"><h3>Sent replies</h3>${history}</div>` : ''}${replyArea}`;
  const replyForm = $('#reply-form', host);
  if (replyForm) replyForm.addEventListener('submit', sendReply);
}

async function sendReply(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('button', form);
  const status = $('#reply-status', form);
  if (!form.reportValidity()) return;
  button.disabled = true;
  status.textContent = 'Sending…';
  status.classList.remove('error');
  try {
    const payload = { message: new FormData(form).get('message') };
    await request(`/api/admin/inquiries/${encodeURIComponent(selectedInquiry)}/reply`, { method: 'POST', body: JSON.stringify(payload) });
    status.textContent = 'Email sent and recorded.';
    await loadInquiries();
  } catch (error) {
    status.textContent = error.message;
    status.classList.add('error');
    button.disabled = false;
  }
}

async function loadInquiries() {
  const result = await request('/api/admin/inquiries');
  inquiries = result.inquiries || [];
  emailReady = result.emailReady === true;
  if (!inquiries.some((item) => item.id === selectedInquiry)) selectedInquiry = inquiries[0]?.id || '';
  renderInquiryList();
  renderInquiryDetail();
  renderConnectionStatus();
  renderStats();
}

function setView(name) {
  activeView = name;
  $$('.admin-view').forEach((view) => view.classList.toggle('active', view.id === `view-${name}`));
  $$('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === name));
  $('#crumb-current').textContent = ({ overview: 'Overview', content: 'Site content', services: 'Services & pricing', projects: 'Portfolio', process: 'Process', faqs: 'FAQs', inbox: 'Project inbox' })[name] || 'Overview';
  $('#save-button').hidden = name === 'inbox';
  if (name === 'inbox') loadInquiries().catch((error) => setSaveStatus(error.message, true));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setSaveStatus(message, error = false) {
  const box = $('#save-status');
  box.textContent = message;
  box.classList.toggle('error', error);
  clearTimeout(statusTimer);
  if (message) statusTimer = setTimeout(() => { box.textContent = ''; box.classList.remove('error'); }, 4300);
}

async function saveSite() {
  setSaveStatus('Saving…');
  $('#save-button').disabled = true;
  try {
    await request('/api/admin/site', { method: 'PUT', body: JSON.stringify(siteData) });
    setSaveStatus('Changes saved. Your public website is up to date.');
  } catch (error) {
    setSaveStatus(error.message, true);
  } finally {
    $('#save-button').disabled = false;
  }
}

function addItem(collection, item) {
  siteData[collection].push({ id: createId(), ...item });
  renderEditors();
  const viewFor = { services: 'services', projects: 'projects', process: 'process', faqs: 'faqs' }[collection];
  setView(viewFor);
  const editor = $(`#view-${viewFor} .editor-card:last-child`);
  if (editor) $('input,textarea', editor)?.focus();
  setSaveStatus('New item added. Save changes when you’re ready to publish it.');
}

function bindEditorEvents() {
  const collectionByType = { service: 'services', project: 'projects', process: 'process', faq: 'faqs' };
  for (const [hostId, collection] of [['service-editor','services'],['project-editor','projects'],['process-editor','process'],['faq-editor','faqs']]) {
    const host = $(`#${hostId}`);
    host.addEventListener('input', (event) => {
      const field = event.target.dataset.field;
      const id = event.target.dataset.id;
      if (!field || !id) return;
      const item = siteData[collection].find((entry) => entry.id === id);
      if (!item) return;
      item[field] = event.target.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value;
      if (event.target.type === 'number' && event.target.value === '') item[field] = '';
      if (collection === 'services' || collection === 'projects') renderStats();
    });
    host.addEventListener('change', (event) => {
      const field = event.target.dataset.field;
      const id = event.target.dataset.id;
      if (event.target.type !== 'checkbox' || !field || !id) return;
      const item = siteData[collection].find((entry) => entry.id === id);
      if (item) item[field] = event.target.checked;
      renderStats();
    });
    host.addEventListener('click', (event) => {
      const button = event.target.closest('[data-delete-id]');
      if (!button) return;
      siteData[collection] = siteData[collection].filter((entry) => entry.id !== button.dataset.deleteId);
      renderEditors();
      setSaveStatus('Item removed from your draft. Save changes to update the public site.');
    });
  }
}

async function startDashboard(email) {
  showDashboard(email);
  try {
    siteData = await request('/api/admin/site');
    renderContentFields();
    renderEditors();
    renderConnectionStatus();
    await loadInquiries();
  } catch (error) {
    showLogin();
    showAuthMessage(`Your secure session could not be restored: ${error.message}`, true);
  }
}

async function initialize() {
  $('#year')?.remove();
  const status = await request('/api/setup-status').catch(() => ({ setupRequired: true, setupAvailable: false }));
  if (status.setupRequired) {
    $('#auth-title').textContent = 'Set up your owner account.';
    $('#auth-copy').textContent = 'This is a one-time step before you can manage your website.';
    if (status.setupAvailable) {
      toggleAuthForm('setup');
      showAuthMessage('Use the one-time setup token configured by the server owner, then create a private owner login.');
    } else {
      toggleAuthForm('none');
      showAuthMessage('Before creating an account, set CAPO_SETUP_TOKEN in the server environment and restart the site. See the deployment guide for exact steps.');
    }
    return;
  }
  const session = await request('/api/me').catch(() => null);
  if (session?.csrf) {
    csrfToken = session.csrf;
    await startDashboard(session.email);
    return;
  }
  $('#auth-title').textContent = 'Welcome back.';
  $('#auth-copy').textContent = 'Sign in to manage your website and private project inbox.';
  toggleAuthForm('login');
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('button', form);
  button.disabled = true;
  showAuthMessage('Signing in…');
  try {
    const body = Object.fromEntries(new FormData(form).entries());
    const result = await request('/api/login', { method: 'POST', body: JSON.stringify(body) });
    csrfToken = result.csrf;
    form.reset();
    await startDashboard(body.email);
  } catch (error) {
    showAuthMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$('#setup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('button', form);
  button.disabled = true;
  showAuthMessage('Creating your account…');
  try {
    const body = Object.fromEntries(new FormData(form).entries());
    const result = await request('/api/setup', { method: 'POST', body: JSON.stringify(body) });
    csrfToken = result.csrf;
    form.reset();
    await startDashboard(body.email);
  } catch (error) {
    showAuthMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$('#logout-button').addEventListener('click', async () => {
  try { await request('/api/logout', { method: 'POST', body: '{}' }); } catch { /* clear this browser's view even if the session expired */ }
  csrfToken = '';
  siteData = { site: {}, services: [], projects: [], process: [], faqs: [] };
  showLogin();
  $('#auth-title').textContent = 'Welcome back.';
  $('#auth-copy').textContent = 'Sign in to manage your website and private project inbox.';
  toggleAuthForm('login');
});

$$('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
$('#save-button').addEventListener('click', saveSite);
$('#add-service').addEventListener('click', () => addItem('services', { title: '', summary: '', price: '', visible: true }));
$('#add-project').addEventListener('click', () => addItem('projects', { title: '', summary: '', url: '', visible: true }));
$('#add-process').addEventListener('click', () => addItem('process', { title: '', summary: '' }));
$('#add-faq').addEventListener('click', () => addItem('faqs', { question: '', answer: '', visible: true }));
$('#content-fields').addEventListener('input', (event) => {
  const key = event.target.dataset.siteKey;
  if (key) siteData.site[key] = event.target.value;
});
bindEditorEvents();
initialize();
