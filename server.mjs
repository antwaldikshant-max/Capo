import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCallback);
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = resolve(ROOT, 'public');
const DATA_DIR = resolve(process.env.CAPO_DATA_DIR || resolve(ROOT, 'data'));
const DATA_FILE = resolve(DATA_DIR, 'capo-private.json');
if (DATA_DIR === PUBLIC || DATA_DIR.startsWith(`${PUBLIC}${sep}`)) {
  throw new Error('CAPO_DATA_DIR must be outside the public web directory so private inquiries cannot be served as static files.');
}
const PORT = Number(process.env.PORT || 3000);
const BIND_HOST = process.env.CAPO_HOST || '127.0.0.1';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const sessions = new Map();
const attempts = new Map();
const MAX_BODY = 128 * 1024;
let saveQueue = Promise.resolve();

function starterData() {
  return {
    site: {
      heroTitle: 'Websites and apps built to help U.S. businesses grow.',
      heroBody: 'Capo helps businesses turn their next idea into a polished digital experience. Tell us what you’re working toward, and let’s talk about the right website or app for your goals.',
      heroPrimaryLabel: 'Discuss your project',
      heroSecondaryLabel: 'Explore services',
      servicesHeading: 'What we can build together',
      servicesIntro: 'Practical digital services for businesses ready to grow.',
      workHeading: 'Selected work',
      workIntro: 'A closer look at projects will appear here as Capo adds them.',
      processHeading: 'A clear path from idea to launch',
      processIntro: 'A straightforward process keeps the work focused on your goals.',
      pricingHeading: 'A scope that fits your goals',
      pricingIntro: 'Every project starts with a conversation. Share your needs and Capo will provide a quote in U.S. dollars.',
      faqHeading: 'Frequently asked questions',
      faqIntro: 'Have another question? Send a note and start the conversation.',
      contactHeading: 'Have a project in mind?',
      contactIntro: 'Share a little about your business and what you would like to build. Your note goes to Capo’s private project inbox.',
      footerNote: 'Websites and apps for growing U.S. businesses.'
    },
    services: [
      { id: randomUUID(), title: 'Website design & development', summary: 'A polished, responsive website shaped around your business and your next stage of growth.', price: '', visible: true },
      { id: randomUUID(), title: 'Web applications', summary: 'Purpose-built web experiences that help your customers or team get things done.', price: '', visible: true },
      { id: randomUUID(), title: 'Mobile apps', summary: 'Mobile app development for businesses with a clear product idea and a plan to bring it to life.', price: '', visible: true }
    ],
    projects: [],
    process: [
      { id: randomUUID(), title: 'Tell us what you’re building', summary: 'Share your goals, audience, and the problem you want your website or app to solve.' },
      { id: randomUUID(), title: 'Get a clear plan', summary: 'Agree on the project scope, deliverables, timeline, and price before work begins.' },
      { id: randomUUID(), title: 'Design and build', summary: 'Bring the experience to life, with space for feedback along the way.' },
      { id: randomUUID(), title: 'Review and launch', summary: 'Make final refinements and prepare the finished project for launch.' }
    ],
    faqs: [],
    inquiries: [],
    admin: null
  };
}

await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
let data;
try {
  data = JSON.parse(await readFile(DATA_FILE, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  data = starterData();
  await saveData();
}

async function saveData() {
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    const temp = `${DATA_FILE}.${randomBytes(5).toString('hex')}.tmp`;
    await writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(temp, DATA_FILE);
  });
  return saveQueue;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...securityHeaders(), ...headers });
  res.end(JSON.stringify(body));
}

function cookie(req, name) {
  const raw = req.headers.cookie || '';
  const pair = raw.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : '';
}

function sessionCookie(value, maxAge = 60 * 60 * 12) {
  return `capo_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${IS_PRODUCTION ? '; Secure' : ''}`;
}

function getSession(req) {
  const id = cookie(req, 'capo_session');
  const session = sessions.get(id);
  if (!session) return null;
  if (session.expires < Date.now()) {
    sessions.delete(id);
    return null;
  }
  session.expires = Date.now() + 12 * 60 * 60 * 1000;
  return { id, ...session };
}

function authorized(req, res) {
  const session = getSession(req);
  if (!session) {
    send(res, 401, { error: 'Please sign in to continue.' });
    return null;
  }
  if (req.headers['x-capo-csrf'] !== session.csrf) {
    send(res, 403, { error: 'Your secure session has expired. Please sign in again.' });
    return null;
  }
  return session;
}

function rateLimited(req, key, max, interval) {
  const address = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const mapKey = `${key}:${address}`;
  const current = attempts.get(mapKey);
  if (!current || current.reset < now) {
    attempts.set(mapKey, { count: 1, reset: now + interval });
    return false;
  }
  current.count += 1;
  return current.count > max;
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(Object.assign(new Error('Request is too large.'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolveBody(JSON.parse(body || '{}'));
      } catch {
        reject(Object.assign(new Error('Please send valid form data.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function cleanText(value, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanCollection(rows, kind) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 100).map((row) => {
    const common = { id: cleanText(row?.id, 80) || randomUUID() };
    if (kind === 'service') {
      const price = row?.price === '' || row?.price == null ? '' : Number(row.price);
      return { ...common, title: cleanText(row?.title, 100), summary: cleanText(row?.summary, 1200), price: Number.isFinite(price) && price >= 0 ? price : '', visible: row?.visible === true };
    }
    if (kind === 'project') {
      const url = cleanText(row?.url, 300);
      return { ...common, title: cleanText(row?.title, 120), summary: cleanText(row?.summary, 1200), url: /^https?:\/\//i.test(url) ? url : '', visible: row?.visible === true };
    }
    if (kind === 'faq') return { ...common, question: cleanText(row?.question, 300), answer: cleanText(row?.answer, 1500), visible: row?.visible === true };
    return { ...common, title: cleanText(row?.title, 120), summary: cleanText(row?.summary, 1200) };
  });
}

function normalizeSite(site) {
  const result = {};
  for (const [key, value] of Object.entries(data.site)) result[key] = typeof site?.[key] === 'string' ? cleanText(site[key], 1200) : value;
  return result;
}

function publicSite() {
  return {
    site: data.site,
    services: data.services.filter((x) => x.visible && x.title && x.summary),
    projects: data.projects.filter((x) => x.visible && x.title && x.summary),
    process: data.process.filter((x) => x.title && x.summary),
    faqs: data.faqs.filter((x) => x.visible && x.question && x.answer)
  };
}

function securityHeaders() {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  };
  if (IS_PRODUCTION) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

async function replyByEmail(to, subject, body) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.CAPO_FROM_EMAIL;
  if (!apiKey || !from) throw new Error('Email replies need RESEND_API_KEY and CAPO_FROM_EMAIL configured.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text: body })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Resend could not send the email (${response.status}): ${detail.slice(0, 300)}`);
  }
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method || 'GET';
  if (method !== 'GET' && req.headers.origin) {
    const expected = `http://${req.headers.host}`;
    const expectedHttps = `https://${req.headers.host}`;
    if (req.headers.origin !== expected && req.headers.origin !== expectedHttps) {
      send(res, 403, { error: 'Request origin is not allowed.' });
      return;
    }
  }

  if (method === 'GET' && pathname === '/api/site') {
    send(res, 200, publicSite());
    return;
  }
  if (method === 'GET' && pathname === '/api/setup-status') {
    send(res, 200, { setupRequired: !data.admin, setupAvailable: Boolean(process.env.CAPO_SETUP_TOKEN) });
    return;
  }
  if (method === 'POST' && pathname === '/api/setup') {
    if (data.admin) return send(res, 409, { error: 'Owner setup is already complete.' });
    if (!process.env.CAPO_SETUP_TOKEN) return send(res, 503, { error: 'Set CAPO_SETUP_TOKEN in the server environment before creating the owner account.' });
    if (rateLimited(req, 'setup', 5, 15 * 60 * 1000)) return send(res, 429, { error: 'Too many setup attempts. Try again later.' });
    const body = await readBody(req);
    const presentedToken = Buffer.from(String(body.token || ''));
    const setupToken = Buffer.from(process.env.CAPO_SETUP_TOKEN);
    if (presentedToken.length !== setupToken.length || !timingSafeEqual(presentedToken, setupToken)) return send(res, 403, { error: 'The setup token is not valid.' });
    const email = cleanText(body.email, 254).toLowerCase();
    const password = String(body.password || '').slice(0, 201);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: 'Enter a valid owner email address.' });
    if (password.length < 12 || password.length > 200) return send(res, 400, { error: 'Choose a password with at least 12 characters.' });
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, 64);
    data.admin = { email, salt: salt.toString('hex'), hash: hash.toString('hex') };
    await saveData();
    const id = randomBytes(32).toString('hex');
    const csrf = randomBytes(32).toString('hex');
    sessions.set(id, { csrf, expires: Date.now() + 12 * 60 * 60 * 1000 });
    send(res, 201, { ok: true, csrf }, { 'Set-Cookie': sessionCookie(id) });
    return;
  }
  if (method === 'POST' && pathname === '/api/login') {
    if (rateLimited(req, 'login', 8, 15 * 60 * 1000)) return send(res, 429, { error: 'Too many sign-in attempts. Try again later.' });
    if (!data.admin) return send(res, 403, { error: 'Complete owner setup first.' });
    const body = await readBody(req);
    const email = cleanText(body.email, 254).toLowerCase();
    const password = String(body.password || '');
    const candidate = await scrypt(password, Buffer.from(data.admin.salt, 'hex'), 64);
    const expected = Buffer.from(data.admin.hash, 'hex');
    const valid = candidate.length === expected.length && timingSafeEqual(candidate, expected) && email === data.admin.email;
    if (!valid) return send(res, 401, { error: 'Email or password is incorrect.' });
    const id = randomBytes(32).toString('hex');
    const csrf = randomBytes(32).toString('hex');
    sessions.set(id, { csrf, expires: Date.now() + 12 * 60 * 60 * 1000 });
    send(res, 200, { ok: true, csrf }, { 'Set-Cookie': sessionCookie(id) });
    return;
  }
  if (method === 'GET' && pathname === '/api/me') {
    const session = getSession(req);
    if (!session) return send(res, 401, { error: 'Sign in required.' });
    send(res, 200, { email: data.admin.email, csrf: session.csrf });
    return;
  }
  if (method === 'POST' && pathname === '/api/logout') {
    const session = authorized(req, res);
    if (!session) return;
    sessions.delete(session.id);
    send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    return;
  }
  if (pathname.startsWith('/api/admin/')) {
    if (method !== 'GET') {
      const session = authorized(req, res);
      if (!session) return;
    } else if (!getSession(req)) return send(res, 401, { error: 'Sign in required.' });
    if (method === 'GET' && pathname === '/api/admin/site') {
      send(res, 200, { site: data.site, services: data.services, projects: data.projects, process: data.process, faqs: data.faqs });
      return;
    }
    if (method === 'PUT' && pathname === '/api/admin/site') {
      const body = await readBody(req);
      data.site = normalizeSite(body.site || {});
      data.services = cleanCollection(body.services, 'service');
      data.projects = cleanCollection(body.projects, 'project');
      data.process = cleanCollection(body.process, 'process');
      data.faqs = cleanCollection(body.faqs, 'faq');
      await saveData();
      send(res, 200, { ok: true });
      return;
    }
    if (method === 'GET' && pathname === '/api/admin/inquiries') {
      send(res, 200, { inquiries: data.inquiries.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)), emailReady: Boolean(process.env.RESEND_API_KEY && process.env.CAPO_FROM_EMAIL) });
      return;
    }
    const replyMatch = pathname.match(/^\/api\/admin\/inquiries\/([^/]+)\/reply$/);
    if (method === 'POST' && replyMatch) {
      const body = await readBody(req);
      const text = cleanText(body.message, 8000);
      const inquiry = data.inquiries.find((item) => item.id === replyMatch[1]);
      if (!inquiry) return send(res, 404, { error: 'Inquiry not found.' });
      if (text.length < 1) return send(res, 400, { error: 'Write a reply first.' });
      try {
        await replyByEmail(inquiry.email, 'Re: Your project inquiry with Capo', text);
      } catch (error) {
        return send(res, 503, { error: error.message });
      }
      inquiry.replies ||= [];
      inquiry.replies.push({ body: text, createdAt: new Date().toISOString() });
      await saveData();
      send(res, 200, { ok: true });
      return;
    }
    return send(res, 404, { error: 'Not found.' });
  }
  if (method === 'POST' && pathname === '/api/inquiries') {
    if (rateLimited(req, 'inquiry', 30, 60 * 60 * 1000)) return send(res, 429, { error: 'Please wait before sending another inquiry.' });
    const body = await readBody(req);
    if (cleanText(body.companyWebsite, 250)) return send(res, 200, { ok: true });
    const item = {
      id: randomUUID(),
      name: cleanText(body.name, 120),
      email: cleanText(body.email, 254).toLowerCase(),
      business: cleanText(body.business, 160),
      website: /^https?:\/\//i.test(cleanText(body.website, 300)) ? cleanText(body.website, 300) : '',
      details: cleanText(body.details, 5000),
      budget: cleanText(body.budget, 120),
      timeline: cleanText(body.timeline, 120),
      createdAt: new Date().toISOString(),
      replies: []
    };
    if (item.name.length < 1 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email) || item.details.length < 12) return send(res, 400, { error: 'Add your name, a valid email address, and a little more project detail.' });
    data.inquiries.push(item);
    await saveData();
    send(res, 201, { ok: true, message: 'Your project inquiry has been saved to Capo’s private inbox.' });
    return;
  }

  const mapped = pathname === '/admin' || pathname === '/admin/' ? '/admin.html' : pathname === '/setup' || pathname === '/setup/' ? '/setup.html' : pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(PUBLIC, `.${mapped}`);
  if (!filePath.startsWith(`${PUBLIC}${sep}`) && filePath !== resolve(PUBLIC, 'index.html')) return send(res, 404, { error: 'Not found.' });
  try {
    const content = await readFile(filePath);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream', 'Cache-Control': extname(filePath) === '.html' ? 'no-store' : 'public, max-age=3600', ...securityHeaders() });
    res.end(content);
  } catch {
    send(res, 404, { error: 'Not found.' });
  }
}

const server = createServer((req, res) => {
  Promise.resolve(route(req, res)).catch((error) => {
    if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : 'Something went wrong. Please try again.' });
    else res.destroy();
  });
});

server.listen(PORT, BIND_HOST, () => {
  console.log(`Capo site running on http://localhost:${PORT}`);
  console.log(`Private data directory: ${DATA_DIR}`);
});
